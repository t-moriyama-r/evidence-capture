// 修正前・修正後のスクショを左右に並べ、何が変わったかを添えた比較画像({name}_compare_{比較名}.png)を作る。
// capture.js で before / after を撮った後に実行する。動画はまとめない(修正前・修正後の動画をそれぞれ載せる)。
// 使い方: node compose.js <config.json>
//
// config.json の例:
// {
//   "outDir": "/tmp/evidence",              // capture.js と同じ出力先
//   "port": 9350,
//   "name": "ISSUE-123",                    // 出力ファイル名の接頭辞(英数字・ハイフン)
//   "title": "ISSUE-123 商品詳細の在庫表示",
//   "labels": { "before": "修正前", "after": "修正後", "unchanged": "修正前・修正不要" },  // 列見出し(省略時はこの値)
//   "compare": [
//     { "name": "out-of-stock", "title": "在庫ゼロの商品（商品コード A-100）",
//       "before": "before_out-of-stock.png", "after": "after_out-of-stock.png",   // outDir からの相対パスも可
//       "point": "在庫：空欄 → 「0」" },
//     { "name": "in-stock", "unchanged": true, ... }  // 変更がないことを確かめるケース。修正前の列見出しを緑の「修正前・修正不要」にする
//   ],
//   "layout": "column"                      // 修正前を上・修正後を下に並べる(省略時は左右)。CSV の表のような横長の画像は
//                                           // 左右だと縮んで読めないのでこちらにする。compare[] の要素ごとにも指定できる
// }
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { launchChrome } = require("./chrome");

const FONT = "Meiryo,'Yu Gothic','Hiragino Sans','Noto Sans CJK JP',sans-serif";
const LABELS = { before: "修正前", after: "修正後", unchanged: "修正前・修正不要" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function compareHtml(cfg, c, beforeUrl, afterUrl) {
  const L = { ...LABELS, ...cfg.labels };
  const column = (c.layout || cfg.layout) === "column";
  const col = (tag, color, url) => `<div class="col"><div class="tag" style="background:${color}">${esc(tag)}</div><img src="${url}"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f4f4f4;font-family:${FONT}}
    #wrap{display:inline-block;padding:20px 24px;background:#f4f4f4}
    .head{font-size:20px;font-weight:700;color:#222;margin-bottom:6px}
    .point{display:inline-block;margin:4px 0 14px;padding:8px 14px;background:#fffef5;border:3px solid #2e7d32;border-radius:6px;
      font-size:16px;font-weight:700;color:#222;box-shadow:0 3px 10px rgba(0,0,0,.2)}
    .row{display:flex;gap:${column ? "10px" : "24px"};align-items:flex-start;flex-direction:${column ? "column" : "row"}}
    .col{display:flex;flex-direction:column;gap:8px}
    .tag{align-self:flex-start;color:#fff;font-size:18px;font-weight:700;padding:4px 16px;border-radius:4px}
    img{max-width:${column ? "none" : "900px"};border:1px solid #bbb;box-shadow:0 2px 8px rgba(0,0,0,.15)}
    .arrow{align-self:${column ? "flex-start;margin-left:40px" : "center"};font-size:44px;color:#555}
  </style></head><body><div id="wrap">
    <div class="head">${esc(cfg.title)}${c.title ? "　／　" + esc(c.title) : ""}</div>
    ${c.point ? `<div class="point">${esc(c.point)}</div>` : ""}
    <div class="row">${c.unchanged ? col(L.unchanged, "#2e7d32", beforeUrl) : col(L.before, "#d32f2f", beforeUrl)}<div class="arrow">${column ? "⬇" : "➡"}</div>${col(L.after, "#2e7d32", afterUrl)}</div>
  </div></body></html>`;
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const out = cfg.outDir;
  const url = (p) => pathToFileURL(path.isAbsolute(p) ? p : path.join(out, p)).href;
  const chrome = await launchChrome({ port: cfg.port || 9350, viewport: { width: 2000, height: 1000 } });
  const results = [];
  try {
    for (const c of cfg.compare || []) {
      const html = path.join(out, `.compare-${c.name}.html`);
      fs.writeFileSync(html, compareHtml(cfg, c, url(c.before), url(c.after)));
      const ctx = await chrome.newContext({ viewport: { width: 2000, height: 1000 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
      const dest = path.join(out, `${cfg.name}_compare_${c.name}.png`);
      await page.locator("#wrap").screenshot({ path: dest });
      await ctx.close();
      fs.rmSync(html);
      results.push({ compare: dest });
    }
  } finally {
    await chrome.close();
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
