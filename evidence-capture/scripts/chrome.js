// capture.js / compose.js / github-attach.js 共通: playwright-core の解決と、headless Chrome の起動・CDP 接続、区間録画。
// Playwright の chromium.launch は環境によって Chrome がクラッシュするため、Chrome を自前で起動して connectOverCDP で接続する。
// Windows / macOS / Linux に対応。Chrome の場所は環境変数 CHROME_PATH で上書きできる。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    ...(isWin
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        ]
      : isMac
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]),
  ].filter(Boolean);
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`Chrome が見つかりません。環境変数 CHROME_PATH に chrome の実行ファイルを指定してください(探した場所: ${candidates.join(", ")})`);
  return hit;
}

// ツールのデータ置き場(ログイン済みプロファイル・mp4 変換用 ffmpeg など)。ユーザー単位で、プロジェクトの外に置く
function dataDir(name) {
  const base = isWin
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local")
    : isMac
      ? path.join(os.homedir(), "Library/Application Support")
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share");
  return path.join(base, name);
}

// playwright-core はプロジェクトの依存 → npx キャッシュ(@playwright/mcp が入れたもの)の順に探す
function resolvePlaywrightCore() {
  try {
    return path.dirname(require.resolve("playwright-core/package.json", { paths: [process.cwd(), __dirname] }));
  } catch {
    const npxDir = isWin
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"), "npm-cache/_npx")
      : path.join(os.homedir(), ".npm/_npx");
    const hit = fs.existsSync(npxDir)
      ? fs.readdirSync(npxDir)
          .map((d) => path.join(npxDir, d, "node_modules/playwright-core"))
          .find((p) => fs.existsSync(path.join(p, "package.json")))
      : undefined;
    if (!hit) throw new Error("playwright-core が見つかりません。`npx -y @playwright/mcp@latest --help` を一度実行して npx キャッシュに入れるか、`npm i -D playwright-core` してください");
    return hit;
  }
}

// profile を指定すると、そのプロファイル(ログイン状態)を使い回し、終了時も消さない。headless: false で画面を出す
// ignoreCertErrors は開発サーバーの自己署名証明書を通すためのもの。GitHub など外部サイトへのログインでは付けない(既定は付けない)
async function launchChrome({ port, viewport, profile: keepProfile, headless = true, ignoreCertErrors = false }) {
  const pwCorePath = resolvePlaywrightCore();
  const { chromium } = require(pwCorePath);
  const profile = keepProfile || fs.mkdtempSync(path.join(os.tmpdir(), "evidence-capture-"));
  const chrome = spawn(findChrome(), [
    ...(headless ? ["--headless=new"] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    ...(ignoreCertErrors ? ["--ignore-certificate-errors"] : []), "--no-first-run", "--no-default-browser-check",
    `--window-size=${viewport.width},${viewport.height}`, "about:blank",
  ], { stdio: "ignore" });
  // 起動を待ってから接続する(ポートが開くまで最大 20 秒)
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    await sleep(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) {
    chrome.kill();
    throw new Error(`Chrome に接続できません(port ${port})。同じポートを使う Chrome が残っていないか確認してください`);
  }

  // recordVideo を付けたコンテキストを作る。ffmpeg が無いときは導入コマンドを示して止める
  async function newContext(options) {
    try {
      return await browser.newContext(options);
    } catch (e) {
      if (String(e).includes("ffmpeg")) {
        throw new Error(`録画用の ffmpeg がありません。次を実行してから再実行してください:\n  node "${path.join(pwCorePath, "cli.js")}" install ffmpeg`);
      }
      throw e;
    }
  }

  async function close() {
    if (keepProfile) {
      // 強制終了すると Cookie(ログイン状態)がディスクに書き出されず、次回起動時に未ログインに戻る。
      // CDP の Browser.close で正常終了させ、プロセスが終わるのを待つ(終わらなければ強制終了)
      const exited = new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once("exit", r)));
      await browser.newBrowserCDPSession().then((s) => s.send("Browser.close")).catch(() => {});
      await Promise.race([exited, sleep(15000)]);
      if (chrome.exitCode === null) chrome.kill();
      return;
    }
    await browser.close().catch(() => {});
    chrome.kill();
    await sleep(1500);
    // Chrome の終了直後はファイルがロックされていることがある。消せなくても証跡には影響しないので無視する
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {}
  }
  return { browser, newContext, close };
}

// Playwright がインストールする録画用 ffmpeg(mjpeg を読み、webm を書き出す)。
// 同梱の ffmpeg は Playwright の版によって VP8 だけ・VP9 だけを持ち(読み書きとも)、合わない版を
// 選ぶと write EOF などで落ちる。新しい版から順に、webm を書き出せるもの(decodes を渡したときは、
// そのコーデックを読めるもの)を選ぶ。
function findFfmpeg({ decodes } = {}) {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (isWin
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"), "ms-playwright")
      : isMac
        ? path.join(os.homedir(), "Library/Caches/ms-playwright")
        : path.join(os.homedir(), ".cache/ms-playwright"));
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith("ffmpeg-")).sort().reverse() : [];
  const exe = dirs
    .map((dir) => ["ffmpeg-win64.exe", "ffmpeg-mac", "ffmpeg-linux"].map((f) => path.join(base, dir, f)).find((p) => fs.existsSync(p)))
    .find((p) => p && (decodes ? ffmpegCodecs(p, "-decoders").includes(decodes) : webmCodec(p)));
  if (!exe) {
    const what = decodes ? `${decodes} の動画を読める` : "webm を書き出せる";
    throw new Error(`${what}録画用の ffmpeg がありません。次を実行してから再実行してください:
  node "${path.join(resolvePlaywrightCore(), "cli.js")}" install ffmpeg`);
  }
  return exe;
}

// その ffmpeg が書き出せる webm の映像コーデック(vp8 を優先)。どちらも無ければ undefined
function webmCodec(exe) {
  const codecs = ffmpegCodecs(exe, "-encoders");
  return ["vp8", "vp9"].find((c) => codecs.includes(c));
}

function ffmpegCodecs(exe, flag) {
  const r = spawnSync(exe, ["-hide_banner", flag], { encoding: "utf8" });
  return [...`${r.stdout || ""}${r.stderr || ""}`.matchAll(/\(codec (\w+)\)/g)].map((m) => m[1]);
}

// 区間だけを録る録画。resume() 〜 pause() の間の画面だけを動画にし、間(ページの読み込み中など)は詰める。
// Chrome の screencast(画面が変わったときだけフレームが届く)を受け取り、保存時に各フレームの表示時間ぶん複製して 25fps にする。
const MAX_VIDEO_HEIGHT = 1200;

async function createRecorder(page, viewport) {
  const cdp = await page.context().newCDPSession(page);
  const segments = [];
  let current = null;
  cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (current) current.frames.push({ t: metadata.timestamp ?? Date.now() / 1000, data: Buffer.from(data, "base64") });
  });
  return {
    async resume() {
      current = { frames: [], end: null };
      segments.push(current);
      // 画面が変わらないとフレームが届かないため、区間の最初の1枚は自分で撮る
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
      current.frames.push({ t: Date.now() / 1000, data: Buffer.from(data, "base64") });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: viewport.width, maxHeight: viewport.height });
    },
    async pause() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      if (current) current.end = Date.now() / 1000;
      current = null;
    },
    async save(dest) {
      if (current) await this.pause();
      const fps = 25;
      // libvpx は高さが 1650px ほどを超えるとメモリを確保できずに落ち、webm が 0 バイトになる。縦横比を保って高さを抑える
      const shrink = Math.min(1, MAX_VIDEO_HEIGHT / viewport.height);
      const [width, height] = [Math.round(viewport.width * shrink), Math.round(viewport.height * shrink)];
      // VP8/VP9(yuv420p)は幅・高さが奇数だと開けない(スマホ幅の 375×667 など)。偶数に切り上げ、増えた 1px は pad で埋める
      const [outW, outH] = [width + (width % 2), height + (height % 2)];
      const exe = findFfmpeg();
      const ff = spawn(exe, [
        "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "pipe:0", "-y", "-an",
        "-c:v", webmCodec(exe), "-qmin", "0", "-qmax", "50", "-crf", "8", "-deadline", "realtime", "-speed", "8", "-b:v", "1M", "-threads", "1",
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:0:0:gray`, dest,
      ], { stdio: ["pipe", "ignore", "pipe"] });
      // ffmpeg が先に落ちると stdin への書き込みが write EOF になり、ffmpeg 自身のエラー(close で出す)より先に落ちて原因が隠れる
      ff.stdin.on("error", () => {});
      let err = "";
      ff.stderr.on("data", (d) => (err += d));
      const done = new Promise((resolve, reject) => ff.on("close", (code) => (code ? reject(new Error(`ffmpeg: ${err}`)) : resolve())));
      let carry = 0;
      for (const seg of segments) {
        const frames = seg.frames.sort((a, b) => a.t - b.t);
        frames.forEach((f, i) => {
          const until = i + 1 < frames.length ? frames[i + 1].t : seg.end;
          carry += Math.max(0, until - f.t) * fps;
          const n = Math.floor(carry);
          carry -= n;
          for (let k = 0; k < Math.max(n, i === 0 ? 1 : 0); k++) ff.stdin.write(f.data);
        });
      }
      ff.stdin.end();
      await done;
      await cdp.detach().catch(() => {});
      return dest;
    },
  };
}

module.exports = { launchChrome, createRecorder, findFfmpeg, dataDir, sleep };
