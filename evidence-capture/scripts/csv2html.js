// CSV を列記号(A, B, ...)付きの表 HTML にする。注釈モードで CSV 出力結果を画像にするときに使う。
// 使い方: node csv2html.js <in.csv> <out.html> [--title "見出し"] [--mark G-P:red] [--mark X-AB:blue] [--max-rows 20]
//   --mark で指定した列範囲は薄く色付けし、範囲全体(列記号〜最終行)を覆う要素 #mark-1, #mark-2 ... を作る。
//   capture.js の annotate で "target": "#mark-1" と書けば、その列範囲を枠で囲んで吹き出しを付けられる。
// 文字コードは UTF-8(BOM 可)前提。Shift_JIS の CSV は事前に iconv で変換する。出力先は一時ディレクトリにすること。
const fs = require("fs");

const COLORS = { red: "#d32f2f", blue: "#1565c0", green: "#2e7d32", orange: "#e65100", gray: "#757575" };
const args = process.argv.slice(2);
const [src, out] = args;
if (!src || !out) {
  console.error("使い方: node csv2html.js <in.csv> <out.html> [--title 見出し] [--mark G-P:red] [--max-rows 20]");
  process.exit(1);
}
const opt = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const title = opt("--title")[0] || "";
const maxRows = Number(opt("--max-rows")[0] || 20);

// 列記号 ⇔ 0 始まりの列番号
const letter = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const index = (l) => [...l.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const marks = opt("--mark").map((m) => {
  const [range, c = "red"] = m.split(":");
  const [from, to = from] = range.split("-");
  return { from: index(from), to: index(to), color: COLORS[c] || c };
});

// ダブルクォート対応の最小限の CSV パーサ
function parse(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const rows = parse(fs.readFileSync(src, "utf8").replace(/^﻿/, "")).slice(0, maxRows + 1);
const cols = Math.max(...rows.map((r) => r.length));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const markOf = (i) => marks.findIndex((m) => i >= m.from && i <= m.to);
const tint = (i) => { const k = markOf(i); return k < 0 ? "" : ` style="background:${marks[k].color}14" data-mark="${k + 1}"`; };

let h = `<!doctype html><meta charset="utf-8"><title>${esc(title || src)}</title><style>
body{margin:0;padding:20px;background:#fff;font:12px/1.4 "Meiryo","Yu Gothic","Hiragino Sans","Noto Sans CJK JP",sans-serif}
table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:3px 6px;white-space:nowrap}
th{background:#eee;color:#555;font-weight:400}tr.hd td{font-weight:700;background:#f7f7f7}
.cap{font-weight:700;font-size:15px;margin:0 0 10px}</style>
${title ? `<div class="cap">${esc(title)}</div>` : ""}<table id="csv">`;
h += "<tr>" + Array.from({ length: cols }, (_, i) => `<th${tint(i)}>${letter(i)}</th>`).join("") + "</tr>";
rows.forEach((r, ri) => {
  h += `<tr${ri === 0 ? ' class="hd"' : ""}>` + Array.from({ length: cols }, (_, i) => `<td${tint(i)}>${esc(r[i])}</td>`).join("") + "</tr>";
});
h += `</table><script>
// 列範囲ごとに、範囲全体を覆う透明な要素 #mark-N を作る(注釈の target 用)
const groups = {};
document.querySelectorAll("[data-mark]").forEach((c) => (groups[c.dataset.mark] ||= []).push(c.getBoundingClientRect()));
for (const [k, rs] of Object.entries(groups)) {
  const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
  const d = document.createElement("div");
  d.id = "mark-" + k;
  Object.assign(d.style, { position: "absolute", left: x + scrollX + "px", top: y + scrollY + "px",
    width: Math.max(...rs.map((r) => r.right)) - x + "px", height: Math.max(...rs.map((r) => r.bottom)) - y + "px", pointerEvents: "none" });
  document.body.appendChild(d);
}
</script>`;
fs.writeFileSync(out, h);
console.log(JSON.stringify({ out, rows: rows.length - 1, cols, marks: marks.map((m, k) => ({ id: `#mark-${k + 1}`, from: letter(m.from), to: letter(m.to) })) }));
