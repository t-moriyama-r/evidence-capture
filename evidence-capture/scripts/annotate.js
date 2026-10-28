// 画面に注釈（枠線・吹き出し・矢印など）を描くブラウザ側ヘルパー。capture.js が page.addScriptTag で注入する。
//
// 注釈モード（現状の画面に説明を書き込んだ資料）:
//   window.__annot.apply(spec)          … 全注釈を描き、切り抜き範囲を返す
// 証跡取得モード（修正前後。capture.js が録画の区間に合わせて呼ぶ）:
//   window.__annot.showBanner(spec, o)  … 帯（修正前/修正後の札・見出し・何を見る画面かの一文）を出す
//   window.__annot.avoid(rects)         … 帯が rects（ビューポート座標）を隠すなら、帯を画面下端へ移す
//   window.__annot.draw(spec)           … 枠・番号・吹き出し・スポットライトを一度に描く
//   window.__annot.pulse()              … 枠を数回脈打たせる（録画の開始時に呼んで目を引く）
//   window.__annot.shot()               … 帯を切り抜き範囲の上に寄せ、スクショ用の切り抜き範囲を返す
//   window.__annot.undock()             … shot() で寄せた帯を元の固定表示に戻す
//   window.__annot.prepareEnter()       … 画面を暗転させ、帯を画面外に置く（録画開始の直前に呼ぶ）
//   window.__annot.enter()              … 暗転を明けて帯をスライドインさせる（観点が変わったことを示す）
//   window.__annot.leave()              … 暗転させる（次の観点へ移る前に呼ぶ）
//   window.__annot.cursorTo(x, y)       … マウスカーソルを (x, y)（ビューポート座標）へ動かす
//   window.__annot.clickMark()          … カーソル位置にクリックの波紋を出す
//   window.__annot.hideCursor()         … カーソルを消す
//
// spec は capture.js の pages[] の要素と同じ形:
// {
//   "title": "在庫ゼロの商品（商品コード A-100）",     // 帯に小さく出す見出し（証跡取得モード）
//   "caption": "在庫表示が空欄なのを修正したい",       // 帯に大きく出す一文。何を見る画面かを短く書く（証跡取得モード）
//   ※ 修正前の期待値と誤りは帯に出さず、吹き出しに「期待値は〇〇だが、△△になっている」と書く
//   ※ 前提条件(どういうデータか)は capture.js の premise で、検索の間と、画面が変わって前提のデータが見えた時点ごとに枠と吹き出しで出す(showPremise)
//   "annotate": [                                  // 対象要素を枠で囲み、横に吹き出しを付ける
//     { "target": "table tr", "text": "0期",       // target に一致する要素のうち、text と完全一致するセル/文字を含む最初の要素
//       "color": "red", "note": "<b>0期</b>：年度の先頭", "pos": "right", "x": 1250, "width": 360, "fill": true,
//       "cells": [ { "col": 5, "label": "申込" }, { "text": "0", "nth": 2 } ] }  // 枠の中で吹き出しが指す数字を円で囲む（下記）
//   ],
//   ※ cells: 行など広い枠の中で、吹き出しが述べる値がどれかを円で示す。col は枠内の td/th を左から数えた何列目か（1始まり）、
//     text はセルの文字との完全一致（同じ文字が並ぶなら nth で何番目か。1始まり）。数字のような短い値は col のほうが取り違えない。
//     label を書くと円の上に小さく項目名を出す（列見出しが切り抜きの外にあるとき）
//   "notes": [ { "html": "■ 現状 ...", "color": "red", "width": 700 } ],  // 対象の下に横並びで置く説明
//   "clip": ["table"],                             // 切り抜きに必ず含める要素（省略時は注釈の対象と吹き出しだけ）
//   "numbered": true,                              // 枠と吹き出しに番号を振る（証跡取得モードは注釈が2つ以上なら既定で振る）
//   "spotlight": true,                             // 対象以外を暗くする（証跡取得モードは既定で有効）
// }
// 色名: red(問題・削除) / blue(残す・修正) / green(期待値・正常) / orange(注意・範囲外) / gray(補足)。#rrggbb も可
window.__annot = (() => {
  const COLORS = { red: "#d32f2f", blue: "#1565c0", green: "#2e7d32", orange: "#e65100", gray: "#757575" };
  const FONT = '"Meiryo","Yu Gothic","Hiragino Sans","Noto Sans CJK JP",sans-serif';
  const color = (c) => COLORS[c] || c || COLORS.red;
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  };
  const union = (rs) => {
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
    return { x, y, w: x2 - x, h: y2 - y };
  };
  const add = (el) => { el.classList.add("__annot"); document.body.appendChild(el); return el; };
  // 切り抜き範囲に含める矩形（draw / apply で集め、shot / apply の最後で使う）
  let parts = [];

  function ensureStyle() {
    if (document.getElementById("__annot-style")) return;
    const s = document.createElement("style");
    s.id = "__annot-style";
    s.textContent = `
      @keyframes __annotPulse { 0% { box-shadow: 0 0 0 0 var(--annot-c); } 80% { box-shadow: 0 0 0 16px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
      .__annot-pulse { animation: __annotPulse 1.1s ease-out 3; }
      @keyframes __annotRipple { from { transform: translate(-50%,-50%) scale(.3); opacity: .9; } to { transform: translate(-50%,-50%) scale(1.6); opacity: 0; } }
      .__annot-banner { transition: top .45s ease-in-out, transform .5s ease-out; }
      .__annot-cover { position: fixed; inset: 0; background: #000; z-index: 2147483646; pointer-events: none; transition: opacity .4s; }
      .__annot-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transition: left .35s ease-in-out, top .35s ease-in-out, opacity .3s; }
    `;
    document.head.appendChild(s);
  }

  function find(target, text) {
    const els = [...document.querySelectorAll(target)];
    if (text == null) return els[0];
    // 子孫に text と完全一致する葉要素を持つ最初の要素（表の行を名称で特定する用途）
    return els.find((el) => [el, ...el.querySelectorAll("*")].some((n) => n.children.length === 0 && n.textContent.trim() === text));
  }
  // 枠の対象 el の中から、円で囲むセルを探す（cells[] の1件。書式は冒頭コメント参照）
  function findCell(el, c) {
    const cells = [...el.querySelectorAll("td, th")];
    if (c.col != null) return cells[c.col - 1];
    const pool = cells.length ? cells : [...el.querySelectorAll("*")].filter((n) => n.children.length === 0);
    return pool.filter((n) => n.textContent.trim() === String(c.text))[(c.nth || 1) - 1];
  }
  // セルの文字の範囲（セルが横に広くても、数字そのものを囲めるように）。文字がなければセル全体
  function textRect(cell) {
    const rg = document.createRange();
    rg.selectNodeContents(cell);
    const r = rg.getBoundingClientRect();
    return r.width && r.height ? { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } : rect(cell);
  }
  function ring(r, c, label) {
    // 数字に線がかからないよう余白を取り、1桁でも潰れた楕円にならないよう最小の大きさを持たせる
    const w = Math.max(r.w + 18, 30), h = Math.max(r.h + 12, 26);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "absolute", left: cx - w / 2 + "px", top: cy - h / 2 + "px", width: w + "px", height: h + "px",
      border: `3px solid ${c}`, borderRadius: "50%", boxSizing: "border-box",
      boxShadow: "0 0 0 2px #fff", zIndex: 99999, pointerEvents: "none",
    });
    d.style.setProperty("--annot-c", c + "aa");
    d.classList.add("__annot-box", "__annot-mark");
    add(d);
    const out = [rect(d)];
    if (label) {
      const t = document.createElement("div");
      Object.assign(t.style, {
        position: "absolute", left: cx + "px", top: cy - h / 2 - 4 + "px", transform: "translate(-50%,-100%)",
        padding: "1px 6px", background: c, color: "#fff", borderRadius: "4px", whiteSpace: "nowrap",
        font: `700 12px/1.4 ${FONT}`, zIndex: 99999, pointerEvents: "none",
      });
      t.textContent = label;
      t.classList.add("__annot-mark");
      add(t);
      out.push(rect(t));
    }
    return out;
  }
  // 番号の丸。枠と吹き出しの対応を示す
  function badgeHtml(n, c) {
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-right:6px;` +
      `border-radius:50%;background:${c};color:#fff;font:700 14px/1 ${FONT};vertical-align:-5px">${n}</span>`;
  }
  function box(r, c, fill, num) {
    // アプリ自身の入力エラー枠と見分けられるよう、対象より少し外側に角丸で描く。
    // 画面の端に接した要素(余白の無い body の中身など)では外側に出した分がページの幅を広げ、
    // アプリに無い横スクロールが証跡に映るので、左右はページの幅の中に収める(画面より横長の表は、その表の幅まで)
    const pageW = document.documentElement.scrollWidth;
    const left = Math.max(0, r.x - 6), right = Math.min(pageW, r.x + r.w + 6);
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "absolute", left: left + "px", top: r.y - 6 + "px", width: right - left + "px", height: r.h + 12 + "px",
      border: `3px solid ${c}`, borderRadius: "6px", background: fill ? c + "1f" : "transparent",
      boxSizing: "border-box", zIndex: 99998, pointerEvents: "none",
    });
    d.style.setProperty("--annot-c", c + "aa");
    d.classList.add("__annot-box", "__annot-mark");
    add(d);
    if (num != null) {
      const b = document.createElement("div");
      b.innerHTML = badgeHtml(num, c);
      Object.assign(b.style, { position: "absolute", left: r.x - 20 + "px", top: r.y - 20 + "px", zIndex: 99999, pointerEvents: "none" });
      b.firstChild.style.boxShadow = "0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.35)";
      b.firstChild.style.margin = "0";
      b.classList.add("__annot-mark");
      add(b);
    }
    return d;
  }
  function note(x, y, w, html, c, num) {
    const d = document.createElement("div");
    Object.assign(d.style, {
      // 幅の指定がなければ文字に合わせる（短文が変な位置で折り返さないように）。スマホ幅では右端を越えると
      // ページに横スクロールが出て、横スクロールの有無を見せたい証跡と紛れるので、drawOne が左右に 10px・20px を
      // 空けて寄せ直しても画面に収まる幅までにする
      position: "absolute", left: x + "px", top: y + "px",
      ...(w ? { width: w + "px" } : { width: "max-content", maxWidth: Math.max(200, Math.min(460, document.documentElement.clientWidth - 30)) + "px" }),
      background: "#fffef5", border: `3px solid ${c}`, borderRadius: "6px", padding: "8px 12px", boxSizing: "border-box",
      font: `600 14px/1.55 ${FONT}`, color: "#222",
      boxShadow: "0 3px 10px rgba(0,0,0,.25)", zIndex: 99999, pointerEvents: "none",
    });
    d.innerHTML = (num != null ? badgeHtml(num, c) : "") + html;
    d.classList.add("__annot-mark");
    return add(d);
  }
  function arrow(x1, y1, x2, y2, c) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    Object.assign(svg.style, { position: "absolute", left: 0, top: 0, overflow: "visible", zIndex: 99999, pointerEvents: "none" });
    svg.setAttribute("width", "1"); svg.setAttribute("height", "1");
    const id = "ah" + Math.random().toString(36).slice(2);
    svg.innerHTML = `<defs><marker id="${id}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker></defs>` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="3" marker-end="url(#${id})"/>`;
    svg.classList.add("__annot");
    document.body.appendChild(svg);
  }
  // 対象以外を暗くする。複数の対象を同時に明るく抜ける
  function spotlight(rs) {
    if (!rs.length) return;
    const W = document.documentElement.scrollWidth, H = document.documentElement.scrollHeight;
    const holes = rs.map((r) => `M${r.x - 10},${r.y - 10} h${r.w + 20} v${r.h + 20} h${-(r.w + 20)} Z`).join(" ");
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    Object.assign(svg.style, { position: "absolute", left: 0, top: 0, zIndex: 99997, pointerEvents: "none" });
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    svg.innerHTML = `<path fill-rule="evenodd" fill="rgba(0,0,0,.32)" d="M0,0 H${W} V${H} H0 Z ${holes}"/>`;
    svg.classList.add("__annot");
    document.body.appendChild(svg);
  }

  // 注釈1件（枠・番号・吹き出し・矢印）を描き、切り抜き範囲に含める矩形を返す
  function drawOne(a, el, num) {
    const c = color(a.color), r = rect(el);
    const out = [r];
    box(r, c, a.fill !== false, num);
    for (const cell of a.cells || []) out.push(...ring(textRect(findCell(el, cell)), c, cell.label));
    if (!a.note) return out;
    const w = a.width, pos = a.pos || "right";
    // 吹き出しの位置。right は対象の右端ではなく、表の行のように横長の対象でも重なりすぎない位置（x 指定可）に置く
    let n;
    if (pos === "below") n = note(a.x ?? r.x, r.y + r.h + 28, w, a.note, c, num);
    else if (pos === "above") { n = note(a.x ?? r.x, 0, w, a.note, c, num); n.style.top = r.y - rect(n).h - 28 + "px"; }
    else if (pos === "left") { n = note(0, r.y - 4, w, a.note, c, num); n.style.left = (a.x ?? r.x - rect(n).w - 50) + "px"; }
    else n = note(a.x ?? r.x + r.w + 50, r.y - 4, w, a.note, c, num);
    // 画面の右端からはみ出す場合は左に寄せる。画面より横長の表の右側にある対象は、対象の右端までははみ出してよい
    // （切り抜きはページ全体から撮るため。画面幅で寄せると吹き出しが対象から離れる）
    const right = Math.max(scrollX + document.documentElement.clientWidth - 20, r.x + r.w);
    if (a.x == null && rect(n).x + rect(n).w > right) n.style.left = Math.max(scrollX + 10, right - rect(n).w) + "px";
    const nr = rect(n);
    out.push(nr);
    // 吹き出しが対象と重なる（横長の行など）場合は矢印を描かない
    const overlap = nr.x < r.x + r.w && nr.x + nr.w > r.x && nr.y < r.y + r.h && nr.y + nr.h > r.y;
    if (overlap) return out;
    // 上下の矢印は、先端を必ず対象の幅の中に置く（吹き出しが寄せられて対象とずれても、対象を指すように斜めにする）
    const within = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const tipX = within(nr.x + 40, r.x + 20, r.x + r.w - 20), tailX = within(tipX, nr.x + 20, nr.x + nr.w - 20);
    if (pos === "below") arrow(tailX, nr.y - 2, tipX, r.y + r.h + 8, c);
    else if (pos === "above") arrow(tailX, nr.y + nr.h + 2, tipX, r.y - 8, c);
    else if (pos === "left") arrow(nr.x + nr.w + 2, r.y + r.h / 2, r.x - 10, r.y + r.h / 2, c);
    else arrow(nr.x - 2, r.y + r.h / 2, r.x + r.w + 10, r.y + r.h / 2, c);
    return out;
  }
  function drawNotes(spec) {
    if (!(spec.notes || []).length) return;
    // 下部の説明は、ここまでの範囲の下に左から横並びで置く
    const base = parts.length ? union(parts) : { x: 20, y: 20, w: 0, h: 0 };
    let x = base.x + 10;
    const y = base.y + base.h + 30;
    for (const nt of spec.notes) {
      const nr = rect(note(x, y, nt.width || 600, nt.html, color(nt.color)));
      parts.push(nr);
      x = nr.x + nr.w + 30;
    }
  }
  function resolve(spec) {
    const missing = [];
    const clipParts = [];
    for (const sel of spec.clip || []) {
      const el = document.querySelector(sel);
      if (el) clipParts.push(rect(el)); else missing.push(sel);
    }
    const items = [];
    for (const a of spec.annotate || []) {
      const el = find(a.target, a.text);
      if (!el) { missing.push(a.target + (a.text ? ` (text=${a.text})` : "")); continue; }
      const lost = (a.cells || []).filter((c) => !findCell(el, c));
      if (lost.length) { missing.push(...lost.map((c) => `${a.target} の円 ${c.col != null ? `col=${c.col}` : `text=${c.text}`}`)); continue; }
      items.push({ a, el });
    }
    return { missing, clipParts, items };
  }
  function drawAll(spec, { numbered, spot }) {
    const { missing, clipParts, items } = resolve(spec);
    if (missing.length) return missing;
    parts.push(...clipParts);
    items.forEach(({ a, el }, i) => parts.push(...drawOne(a, el, numbered ? i + 1 : null)));
    if (spot) spotlight(items.map(({ el }) => rect(el)));
    drawNotes(spec);
    return missing;
  }
  // 帯を切り抜き範囲の上（入らなければ下）に置き直し、切り抜き範囲（CSS ピクセル）を返す
  function finish() {
    if (!parts.length) return null;
    const ps = [...parts];
    let u = union(ps);
    const b = document.querySelector(".__annot-banner");
    if (b) {
      b.dataset.fixedCss = b.style.cssText;
      // 帯の移動アニメーションを止めてから置く(動いている途中の位置を測ってしまうため)
      Object.assign(b.style, { transition: "none", position: "absolute", right: "auto", left: u.x + "px", width: u.w + "px", top: "0px" });
      // 対象がページ最上部にある(モーダル等)と上に置く余白がなく帯が切れるので、そのときは対象の下に置く
      const above = u.y - rect(b).h - 14;
      b.style.top = (above >= 0 ? above : u.y + u.h + 14) + "px";
      ps.push(rect(b));
    }
    u = union(ps);
    // 端の項目名が欠けないよう少し広めに取る
    const pad = 30;
    return { x: Math.max(0, u.x - pad), y: Math.max(0, u.y - pad), width: u.w + pad * 2, height: u.h + pad * 2 };
  }
  function reset() {
    ensureStyle();
    document.querySelectorAll(".__annot").forEach((e) => e.remove());
    parts = [];
  }

  function apply(spec) {
    reset();
    const missing = drawAll(spec, { numbered: spec.numbered === true, spot: spec.spotlight === true });
    return { clip: missing.length ? null : finish(), dpr: devicePixelRatio, missing };
  }

  // 画面上部の帯: [修正前/修正後] 見出し ／ 何を見る画面かの一文
  // pos: "auto"（既定。隠す対象があれば下端へ移す） / "top" / "bottom"（固定）。
  // keepEdge は操作で画面が再読み込みされたときの出し直しで、それまでの位置（下端へ移したか）を引き継ぐ
  function showBanner(spec, { banner, pos = "auto", keepEdge = false } = {}) {
    reset();
    scrollTo({ top: 0 });
    edgeFixed = pos !== "auto";
    edge = pos === "bottom" || (keepEdge && !edgeFixed && savedEdge() === "bottom") ? "bottom" : "top";
    saveEdge();
    if (banner || spec.title || spec.caption) {
      const d = document.createElement("div");
      const c = color(banner?.color || "gray");
      Object.assign(d.style, {
        position: "fixed", left: 0, right: 0, top: 0, zIndex: 100000, display: "flex", alignItems: "center", gap: "14px",
        padding: "10px 18px", background: "rgba(25,25,25,.9)", color: "#fff", font: `700 20px/1.4 ${FONT}`,
        boxShadow: "0 2px 10px rgba(0,0,0,.4)", pointerEvents: "none",
      });
      d.innerHTML =
        (banner ? `<span style="flex:none;padding:4px 14px;border-radius:4px;background:${c};font-size:20px">${banner.text}</span>` : "") +
        `<span style="display:flex;flex-direction:column">` +
        (spec.title ? `<span style="font-size:13px;font-weight:600;opacity:.8">${spec.title}</span>` : "") +
        (spec.caption ? `<span>${spec.caption}</span>` : "") + `</span>`;
      d.classList.add("__annot-banner");
      add(d);
      placeBanner(d, false);
    }
  }
  // 帯の位置。上端の帯は、ページ最上部のツールバーやメニューを覆ってしまう。対象が帯に隠れるときは帯のほうを
  // 下端へ移す（画面を動かしたり帯を透かしたりすると、対象の見え方そのものが変わってしまうため）。
  // 1 画面の中で帯が上下を行き来すると目障りなので、下端へ移したらその画面の間は戻さない
  let edge = "top", edgeFixed = false;
  const EDGE_KEY = "__annotBannerEdge";
  function savedEdge() { try { return sessionStorage.getItem(EDGE_KEY); } catch { return null; } }
  function saveEdge() { try { sessionStorage.setItem(EDGE_KEY, edge); } catch {} }
  function placeBanner(b, animate) {
    if (!animate) b.style.transition = "none";
    b.style.top = edge === "top" ? "0px" : innerHeight - b.offsetHeight + "px";
    if (!animate) { void b.offsetWidth; b.style.transition = ""; }
    placeTimer();
  }
  function avoid(rs, { instant = false } = {}) {
    const b = document.querySelector(".__annot-banner");
    if (!b || edgeFixed || edge === "bottom") return edge;
    const h = b.offsetHeight + 8;
    // 帯の帯域（上端・下端）と重なる面積。上下どちらにも重なるなら、重なりの小さいほうに置く
    const covered = (top, bottom) => rs.reduce((sum, r) =>
      sum + Math.max(0, Math.min(r.y + r.height, bottom) - Math.max(r.y, top)) * Math.max(0, r.width), 0);
    const atTop = covered(0, h);
    if (!atTop || covered(innerHeight - h, innerHeight) >= atTop) return edge;
    edge = "bottom";
    saveEdge();
    placeBanner(b, !instant);
    return edge;
  }
  // 描いた枠・番号・吹き出しが帯に隠れないようにする
  function avoidMarks() {
    return avoid([...document.querySelectorAll(".__annot-mark")].map((e) => e.getBoundingClientRect()));
  }
  function draw(spec) {
    ensureStyle();
    const missing = drawAll(spec, {
      numbered: spec.numbered ?? (spec.annotate || []).length > 1,
      spot: spec.spotlight !== false,
    });
    if (!missing.length) avoidMarks();
    return { missing };
  }
  // 前提条件の枠と吹き出し。p は1件か配列。前の前提を消してから描き、次の showPremise か clearPremise で消える
  // (常時出すと画面の情報量が増えるため。検索した時点と、画面が変わって前提のデータが見えた時点ごとに示す)
  function showPremise(p) {
    ensureStyle();
    clearPremise();
    const before = new Set(document.querySelectorAll(".__annot"));
    const missing = [];
    for (const x of Array.isArray(p) ? p : [p]) {
      const el = find(x.target, x.text);
      if (!el) { missing.push(x.text ? `${x.target}「${x.text}」` : x.target); continue; }
      drawOne({ color: x.color || "blue", pos: x.pos || "below", width: x.width || 560, x: x.x, cells: (x.cells || []).filter((c) => findCell(el, c)), note: `<b>前提</b>：${x.note}` }, el, null);
    }
    document.querySelectorAll(".__annot").forEach((e) => { if (!before.has(e)) e.classList.add("__annot-premise"); });
    avoidMarks();
    return { missing };
  }
  function clearPremise() {
    document.querySelectorAll(".__annot-premise").forEach((e) => e.remove());
  }
  function pulse() {
    document.querySelectorAll(".__annot-box").forEach((b) => {
      b.classList.remove("__annot-pulse");
      void b.offsetWidth;
      b.classList.add("__annot-pulse");
    });
  }
  function shot() {
    return { clip: finish(), dpr: devicePixelRatio };
  }
  // スクショ用に寄せた帯を、固定表示に戻す
  function undock() {
    const b = document.querySelector(".__annot-banner");
    if (!b?.dataset.fixedCss) return;
    // 戻す動きを録画に映さないよう、アニメーションなしで戻す
    b.style.cssText = b.dataset.fixedCss;
    b.style.transition = "none";
    void b.offsetWidth;
    b.style.transition = "";
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 観点（ユースケース）の切り替わりが分かるよう、暗転から明けて帯をスライドインさせる
  // cover: false なら暗転せず、帯のスライドインだけを行う（動画の最初の画面。最初のコマがサムネイルになるため暗くしない）
  function prepareEnter({ cover = true } = {}) {
    ensureStyle();
    clearTimer();
    let c = document.querySelector(".__annot-cover");
    if (cover) {
      if (!c) { c = document.createElement("div"); c.className = "__annot-cover"; document.documentElement.appendChild(c); }
      c.style.transition = "none";
      c.style.opacity = "1";
    } else {
      c?.remove();
    }
    const b = document.querySelector(".__annot-banner");
    if (b) { b.style.transition = "none"; b.style.transform = edge === "top" ? "translateY(-110%)" : "translateY(110%)"; }
  }
  async function enter() {
    const c = document.querySelector(".__annot-cover");
    const b = document.querySelector(".__annot-banner");
    void document.body.offsetWidth;
    if (c) { c.style.transition = "opacity .4s"; c.style.opacity = "0"; await wait(250); }
    if (b) { b.style.transition = ""; b.style.transform = "translateY(0)"; }
    await wait(550);
    c?.remove();
  }
  async function leave() {
    ensureStyle();
    const c = document.createElement("div");
    c.className = "__annot-cover";
    c.style.opacity = "0";
    document.documentElement.appendChild(c);
    void c.offsetWidth;
    c.style.opacity = "1";
    await wait(450);
  }
  // 操作の様子が分かるよう、マウスカーソルとクリックの波紋を出す
  function cursorEl() {
    ensureStyle();
    let k = document.querySelector(".__annot-cursor");
    if (!k) {
      k = document.createElement("div");
      k.className = "__annot-cursor";
      k.innerHTML = `<svg width="28" height="34" viewBox="0 0 28 34"><path d="M2 2 L2 28 L9 21 L14 32 L19 30 L14 19 L24 19 Z"
        fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>`;
      Object.assign(k.style, { left: innerWidth / 2 + "px", top: innerHeight / 2 + "px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,.45))" });
      document.documentElement.appendChild(k);
      void k.offsetWidth;
    }
    k.style.opacity = "1";
    return k;
  }
  async function cursorTo(x, y) {
    const k = cursorEl();
    k.style.left = x - 2 + "px";
    k.style.top = y - 2 + "px";
    await wait(400);
  }
  async function clickMark() {
    const k = cursorEl();
    const r = document.createElement("div");
    Object.assign(r.style, {
      position: "fixed", left: parseFloat(k.style.left) + 2 + "px", top: parseFloat(k.style.top) + 2 + "px", width: "44px", height: "44px",
      borderRadius: "50%", border: "4px solid #ff9800", zIndex: 2147483646, pointerEvents: "none",
      animation: "__annotRipple .6s ease-out forwards",
    });
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 700);
    await wait(250);
  }
  function hideCursor() {
    const k = document.querySelector(".__annot-cursor");
    if (k) k.style.opacity = "0";
  }
  // 画面右上のタイマー。操作(反映ボタンの押下など)の直前に始め、画面が期待の状態になった瞬間に止めて、その秒数を出し続ける。
  // 「何秒で変わるか」が論点の証跡で、動画の編集(詰めた区間)に左右されない実測の時間を画面に残すためのもの。
  // 判定はページ内で描画のたびに行う(Playwright から間隔を空けて調べると、その間隔ぶん誤差が出る)
  let timer = null;
  function startTimer(o) {
    ensureStyle();
    document.querySelector(".__annot-timer")?.remove();
    const d = document.createElement("div");
    d.className = "__annot-timer";
    Object.assign(d.style, {
      position: "fixed", right: "24px", zIndex: 100001,
      background: "rgba(25,25,25,.92)", color: "#fff", padding: "10px 18px", borderRadius: "8px", minWidth: "260px",
      font: `700 15px/1.4 ${FONT}`, boxShadow: "0 3px 12px rgba(0,0,0,.35)", pointerEvents: "none", textAlign: "right",
    });
    document.documentElement.appendChild(d);
    placeTimer();
    const max = o.maxMs ?? 15000, u = o.until || {};
    // 数え始めは、ページが実際にクリックを受け取った瞬間(Playwright はクリックの前にボタンが止まるのを待つので、
    // 呼んだ時点から数えるとその待ちまで測ってしまう)
    timer = { t0: null, done: false, value: null };
    const inView = (sel) => {
      if (!sel) return true;
      const e = document.querySelector(sel);
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    };
    // until: { selector, state: "gone" | "present" | "text" | "notText", value, whileVisible }
    // whileVisible は、画面がその要素を映している間だけ判定する(画面外の要素が描かれない一覧で、画面が移っただけを「消えた」と取らない)
    // 変化と同時に画面が移る(保存後に画面を戻すアプリなど)こともあるので、直前の描画で映っていれば判定する
    let seenBefore = false;
    const met = () => {
      const seen = inView(u.whileVisible);
      const ok = seen || seenBefore;
      seenBefore = seen;
      if (!ok) return false;
      const e = document.querySelector(u.selector);
      if (u.state === "gone") return !e;
      if (u.state === "present") return Boolean(e);
      if (u.state === "text") return Boolean(e) && e.textContent.includes(u.value);
      if (u.state === "notText") return Boolean(e) && !e.textContent.includes(u.value);
      return false;
    };
    const render = (sec, end) => {
      d.innerHTML = `<div style="font-size:13px;opacity:.85">${o.label || "経過時間"}</div>` +
        `<div style="font:700 36px/1.15 Consolas,'Courier New',monospace">${sec.toFixed(2)} 秒</div>` +
        (end ? `<div style="font-size:14px;color:${end.c}">${end.text}</div>` : "");
      if (end) d.style.boxShadow = `0 0 0 3px ${end.c}, 0 3px 12px rgba(0,0,0,.35)`;
    };
    const tick = () => {
      const sec = (performance.now() - timer.t0) / 1000;
      if (met()) {
        Object.assign(timer, { done: true, value: sec });
        return render(sec, { c: "#8fe08f", text: o.doneText || "ここで変わった(タイマー停止)" });
      }
      if (sec * 1000 >= max) {
        Object.assign(timer, { done: true, value: null });
        return render(sec, { c: "#ffb0a0", text: `${max / 1000} 秒たっても変わらない` });
      }
      render(sec);
      requestAnimationFrame(tick);
    };
    const own = timer;
    render(0);
    addEventListener("pointerdown", (ev) => {
      if (timer !== own) return;
      own.t0 = ev.timeStamp;
      tick();
    }, { capture: true, once: true });
  }
  // タイマーは帯のすぐ内側（帯が上端なら帯の下、下端なら帯の上）に置く
  function placeTimer() {
    const d = document.querySelector(".__annot-timer");
    if (!d) return;
    const b = document.querySelector(".__annot-banner");
    const h = b ? b.offsetHeight : 0;
    Object.assign(d.style, edge === "top" ? { top: h + 12 + "px", bottom: "auto" } : { top: "auto", bottom: h + 12 + "px" });
  }
  function timerState() {
    return timer && { done: timer.done, value: timer.value, elapsed: timer.t0 == null ? 0 : performance.now() - timer.t0 };
  }
  function clearTimer() {
    document.querySelector(".__annot-timer")?.remove();
    timer = null;
  }
  return { apply, showBanner, avoid, draw, showPremise, clearPremise, pulse, shot, undock, prepareEnter, enter, leave, cursorTo, clickMark, hideCursor, startTimer, timerState, clearTimer, rect, union, find, color };
})();
