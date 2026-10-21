// 証跡の画像・動画を GitHub に添付し、PR 本文に貼れる URL を出力する(git にはコミットしない)。
// GitHub には添付用の公開 API がないため、PR 画面のコメント欄へ手で貼るのと同じ操作を Playwright で行い、
// 挿入された user-attachments の URL を読み取ってから、コメント欄を空に戻す(コメントは投稿しない)。
//
// 使い方:
//   node github-attach.js login                       … 初回だけ。Chrome が開くので GitHub にログインする(ログイン済みならすぐ終わる)
//   node github-attach.js check                       … ログイン状態とセッションの期限を出す(画面は開かない)
//   node github-attach.js upload <PR の URL> <file>... … 1ファイルずつ添付し、結果を JSON で出力する
//
// 出力: [{ "file": "after.mp4", "url": "https://github.com/user-attachments/assets/...", "markdown": "..." }]
//   markdown は GitHub がコメント欄に入れた文字列そのもの(画像は <img> / ![]()、動画は URL だけの行)。
//   webm は mp4 に変換してから上げる(webm のままだとプレーヤーにならずリンク表示になる)。file は変換後の名前になる。
//   動画の URL は本文で前後を空行で囲み、独立した段落にする(直前の行とつながるとリンク表示になる)。
//   PR 本文にそのまま書けば、画像は表示され、動画はプレイヤーで再生できる。
// ログイン状態は専用プロファイル(chrome.js の dataDir。Windows は %LOCALAPPDATA%/evidence-capture/github-chrome)に保存する。普段使いの Chrome とは別。
// GitHub のセッション Cookie は 2 週間ほど持ち、使うたびに延びる。upload でログインが切れていたら、
// その場でログイン用の Chrome を開いてログインを待ち、続けて添付する(手で login を流し直さなくてよい)。
const fs = require("fs");
const path = require("path");
const { launchChrome, dataDir, sleep } = require("./chrome");

const PROFILE = dataDir("evidence-capture/github-chrome");
const VIEWPORT = { width: 1400, height: 1000 };
const PORT = 9471;
const UPLOAD_TIMEOUT = 180000;

const loginName = (page) =>
  page.evaluate(() => document.querySelector('meta[name="user-login"]')?.content || "");

async function login() {
  const { browser, close } = await launchChrome({ port: PORT, viewport: VIEWPORT, profile: PROFILE, headless: false });
  try {
    const page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage());
    await page.goto("https://github.com/login");
    console.error("開いた Chrome で GitHub にログインしてください(最大10分待ちます)");
    for (let i = 0; i < 300; i++) {
      const name = await loginName(page).catch(() => "");
      if (name) {
        console.log(`ログイン済み: ${name}`);
        return;
      }
      await sleep(2000);
    }
    throw new Error("10分以内にログインが確認できませんでした(ログインはこの Chrome で行う。普段使いの Chrome ではない)");
  } finally {
    await close();
  }
}

// PR 画面の新規コメント欄と、そのファイル添付用 input を探す
async function findCommentBox(page) {
  const candidates = ["#new_comment_field", 'textarea[name="comment[body]"]', 'textarea[placeholder*="comment" i]', "textarea"];
  for (const sel of candidates) {
    const ta = page.locator(sel).last();
    if (await ta.count()) {
      await ta.scrollIntoViewIfNeeded();
      await ta.click();
      return ta;
    }
  }
  throw new Error("PR 画面にコメント欄が見つかりません(GitHub の画面構造が変わった可能性)");
}

async function attachOne(page, ta, file) {
  await ta.fill("");
  const input = (await ta.evaluateHandle((el) => {
    for (let n = el; n; n = n.parentElement) {
      const i = n.querySelector?.('input[type="file"]');
      if (i) return i;
    }
    return null;
  })).asElement();
  if (input) {
    await input.setInputFiles(file);
  } else {
    // input が見つからない画面では「ファイルを添付」ボタンからファイル選択を受ける
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 10000 }),
      page.getByRole("button", { name: /attach|add files|ファイル/i }).last().click(),
    ]);
    await chooser.setFiles(file);
  }
  const handle = await ta.elementHandle();
  try {
    await page.waitForFunction(
      (el) => /user-attachments\/(assets|files)\//.test(el.value) && !/Uploading/i.test(el.value),
      handle,
      { timeout: UPLOAD_TIMEOUT, polling: 500 },
    );
  } catch {
    const msg = await page.locator(".is-bad-file, .is-too-big, [role=alert]").allInnerTexts().catch(() => []);
    throw new Error(`${path.basename(file)}: アップロードが完了しませんでした ${msg.join(" ").trim()}`);
  }
  const markdown = (await ta.inputValue()).trim();
  await ta.fill("");
  const url = markdown.match(/https:\/\/github\.com\/user-attachments\/(?:assets|files)\/[^\s)"'>]+/)[0];
  return { file: path.basename(file), url, markdown };
}

// GitHub が本文でプレーヤーとして埋め込むのは mp4(H.264)だけで、webm は普通のファイル(リンク表示)になる。
// webm は同じ場所に mp4 を作ってから上げる。Playwright 同梱の ffmpeg は H.264 を書き出せないため ffmpeg-static を使う
const TOOLS = dataDir("evidence-capture/tools");
function toMp4(file) {
  if (!/\.webm$/i.test(file)) return file;
  let ffmpeg;
  try {
    ffmpeg = require(path.join(TOOLS, "node_modules", "ffmpeg-static"));
  } catch {
    throw new Error(`動画を mp4 に変換する ffmpeg がありません。次を実行してから再実行してください:\n  npm install --prefix "${TOOLS}" ffmpeg-static@5.3.0`);
  }
  const mp4 = file.replace(/\.webm$/i, ".mp4");
  const r = require("child_process").spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-i", file, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-movflags", "+faststart", "-an", mp4,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${path.basename(file)}: mp4 への変換に失敗しました ${r.stderr || ""}`);
  return mp4;
}

async function upload(prUrl, files) {
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(prUrl || "")) throw new Error("PR の URL を指定してください");
  if (!files.length) throw new Error("添付するファイルを指定してください");
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) throw new Error(`ファイルがありません: ${missing.join(", ")}`);
  files = files.map(toMp4);
  if (!fs.existsSync(PROFILE) || !(await currentLogin())) {
    console.error("GitHub に未ログイン、またはログインが切れています。ログイン用の Chrome を開きます");
    await login();
  }

  const { browser, close } = await launchChrome({ port: PORT, viewport: VIEWPORT, profile: PROFILE });
  try {
    const page = await browser.contexts()[0].newPage();
    await page.goto(prUrl, { waitUntil: "domcontentloaded" });
    if (!(await loginName(page))) throw new Error("GitHub のログインが確認できません。`node github-attach.js login` を実行してください");
    const ta = await findCommentBox(page);
    const out = [];
    for (const f of files) out.push(await attachOne(page, ta, path.resolve(f)));
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await close();
  }
}

// 専用プロファイルのログイン名とセッション Cookie の期限を headless で読む(未ログインなら name は空)
async function currentLogin() {
  if (!fs.existsSync(PROFILE)) return "";
  const { browser, close } = await launchChrome({ port: PORT, viewport: VIEWPORT, profile: PROFILE });
  try {
    const page = await browser.contexts()[0].newPage();
    await page.goto("https://github.com/", { waitUntil: "domcontentloaded" });
    // 負荷が高いと meta の出力が遅れて未ログインと誤判定するので、読み込みを待ってから読む
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
    const name = await loginName(page);
    const session = (await browser.contexts()[0].cookies("https://github.com")).find((c) => c.name === "user_session");
    if (name && session && session.expires > 0) {
      console.error(`ログイン済み: ${name}(セッションの期限 ${new Date(session.expires * 1000).toLocaleString("ja-JP")})`);
    }
    return name;
  } finally {
    await close();
  }
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  login: async () => ((await currentLogin()) ? undefined : login()),
  check: async () => {
    if (!(await currentLogin())) throw new Error("GitHub に未ログインです。`node github-attach.js login` を実行してください");
  },
  upload: () => upload(args[0], args.slice(1)),
};
(commands[cmd] ? commands[cmd]() : Promise.reject(new Error("使い方: github-attach.js login | check | upload <PR の URL> <file>...")))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
