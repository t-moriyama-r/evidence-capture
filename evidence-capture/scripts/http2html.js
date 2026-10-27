// API のリクエストと応答を 1 枚の HTML にする。画面の無い API の修正で、修正前後に応答がどう変わったかを撮るときに使う。
// 使い方: node http2html.js <response.txt> <out.html> --request "GET /api/items?q=a" [--request-body body.json] [--title "見出し"]
//   <response.txt> は `curl -si` の出力(ステータス行・ヘッダー・空行・本文)。本文が JSON なら整形して表示する。
//   JSON の各行は data-path 属性(例: "items.0.price")を持つので、capture.js の annotate で
//   "target": "[data-path=\"items.0.price\"]" と書けば、その行を枠で囲んで吹き出しを付けられる。
//   ほかに #request(リクエスト)・#status(ステータス行)・#headers・#body を target に使える。
// 修正前と修正後で同じリクエストを送り、それぞれをこのスクリプトで HTML にして、capture.js の url に file:/// で渡す。
// 出力先は一時ディレクトリにすること。認証のヘッダー(Authorization・Cookie)は書き出さない。
const fs = require("fs");

const args = process.argv.slice(2);
const [src, out] = args;
const opt = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []))[0];
const request = opt("--request");
if (!src || !out || !request) {
  console.error('使い方: node http2html.js <response.txt> <out.html> --request "GET /api/xxx" [--request-body body.json] [--title 見出し]');
  process.exit(1);
}
const title = opt("--title") || "";
const requestBody = opt("--request-body") ? fs.readFileSync(opt("--request-body"), "utf8") : "";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 証跡は公開リポジトリに貼られることがあるので、認証の値は伏せる
const SECRET_HEADERS = /^(authorization|cookie|set-cookie|x-xsrf-token|x-csrf-token):/i;

const raw = fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n");
// curl -si はリダイレクトや 100 Continue のたびにヘッダーの塊を出すので、最後の塊を応答として使う
const blocks = raw.split(/\n\n/);
let head = blocks[0], bodyStart = 1;
while (bodyStart < blocks.length && /^HTTP\/[\d.]+ \d{3}/.test(blocks[bodyStart])) head = blocks[bodyStart++];
const [statusLine, ...headerLines] = head.split("\n");
const body = blocks.slice(bodyStart).join("\n\n");
const headers = headerLines.map((h) => (SECRET_HEADERS.test(h) ? h.replace(/:.*/, ": (伏せた)") : h));

const STATUS_COLORS = { 2: "#2e7d32", 3: "#1565c0", 4: "#e65100", 5: "#d32f2f" };
const code = (statusLine.match(/ (\d)\d\d/) || [])[1];

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title || request)}</title><style>
body { margin: 0; padding: 24px; background: #f5f5f5; font: 14px/1.6 "Meiryo","Yu Gothic","Hiragino Sans",sans-serif; color: #222; }
h1 { font-size: 18px; margin: 0 0 16px; }
section { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
h2 { font-size: 13px; color: #757575; margin: 0 0 6px; }
pre { margin: 0; font: 13px/1.6 Consolas,"Courier New",monospace; white-space: pre-wrap; word-break: break-all; }
#status { font-weight: 700; color: ${STATUS_COLORS[code] || "#222"}; }
.line { display: block; }
</style></head><body>
${title ? `<h1>${esc(title)}</h1>` : ""}
<section><h2>リクエスト</h2><pre id="request">${esc(request)}${requestBody ? "\n\n" + esc(prettyText(requestBody)) : ""}</pre></section>
<section><h2>応答</h2><pre id="status">${esc(statusLine)}</pre><pre id="headers">${esc(headers.join("\n"))}</pre></section>
<section><h2>応答の本文</h2><pre id="body">${renderBody(body)}</pre></section>
</body></html>
`;
fs.writeFileSync(out, html);
console.log(out);

function prettyText(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// JSON を整形し、各行に data-path を付ける(注釈で特定の項目を指せるように)。JSON でなければそのまま出す
function renderBody(text) {
  let value;
  try { value = JSON.parse(text); } catch { return esc(text); }
  const lines = [];
  const line = (indent, path, s) => lines.push(`<span class="line" data-path="${esc(path)}">${"  ".repeat(indent)}${s}</span>`);
  const walk = (v, path, indent, prefix, comma) => {
    if (v !== null && typeof v === "object") {
      const isArr = Array.isArray(v), entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
      const [open, close] = isArr ? ["[", "]"] : ["{", "}"];
      if (!entries.length) return line(indent, path, `${prefix}${open}${close}${comma}`);
      line(indent, path, `${prefix}${open}`);
      entries.forEach(([k, x], i) => {
        const p = path === "" ? String(k) : `${path}.${k}`;
        walk(x, p, indent + 1, isArr ? "" : `${esc(JSON.stringify(k))}: `, i < entries.length - 1 ? "," : "");
      });
      line(indent, path, `${close}${comma}`);
    } else line(indent, path, `${prefix}${esc(JSON.stringify(v))}${comma}`);
  };
  walk(value, "", 0, "", "");
  return lines.join("");
}
