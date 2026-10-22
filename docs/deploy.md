# 本番環境（Cloudflare Workers）の準備

フロント（Next.js の静的書き出し）と API（Hono）を 1 つの Cloudflare Worker で配信し、DB は TiDB Cloud（MySQL 互換）を Cloudflare Hyperdrive 経由で使います。

```
ブラウザ ─┬─ /api/* ─→ Worker（backend/src/worker.ts）─→ Hyperdrive ─→ TiDB Cloud（東京）
          └─ それ以外 ─→ Worker の静的ファイル（frontend/out）
```

費用の目安は月 5 ドル（Workers の有料プラン）です。TiDB Cloud Starter と Hyperdrive は無料枠の範囲に収まります。

最初の 1 回だけ、以下を順に行います。コマンドは `backend/` で実行します（`npm install` 済みであること）。

## 1. Cloudflare

1. https://dash.cloudflare.com/sign-up でアカウントを作る。
2. 「Workers & Pages」→「Plans」で **Workers Paid（月 5 ドル）** にする。パスワードの照合（bcrypt）が無料プランの CPU 時間（1 回 10 ミリ秒）を超えるため、有料プランが必要です。
3. ターミナルでログインする。

   ```sh
   npx wrangler login
   ```

## 2. TiDB Cloud（DB）

1. https://tidbcloud.com でアカウントを作り、**Starter** のクラスターを **AWS / Tokyo (ap-northeast-1)** に作る。
2. クラスターの「Connect」で、ホスト・ポート（4000）・ユーザー・パスワードを控える。
3. SQL Editor（またはお手元の mysql クライアント）で、DB を作ってテーブルと初期データを入れる。

   ```sh
   mysql --host <ホスト> --port 4000 --user '<ユーザー>' -p --ssl-mode=VERIFY_IDENTITY -e "CREATE DATABASE ballet_conductor"
   for f in db/init/0*.sql; do mysql --host <ホスト> --port 4000 --user '<ユーザー>' -p --ssl-mode=VERIFY_IDENTITY ballet_conductor < "$f"; done
   ```

   `db/init/03_seed_test_audio.sql` はテスト用の音源です。本番に入れたくなければ飛ばします。

## 3. Hyperdrive（Worker から DB への中継）

```sh
npx wrangler hyperdrive create ballet-conductor-db \
  --connection-string="mysql://<ユーザー>:<パスワード>@<ホスト>:4000/ballet_conductor"
```

表示された `id` を `backend/wrangler.jsonc` の `REPLACE_WITH_HYPERDRIVE_ID` と置き換えてコミットします（id は秘密ではありません）。

## 4. 秘密の値（Secrets）

```sh
# ログイン用トークンの署名鍵。ランダムな長い値にする（未設定だと API は 503 を返す）
openssl rand -base64 48 | npx wrangler secret put JWT_SECRET
# Stripe のキー（最初はテストモードの sk_test_... で確認し、問題なければ本番の sk_live_... に替える）
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

`STRIPE_WEBHOOK_SECRET` は 6. で Webhook を登録したあとに表示される `whsec_...` です。先に 5. を済ませてから入れても構いません。

## 5. GitHub から自動でデプロイする

1. Cloudflare の「My Profile」→「API Tokens」→「Create Token」で、テンプレート **Edit Cloudflare Workers** からトークンを作る。
2. GitHub のリポジトリの「Settings」→「Secrets and variables」→「Actions」に次の 2 つを登録する。
   - `CLOUDFLARE_API_TOKEN`：1. のトークン
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare のダッシュボード右側に出ているアカウント ID
3. `main` に push すると `.github/workflows/deploy.yml` がデプロイします。公開先は `https://ballet-conductor.<アカウントのサブドメイン>.workers.dev` です。
4. GitHub Pages は使わなくなるので、「Settings」→「Pages」で止めます。

## 6. Stripe の Webhook

Stripe のダッシュボードの「Developers」→「Webhooks」で、次の宛先とイベントを登録します。

- 宛先：`https://<公開先>/api/stripe/webhook`
- イベント：`checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.expired`

表示された署名シークレットを、4. の `STRIPE_WEBHOOK_SECRET` に入れます。

## 確認

- `https://<公開先>/api/health` が `{"status":"ok", ... "db":"ok"}` を返す。
- 画面から新規登録・ログイン・トラックの作成ができる。

## ローカルで Workers として動かす

ふだんの開発は `docker compose up`（Node.js）のままで構いません。Workers の環境で確かめたいときだけ、次のようにします。

```sh
cd frontend && NEXT_PUBLIC_API_URL=/api npm run build && cd ../backend
printf 'JWT_SECRET=local-only\n' > .dev.vars
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="mysql://ballet:ballet@127.0.0.1:3307/ballet_conductor" npm run dev:worker
```

## セキュリティの設定

コードの側で入れてあるもの：

- ログイン・新規登録・パスワード変更は、同じ接続元から 1 分に 10 回まで（`wrangler.jsonc` の `ratelimits`、`backend/src/rateLimit.ts`）
- パスワードを変えると、それまでに発行したログインのトークンは使えなくなる
- ページには `frontend/public/_headers`、API には `secureHeaders` でセキュリティ用のヘッダーを付ける
- API が受け取るデータは 256KB まで

アカウントの側で必ず行うこと：

- Cloudflare・TiDB Cloud・Stripe・GitHub のすべてで 2 段階認証を有効にする
- Cloudflare の API トークンは「Edit Cloudflare Workers」の権限だけにし、GitHub の Secrets 以外には置かない
