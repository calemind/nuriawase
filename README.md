# ぬりあわせ

15分きざみのシフト表を指でなぞって塗る、日程調整アプリ。
回答者はアプリのインストール不要。LINEなどでURLを共有すれば、ブラウザで開いてそのまま塗れます。

- 青 = 出席可能 / 黄 = 未定・行けるかも / 白 = 参加できない
- 回答者は **名前** と **備考** を入力して提出
- 集計は **主催者だけ** が専用URLで閲覧
- 回答者はあとから塗り直せる。**どこをどう変えたかが差分ログとして残る**

## 構成

| 役割 | 使うもの |
| --- | --- |
| ホスティング | Cloudflare Pages |
| API | Cloudflare Pages Functions（`functions/api/`） |
| データベース | Cloudflare D1（SQLite） |
| ソース管理・自動デプロイ | GitHub → Cloudflare Pages 連携 |

追加のサーバーもビルドツールも不要です（素のHTML/CSS/JSのみ）。

```
nuriawase/
├── public/                 静的ファイル（そのまま配信される）
│   ├── index.html          作成ページ
│   ├── vote.html           回答ページ（?e=公開トークン / ?r=修正トークン）
│   ├── admin.html          集計ページ（?a=管理トークン）
│   └── assets/app.css, app.js
├── functions/api/[[route]].js   API 一式
├── schema.sql              D1 のテーブル定義
└── wrangler.toml
```

## セットアップ

```bash
npm install

# 1. D1 データベースを作る（表示された database_id を wrangler.toml に貼る）
npx wrangler d1 create nuriawase

# 2. テーブルを作る
npx wrangler d1 execute nuriawase --local  --file=./schema.sql   # ローカル用
npx wrangler d1 execute nuriawase --remote --file=./schema.sql   # 本番用

# 3. ローカルで動かす（http://localhost:8788）
npx wrangler pages dev --local

# 4. 公開する
npx wrangler pages deploy
```

GitHub 連携で自動デプロイする場合は、Cloudflare ダッシュボードの
Pages → 該当プロジェクト → Settings → Functions → **D1 database bindings** で
変数名 `DB` に `nuriawase` を割り当ててください（これを忘れると API が 500 を返します）。

## 使い方

1. トップページでイベント名・期間・時間帯（既定 10:00–23:00）・コマの長さ（既定15分）を入力して作成
2. 発行される 2つのURL を使い分ける
   - **回答用URL** … LINE等で共有する
   - **集計URL** … 主催者だけが持つ。再発行できないので必ず保管
3. 回答者は名前・備考を入れ、色を選んでマス目をなぞる（日付ラベルのタップで1日を一括）
4. 提出後に出る「修正用URL」を開けば、何度でも塗り直せる

## API

| メソッド | パス | 内容 |
| --- | --- | --- |
| POST | `/api/events` | イベント作成 → `public_token` / `admin_token` |
| GET | `/api/e/:publicToken` | 回答用のイベント情報 |
| POST | `/api/e/:publicToken/responses` | 回答を提出 → `edit_token` |
| GET | `/api/r/:editToken` | 自分の回答を読み込む |
| PUT | `/api/r/:editToken` | 自分の回答を修正（差分ログを記録） |
| GET | `/api/a/:adminToken` | 全回答＋変更ログ（主催者用） |

塗り状態は 1日ぶんを1本の文字列で保存します（`0`=なし / `1`=出席可能 / `2`=未定）。
例：10:00–23:00 を15分きざみなら 52文字。

## セキュリティについて（把握しておいてほしいこと）

- 認証は **URLを知っているかどうか** だけの方式です。集計URLが漏れると回答内容が見られます。
  社外秘の情報を扱うなら、Cloudflare Access などのログインを別途かぶせてください。
- `noindex` は入れていますが、URL自体を公開の場に貼らないでください。
- 回答の削除機能はまだありません（必要なら追加できます）。

## 次に足せそうなこと

- 回答の削除・締め切り設定
- CSV / 画像での書き出し
- 修正があったときの主催者へのメール通知（Cloudflare Email Routing か外部サービス）
- LINEミニアプリ（LIFF）化して、名前を自動入力
