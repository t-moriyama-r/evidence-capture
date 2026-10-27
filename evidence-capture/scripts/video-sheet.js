// 録った動画(webm)を一定間隔で切り出し、時刻付きのコマを並べた一覧画像(コンタクトシート)を作る。
// 動画はそのままでは Read ツールで読めないため、録画のあとにこの一覧で中身を目視確認する。
// 使い方: node video-sheet.js <動画.webm> <出力.png> [間隔秒(既定 1)] [列数(既定 5)]
// 出力: 一覧画像のほか、長さ・コマ数・「前のコマと同じ」時刻(止まって見える区間)を JSON で出す。
// Playwright 同梱の ffmpeg は VP8 の読み込みと PNG の書き出しはできるが、fps / tile などのフィルタが無い。
// そのため 1 コマずつ -ss で書き出し、並べるのは Chrome で行う(H.264 の mp4 は読めないので変換前の webm を渡す)。
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const { launchChrome, findFfmpeg } = require("./chrome");

const THUMB_W = 480;

async function main() {
  const [video, out, stepArg, colsArg] = process.argv.slice(2);
  if (!video || !out) throw new Error("使い方: node video-sheet.js <動画.webm> <出力.png> [間隔秒] [列数]");
  if (!/\.webm$/i.test(video)) throw new Error("webm を渡してください(同梱の ffmpeg は H.264 の mp4 を読めません)");
  const step = Number(stepArg || 1), cols = Number(colsArg || 5);
  // 同梱の ffmpeg は版ごとに VP8・VP9 の片方しか読めないので、動画のコーデックを読める版を選ぶ
  const probe = spawnSync(findFfmpeg(), ["-hide_banner", "-i", video], { encoding: "utf8" }).stderr;
  const codec = (probe.match(/Video: (\w+)/) || [])[1];
  const ff = findFfmpeg(codec ? { decodes: codec } : {});
  const m = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error(`動画の長さを読めません: ${video}`);
  const duration = +m[1] * 3600 + +m[2] * 60 + +m[3];

  const times = [];
  for (let t = 0; t < duration; t += step) times.push(+t.toFixed(2));
  if (duration - times[times.length - 1] > 0.3) times.push(+Math.max(0, duration - 0.1).toFixed(2)); // 終わり方の確認用
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "video-sheet-"));
  const files = times.map((t, i) => {
    const f = path.join(tmp, `${String(i).padStart(4, "0")}.png`);
    const r = spawnSync(ff, ["-loglevel", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", `scale=${THUMB_W}:-1`, f]);
    return fs.existsSync(f) ? f : (r.stderr && console.error(String(r.stderr)), null);
  });

  // file:// だとキャンバスが cross-origin 扱いになり画素を読めない(同じコマの判定ができない)ため、ローカルの HTTP で配る
  const server = http.createServer((req, res) => {
    const i = Number(req.url.slice(1));
    if (req.url !== "/" && files[i]) { res.writeHead(200, { "Content-Type": "image/png" }); fs.createReadStream(files[i]).pipe(res); }
    else { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end('<!doctype html><body style="margin:0;background:#222"><canvas id="c"></canvas>'); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = await launchChrome({ port: 9460 + Math.floor(Math.random() * 30), viewport: { width: 1600, height: 1000 } });
  try {
    const ctx = await chrome.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const info = await page.evaluate(async ({ times, ok, cols, w }) => {
      const imgs = await Promise.all(times.map((_, i) => ok[i] ? new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = `/${i}`; }) : null));
      const first = imgs.find(Boolean);
      const h = first ? first.height : 300, lab = 26;
      const c = document.getElementById("c");
      c.width = cols * w; c.height = Math.ceil(times.length / cols) * (h + lab);
      const g = c.getContext("2d");
      g.fillStyle = "#222"; g.fillRect(0, 0, c.width, c.height);
      const s = document.createElement("canvas"); s.width = 64; s.height = 40;
      const sg = s.getContext("2d", { willReadFrequently: true });
      let prev = null; const same = [], missing = [];
      times.forEach((t, i) => {
        const x = (i % cols) * w, y = Math.floor(i / cols) * (h + lab);
        g.fillStyle = "#fff"; g.font = "bold 18px sans-serif"; g.fillText(`${t.toFixed(1)}s`, x + 6, y + 19);
        if (!imgs[i]) { missing.push(t); prev = null; return; }
        g.drawImage(imgs[i], x, y + lab, w, h);
        sg.drawImage(imgs[i], 0, 0, 64, 40);
        const px = sg.getImageData(0, 0, 64, 40).data;
        if (prev) { let d = 0; for (let k = 0; k < px.length; k += 4) d += Math.abs(px[k] - prev[k]); if (d / (px.length / 4) < 1) same.push(t); }
        prev = px;
      });
      return { sameAsPrevious: same, missing };
    }, { times, ok: files.map(Boolean), cols, w: THUMB_W });
    await page.locator("#c").screenshot({ path: out });
    console.log(JSON.stringify({ video, sheet: out, duration: +duration.toFixed(2), frames: times.length, ...info }, null, 2));
  } finally {
    server.close();
    await chrome.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
