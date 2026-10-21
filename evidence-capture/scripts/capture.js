// Web 画面を順に開いて、注釈付きのスクリーンショットと動画(webm)を保存する。ログインが必要なら config の login で行う。
// 使い方: node capture.js <config.json>
//
// 動画は「画面の表示が終わってから次の画面へ移るまで」の区間だけを録ってつなぐ(chrome.js の createRecorder)。
// ログイン画面やページ読み込み中の白い画面は入らない。帯(何を見る画面か)と枠・吹き出しは最初のコマから表示されている。
// actions(画面での操作)があるページは、帯を出した状態で録画を始め、操作の様子 → 枠・吹き出しの順に録る。
//
// config.json の例(証跡取得モード):
// {
//   "label": "after",                       // before / after など。出力ファイル名の接頭辞。before→「修正前」、after→「修正後」の帯になる
//   "baseUrl": "http://localhost:3000",     // pages[].url / login.url が "/" で始まるときの接頭辞
//   "outDir": "/tmp/evidence",              // 出力先(リポジトリの外の一時ディレクトリにすること)
//   "port": 9330,                           // CDP ポート(同時実行する場合はずらす)
//   "video": true,                          // 動画を録るか(省略時 true)
//   "ignoreHTTPSErrors": true,              // 開発サーバーの自己署名証明書を通すか(省略時 true。localhost 以外を撮るなら false 推奨)
//   "viewport": { "width": 1400, "height": 900 },
//   "banner": { "text": "修正後", "color": "green" },  // 帯の札(省略時は label と labels から決める。null で札なし)
//   "labels": { "before": { "text": "Before", "color": "red" } },  // label → 帯の札の対応を足す・変える(省略可)
//   "hold": 4000,                           // 1画面を見せる時間(ms)。枠・吹き出しを出してから暗転までの長さ。pages[].hold で画面ごとにも指定できる。
//                                           // 吹き出しの文字数から決まる「読める長さ」(readableMs。3〜8 秒)より短い値は、その長さに延ばす
//   "shotAt": 300,                          // スクショを撮る時点(枠・吹き出しを出してからの ms。既定は hold と同じ)。操作の直後の状態を
//                                           // 撮りたいときに早める。撮った後も動画は hold の残りだけ枠・吹き出しを見せてから暗転する。pages[].shotAt も可
//   "login": {                              // 省略するとログインしない
//     "url": "/login",
//     "actions": [ { "fill": ["input[name=user]", "testuser"] }, { "fill": ["input[type=password]", "${env:APP_PASSWORD}"] },
//                  { "click": "button[type=submit]" } ],
//     "waitUrlNot": "/login",               // この文字列を含まない URL に移ったらログイン完了(省略時は actions の後に networkidle を待つ)
//     "waitText": "ホーム"                  // ログイン後の画面に出る文字(省略可)。出るまで待つ
//   },
//   // fill の値に "${env:名前}" と書くと、実行時に環境変数の値に置き換える。パスワードは config に直接書かず、この形で渡す
//   "pages": [
//     {
//       "name": "out-of-stock",              // 出力ファイル名(英数字・ハイフン)
//       "url": "/items/123",
//       "waitFor": "span.stock",             // 表示完了の目印(省略可。要素が存在すればよく、空でもよい)
//       "read": ["span.stock"],              // innerText を標準出力に出す要素(省略可)。期待値の判定に使う
//       "title": "在庫ゼロの商品（商品コード A-100）",     // 帯の見出し
//       "caption": "在庫が「0」と表示されることを確認",   // 帯の一文(何を見る画面か)
//       "banner": { "text": "修正前・修正不要", "color": "green" }, // 帯の札をこのページだけ変える(省略時は label の札)。
//                                           // 修正前でも、変更がないことを確かめるケースは「修正不要」と分かる札にする
//       "premise": { "target": "input[name=q]", "note": "在庫が 0 件の商品" },
//                                           // 前提条件(どういうデータか)。actions の最初から検索の間だけ枠と吹き出しで出し、
//                                           // actions の { "clearPremise": true } か、actions の終わりで消す(動画のみ。スクショには出さない)
//       "annotate": [ { "target": "span.stock", "color": "green", "note": "「0」と表示される", "pos": "below" } ],
//       "clip": [ "main" ],                  // スクショに必ず含める範囲(省略時は注釈と対象だけ)
//       "actions": [ { "click": "セレクタ" }, { "fill": ["セレクタ", "値"] }, { "hover": "セレクタ" }, { "press": "Escape" },
//                    { "blur": "セレクタ" }, { "waitEnabled": "セレクタ" }, { "waitText": "表示を待つ文字列" },
//                    { "waitUrl": "/items/" }, { "waitUrlNot": "/login" }, { "waitFor": "セレクタ" }, { "wait": 1000 },
//                    { "scrollTo": "セレクタ" } ]      // scrollTo はカーソルを動かさずにその要素まで画面を送る(既定は画面の中ほど。
//                    //   "block": "start", "offset": 150 で要素の上端を画面の上から 150px に置く)
//                    // 「何秒で変わるか」を測るときは、click に "timer" を付けて画面右上のタイマーを始め、{ "waitTimer": {} } で止まるのを待つ:
//                    //   { "click": "button.apply", "timer": { "label": "反映から鍵が外れるまで",
//                    //     "until": { "selector": "td.e", "state": "notText", "value": "未入力条件あり" } } }, { "waitTimer": { "minMs": 0 } }
//                    //   until.state は gone / present / text / notText。until.selector は CSS セレクタ。whileVisible(CSS)を付けると、
//                    //   その要素が画面に映っている間だけ判定する。タイマーが動いている間は録画を止めない(cut もスクショもしない)
//                    // 画面の読み込みを待つだけの区間は "cut": true を付けると、その操作の待ち(wait*)の間を録画から詰める
//                    // (例: { "click": "a.next", "waitText": "検索結果", "cut": true })。暗転などは挟まずにつなぐ
//     }
//   ]
// }
//
// 注釈の書式は annotate.js 冒頭のコメント参照。動画なし("video": false。注釈モード)のときは apply で描いて撮る。
// url は "/..."(baseUrl 基準)のほか "https://..." や "file:///<一時ディレクトリ>/xxx.html"(csv2html.js の表など)も指定できる。
// annotate / notes が無いページは、highlight(赤 outline)・fullPage の従来形式で撮る。
const fs = require("fs");
const path = require("path");
const { launchChrome, createRecorder, sleep } = require("./chrome");

const BANNERS = { before: { text: "修正前", color: "red" }, after: { text: "修正後", color: "green" } };

// "${env:NAME}" を環境変数の値に置き換える(パスワードを config ファイルに残さないため)。未設定ならエラーにする
function resolveValue(v) {
  return String(v).replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (process.env[name] === undefined) throw new Error(`環境変数 ${name} が設定されていません`);
    return process.env[name];
  });
}

const toUrl = (base, u) => (/^(https?|file):/.test(u) ? u : (base || "").replace(/\/$/, "") + u);

// 定期的に取りに行く画面は networkidle にならないので、load で開いてから networkidle は短く待つだけにする
// (表示の完了は pages[].waitFor / actions の waitText で待つ)
async function gotoSettled(page, url) {
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

async function login(page, base, { url, actions, waitUrlNot, waitText }) {
  await gotoSettled(page, toUrl(base, url));
  await runActions(page, actions);
  if (waitUrlNot) await page.waitForURL((u) => !u.href.includes(waitUrlNot), { timeout: 60000 });
  // ログイン後の画面の目印(省略可)。認可コードの交換などで戻ってから時間がかかるアプリ向け
  if (waitText) await page.getByText(waitText).first().waitFor({ timeout: 300000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
}

// 動画では、クリック・入力する場所へカーソルを動かして波紋を出し、入力は1文字ずつ打つ(操作の様子が分かるように)
async function pointAt(page, loc) {
  const box = await loc.boundingBox();
  if (!box) return;
  await page.evaluate(([x, y]) => window.__annot.cursorTo(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
  await page.evaluate(() => window.__annot.clickMark());
}
async function runActions(page, actions, { cursor, recorder, beforeResume } = {}) {
  for (const a of actions || []) {
    // "cut": true の操作は、待ち(wait*)の間だけ録画を止めて詰める。画面の読み込みを待つだけの区間は見せる必要がないため。
    // 暗転などは挟まず、待つ前のコマと待った後のコマをそのままつなぐ
    const cut = Boolean(a.cut && recorder);
    // 画面外の要素まで画面を送る(カーソルは動かさない)。近づくまで描画されない一覧で、下の要素を出すのに使う
    // (Playwright の scrollIntoViewIfNeeded は開いているダイアログを閉じてしまう画面があるので、ブラウザ標準の scrollIntoView で送る)
    // block: "start" と offset(px)で、要素の上端を画面の上から offset の位置に置ける(既定は画面の中ほど)
    if (a.scrollTo) {
      await page.locator(a.scrollTo).first().evaluate((e, { block, offset }) => {
        e.scrollIntoView({ block });
        if (!offset) return;
        for (let p = e.parentElement; p; p = p.parentElement) {
          if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) { p.scrollBy(0, -offset); return; }
        }
        scrollBy(0, -offset);
      }, { block: a.block || "center", offset: a.offset || 0 });
    }
    if (a.click) {
      const loc = page.locator(a.click).first();
      if (cursor) await pointAt(page, loc);
      // "timer" を付けたクリックは、押す直前に画面右上のタイマーを始める(画面が until の状態になった瞬間に止まる)
      if (a.timer) await page.evaluate((o) => window.__annot.startTimer(o), a.timer);
      await loc.click();
    }
    if (a.fill) {
      const loc = page.locator(a.fill[0]).first();
      if (cursor) {
        await pointAt(page, loc);
        await loc.fill("");
        await loc.pressSequentially(resolveValue(a.fill[1]), { delay: 120 });
      } else {
        await loc.fill(resolveValue(a.fill[1]));
      }
    }
    // ツールチップのようにマウスを重ねている間だけ出る表示に使う。この後の枠・吹き出し・撮影の間も重ねたまま
    if (a.hover) {
      const loc = page.locator(a.hover).first();
      await loc.scrollIntoViewIfNeeded();
      if (cursor) await pointAt(page, loc);
      await loc.hover();
    }
    if (a.press) await page.keyboard.press(a.press);
    if (a.blur) await page.locator(a.blur).first().blur();
    // タイマーが止まるまで待つ(minMs を付けると、タイマーを始めてからその時間がたつまでは待つ)。この待ちは cut しない
    if (a.waitTimer) await waitTimerDone(page, a.waitTimer.minMs ?? 0);
    if (cut && !a.waitTimer) await recorder.pause();
    // blur でバリデーションが走ってからボタンが活性化する画面などで使う
    if (a.waitEnabled) await page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && !b.disabled; }, a.waitEnabled, { timeout: 60000 });
    if (a.waitText) await page.getByText(a.waitText).first().waitFor({ timeout: 60000 });
    if (a.waitUrl) await page.waitForURL((u) => u.href.includes(a.waitUrl), { timeout: 60000 });
    if (a.waitUrlNot) await page.waitForURL((u) => !u.href.includes(a.waitUrlNot), { timeout: 60000 });
    if (a.waitFor) await page.waitForSelector(a.waitFor, { state: "attached", timeout: 60000 });
    if (a.wait) await sleep(a.wait);
    if (cut && !a.waitTimer) {
      // 画面が移って帯・カーソルが消えていれば、録画を再開する前に出し直す
      if (beforeResume) await beforeResume();
      await recorder.resume();
    }
    if (a.clearPremise) await page.evaluate(() => window.__annot?.clearPremise());
  }
}

// 画面右上のタイマーが止まるのを待つ。タイマーが無ければすぐ戻る
async function waitTimerDone(page, minMs) {
  await page.waitForFunction((min) => {
    const s = window.__annot?.timerState?.();
    return !s || (s.done && s.elapsed >= min);
  }, minMs, { timeout: 60000, polling: 100 });
}

// 吹き出し・説明を読み切るのに要る時間(ms)。日本語を 1 秒に 10 文字ほど読む前提で、目を移す時間を足す。
// 帯の一文は操作の間ずっと出ていて読まれているので数えない。長くしすぎると、止まった画面が続いてフリーズして見える
function readableMs({ annotate, notes }) {
  const text = [...(annotate || []).map((a) => a.note), ...(notes || []).map((n) => n.html)]
    .filter(Boolean).join("").replace(/<[^>]*>/g, "");
  return Math.min(5000, Math.max(3000, 1500 + text.length * 100));
}

async function readTexts(page, sels) {
  const read = {};
  for (const sel of sels || []) {
    const loc = page.locator(sel).first();
    read[sel] = (await loc.count()) ? (await loc.innerText()).trim() : null;
  }
  return read;
}

// clip はデバイスピクセルで解釈されるため、devicePixelRatio が 1 でない環境でもずれないよう換算して撮る
async function clipShot(page, shot, { clip, dpr }) {
  const scaled = clip && { x: clip.x * dpr, y: clip.y * dpr, width: clip.width * dpr, height: clip.height * dpr };
  await page.screenshot({ path: shot, ...(scaled ? { clip: scaled, fullPage: true } : {}), scale: "css" });
}

async function main() {
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { label, outDir, pages, baseUrl } = config;
  const viewport = config.viewport || { width: 1400, height: 900 };
  const recordVideo = config.video !== false;
  const hold = config.hold ?? 4000;
  const bannerSpec = config.banner === undefined ? { ...BANNERS, ...config.labels }[label] : config.banner;

  fs.mkdirSync(outDir, { recursive: true });
  const ignoreHTTPSErrors = config.ignoreHTTPSErrors !== false;
  const chrome = await launchChrome({ port: config.port || 9330, viewport, ignoreCertErrors: ignoreHTTPSErrors });
  const results = [];
  try {
    // 注釈の切り抜き座標(CSS ピクセル)と画像の座標を一致させる
    const context = await chrome.newContext({ ignoreHTTPSErrors, viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const recorder = recordVideo ? await createRecorder(page, viewport) : null;
    if (config.login) await login(page, baseUrl, config.login);

    for (const [index, p] of pages.entries()) {
      // url を省略したページは、今の画面から actions の操作で続ける(画面上の操作で別の画面へ移る様子を録る場合)
      if (p.url) {
        await gotoSettled(page, toUrl(baseUrl, p.url));
        // 修正前は「空欄」が事象のことが多く、空の要素は visible 扱いにならないため、存在だけを待つ
        if (p.waitFor) await page.waitForSelector(p.waitFor, { state: "attached", timeout: 60000 });
        // 非同期描画の完了を待つ
        await sleep(p.settle ?? 2000);
      }

      const shot = path.join(outDir, `${label}_${p.name}.png`);
      const annotated = Boolean(p.annotate || p.notes);
      const inject = () => page.addScriptTag({ path: path.join(__dirname, "annotate.js") });
      if (annotated || recordVideo) await inject();
      const spec = {
        title: p.title, caption: p.caption, annotate: p.annotate, notes: p.notes, clip: p.clip,
        numbered: p.numbered, spotlight: p.spotlight,
      };
      const banner = { banner: p.banner === undefined ? bannerSpec : p.banner };

      if (recordVideo) {
        // 観点(画面)ごとに: 暗転から明けて帯がスライドイン → (操作があればカーソル付きで操作) → 枠・吹き出し → 暗転
        // 帯(何を見る画面か)と枠・吹き出しは、操作がなければ明けた時点で表示されている
        // 最初の画面は暗転させない(動画の最初のコマがサムネイルになるため、枠・吹き出しのある画面から始める)。
        // 帯のスライドインは最初の画面にも入れ、何を目的にした確認かへ視線を誘導する
        const drawAnnotations = async () => {
          if (!annotated) return;
          const { missing } = await page.evaluate((s) => window.__annot.draw(s), spec);
          if (missing.length) throw new Error(`${p.name}: 注釈の対象が見つかりません: ${missing.join(" / ")}`);
        };
        if (annotated || p.title || p.caption) await page.evaluate(([s, o]) => window.__annot.showBanner(s, o), [spec, banner]);
        if (!p.actions?.length) await drawAnnotations();
        await page.evaluate((cover) => window.__annot.prepareEnter({ cover }), index > 0);
        await recorder.resume();
        await page.evaluate(() => window.__annot.enter());
        if (p.actions?.length) {
          await sleep(300);
          if (p.premise) {
            const { missing } = await page.evaluate((pr) => window.__annot.showPremise(pr), p.premise);
            if (missing.length) throw new Error(`${p.name}: 前提の対象が見つかりません: ${missing.join(" / ")}`);
            await sleep(p.premise.hold ?? 3000);
          }
          // 操作で画面が再読み込みされた場合はヘルパーを入れ直す
          const reinject = async () => {
            if (await page.evaluate(() => Boolean(window.__annot))) return;
            await inject();
            await page.evaluate(([s, o]) => window.__annot.showBanner(s, o), [spec, banner]);
          };
          await runActions(page, p.actions, { cursor: true, recorder, beforeResume: reinject });
          await page.evaluate(() => window.__annot?.clearPremise());
          await reinject();
          await page.evaluate(() => window.__annot.hideCursor());
          await sleep(500);
          await drawAnnotations();
        }
        if (annotated) await page.evaluate(() => window.__annot.pulse());
        else await page.evaluate((sels) => sels.forEach((sel) => document.querySelectorAll(sel).forEach((el) => { el.style.outline = "3px solid red"; })), p.highlight || []);
        // 枠・吹き出しを見せる長さは、文字を読み切れる長さを下回らせない(短いと読めないまま暗転して動画として失敗する)。
        // スクショを早いタイミングで撮りたいとき(操作の直後の状態を撮る等)は shotAt で撮る時点だけを早め、動画は見せ続ける
        const showFor = Math.max(p.hold ?? hold, readableMs(spec));
        if (showFor > (p.hold ?? hold)) console.error(`${p.name}: hold を ${p.hold ?? hold}ms から ${showFor}ms に延ばしました(文字を読む時間)`);
        const shotAt = Math.min(p.shotAt ?? config.shotAt ?? showFor, showFor);
        await sleep(shotAt);
        // タイマーで時間を測っている間は録画を止めない(止めた区間は動画から詰まり、実際の経過時間と合わなくなる)
        await waitTimerDone(page, 0);
        await recorder.pause();
        // スクショ(帯を切り抜き範囲に寄せる)は録画を止めている間に撮り、暗転だけを録る
        const read = await readTexts(page, p.read);
        if (annotated) {
          await clipShot(page, shot, await page.evaluate(() => window.__annot.shot()));
          await page.evaluate(() => window.__annot.undock());
        } else {
          await page.screenshot({ path: shot, fullPage: Boolean(p.fullPage) });
        }
        await recorder.resume();
        await sleep(showFor - shotAt);
        // 最後の画面は暗転させずに終える(読める長さは showFor で見せ終わっているので、それ以上は止まった画面を足さない)
        if (index < pages.length - 1) await page.evaluate(() => window.__annot.leave());
        await recorder.pause();
        results.push({ name: p.name, url: page.url(), screenshot: shot, read });
        continue;
      }

      await runActions(page, p.actions);
      const read = await readTexts(page, p.read);
      if (annotated) {
        const res = await page.evaluate((s) => window.__annot.apply(s), spec);
        if (res.missing.length) throw new Error(`${p.name}: 注釈の対象が見つかりません: ${res.missing.join(" / ")}`);
        await clipShot(page, shot, res);
      } else {
        await page.evaluate((sels) => {
          for (const sel of sels) {
            document.querySelectorAll(sel).forEach((el) => { el.style.outline = "3px solid red"; });
          }
        }, p.highlight || []);
        await page.screenshot({ path: shot, fullPage: Boolean(p.fullPage) });
      }
      results.push({ name: p.name, url: page.url(), screenshot: shot, read });
    }
    if (recorder) results.push({ video: await recorder.save(path.join(outDir, `${label}.webm`)) });
  } finally {
    await chrome.close();
  }
  console.log(JSON.stringify({ label, results }, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
