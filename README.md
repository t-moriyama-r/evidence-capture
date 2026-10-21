# evidence-capture

[Claude Code](https://claude.com/claude-code) 用のスキルです。Web 画面の修正前後を Playwright で撮り、注釈付きスクリーンショット・動画(webm)・修正前後の比較画像を作ります。
修正前後を比べない「注釈モード」(現状の画面や CSV 出力に枠線・吹き出しで説明を書き込む)と、PR 本文への画像・動画の添付にも対応します。

- 画面に帯(修正前/修正後・何を見る画面か)、番号付きの枠、吹き出し、スポットライトを**重ねて**撮る
- 動画は「表示が終わってから次の画面へ移るまで」の区間だけを録ってつなぐ(ログイン画面や読み込み中の白い画面は入らない)
- クリック・入力箇所にはカーソルと波紋を出す。「何秒で変わるか」が論点の修正は画面右上のタイマーで実測できる
- 動画の中身を一覧画像(コンタクトシート)にして、Claude が目で確かめられる

使い方の詳細は [`evidence-capture/SKILL.md`](evidence-capture/SKILL.md) を参照してください。

## インストール

`evidence-capture/` フォルダを次のどちらかに置きます。

- 個人で全プロジェクトに使う: `~/.claude/skills/evidence-capture/`
- プロジェクトで共有する: `<リポジトリ>/.claude/skills/evidence-capture/`

```bash
git clone https://github.com/t-moriyama-r/evidence-capture.git
cp -r evidence-capture/evidence-capture ~/.claude/skills/
```

Claude Code を起動し直すとスキルとして認識されます。「修正前後のスクショを撮って」「証跡を撮って」などと頼むと使われます。

## 必要なもの

- Node.js 18 以上
- Google Chrome(標準の場所に無ければ環境変数 `CHROME_PATH` で指定。Windows / macOS / Linux 対応)
- `playwright-core`: プロジェクトの依存にあればそれを使います。無ければ次のどちらか
  - `npx -y @playwright/mcp@latest --help` を一度実行して npx キャッシュに入れる
  - `npm i -D playwright-core`
- 録画用 ffmpeg: 初回の撮影時に、導入コマンド(`node <playwright-core>/cli.js install ffmpeg`)がエラーメッセージに出ます
- (任意)PR に動画を貼るときの mp4 変換: `ffmpeg-static`。必要になったときに導入コマンドがエラーメッセージに出ます

## 構成

| ファイル | 役割 |
|---------|------|
| `evidence-capture/SKILL.md` | スキル本体(Claude が読む手順書) |
| `evidence-capture/scripts/capture.js` | ログイン → 画面ごとに注釈を重ねてスクショ・動画を撮る |
| `evidence-capture/scripts/annotate.js` | 画面に注釈(帯・枠・吹き出し)を描くブラウザ側ヘルパー |
| `evidence-capture/scripts/compose.js` | 修正前後のスクショを左右に並べた比較画像を作る |
| `evidence-capture/scripts/csv2html.js` | CSV を列記号付きの表 HTML にする(注釈モード用) |
| `evidence-capture/scripts/video-sheet.js` | 動画を一定間隔で切り出した一覧画像を作る |
| `evidence-capture/scripts/github-attach.js` | 画像・動画を GitHub の添付としてアップロードし、PR 本文用の文字列を出す |
| `evidence-capture/scripts/chrome.js` | 共通処理(Chrome の起動・接続、録画) |

## セキュリティ

このスキルには API キー・トークン・パスワードなどの秘密情報は含まれていません。使う側でも次を守ってください。

- **パスワードは config に書かない**。`fill` の値に `"${env:APP_PASSWORD}"` のように書くと、実行時に環境変数から読みます(未設定ならエラーで止まります)
  ```bash
  APP_PASSWORD='...' node evidence-capture/scripts/capture.js /tmp/evidence/after.json
  ```
- アプリの URL・テストアカウント・ログイン手順などのプロジェクト固有の情報は、スキルには含めず、各プロジェクトの `CLAUDE.md` などから読み取る前提です
- 撮影の config と証跡(スクショ・動画)はリポジトリの外の一時ディレクトリに出力し、コミットしないでください。テストアカウント・開発環境のデータだけを撮り、本番環境では使わないでください
- `capture.js` は開発サーバーの自己署名証明書を通すため、既定で証明書エラーを無視します(`"ignoreHTTPSErrors": false` で無効化)。localhost 以外を撮るときは `false` にしてください
- `github-attach.js` は、普段使いの Chrome とは別の専用プロファイルに GitHub のログイン状態を保存します(Windows: `%LOCALAPPDATA%/evidence-capture`、macOS: `~/Library/Application Support/evidence-capture`、Linux: `$XDG_DATA_HOME` または `~/.local/share/evidence-capture`)。このフォルダにはセッション Cookie が入るので、共有したりリポジトリに置いたりしないでください。GitHub へのアクセスでは証明書エラーを無視しません
- `github-attach.js` は GitHub の PR 画面のコメント欄へファイルを添付し、URL を読み取ってからコメント欄を空に戻します(コメントは投稿しません)。添付したファイルの URL は、URL を知っている人なら閲覧できる場合があります。非公開にすべき画面の証跡を公開リポジトリの PR に貼らないでください

## ライセンス

[MIT](LICENSE)
