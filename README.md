# Ballet-Conductor

バレエ音源の編集ツール（Web アプリ）。フロントエンドは Next.js + TypeScript で、音声編集に Web Audio API、波形表示に wavesurfer.js を使っています。バックエンドは Hono + TypeScript の API で、データベースは MySQL です。

## できること（プロトタイプ）

- 曲の音源（`musics.url`）を編集画面で自動で読み込み。音源が登録されていない曲は編集できません
- 波形表示（wavesurfer.js）と再生・一時停止（スペースキーでも可）
- 変更区間を複数追加（「変更区間の追加」ボタン、または波形をなぞる）。範囲は「始まり〜終わり」の秒数入力や波形上で調整。区間どうしは重ならず、重なるときは隣の区間の端で止まります
- 区間ごとのテンポ設定（50%〜150%、音の高さはそのまま）。再生中も区間に入るとそのテンポになります

音の処理はブラウザ内（Web Audio API）で行います。サーバーに保存するのは、変更区間の位置とテンポだけです。

### 画面

| パス | 内容 | ログイン |
| --- | --- | --- |
| `/` | トップページ | 不要 |
| `/login` | ログイン・新規登録 | 不要 |
| `/tracks` | トラックの一覧と作成 | 必要 |
| `/tracks/detail?id=…` | トラックの中身。曲名で検索して追加・削除、ドラッグ&ドロップで並べ替え、「編集」で曲の編集へ | 必要 |
| `/account` | ユーザー詳細。名前・メールアドレス・登録日・トラック数の表示、名前・メールアドレスの変更、CD の送付先住所の追加・削除・デフォルトの切り替え（ヘッダーの「〇〇 さん」から開く） | 必要 |
| `/orders` | CD の依頼の一覧と、いまの状態・金額・支払いの状態 | 必要 |
| `/orders/new?trackId=…` | CD の依頼。トラックの中身・送付先・料金を確かめて「支払いに進む」で Stripe の支払い画面へ（トラック画面の「CD を依頼する」から開く） | 必要 |
| `/orders/detail?id=…` | CD の依頼の詳細。依頼した時点の曲・テンポ・送付先・金額と、状態の履歴。未払いなら「支払いに進む」で再開でき、「支払い待ち」「依頼済み」のうちは取り消せる（支払い済みなら全額返金） | 必要 |
| `/editor?trackMusicId=…` | トラック内の曲の編集（区間ごとのテンポ変更と保存）。自分のトラックの曲だけ開けます | 必要 |

ログインが必要な画面をログインせずに開くと、トップページへ移動します。ログインの状態はブラウザに保存したトークンで保ち、「ログアウト」で消えます（バックエンドが必要です）。

## フォルダ構成

```
.
├── compose.yaml        # フロントとバックエンドをまとめて起動する開発用の定義
├── frontend/           # フロントエンド（Next.js）。package.json はこの直下
│   ├── Dockerfile
│   └── src/
├── backend/            # バックエンド（Hono の API）。package.json はこの直下
│   ├── Dockerfile
│   ├── db/init/        # MySQL の初回起動時に実行する SQL
│   └── src/
├── docs/deploy.md      # 本番環境（Cloudflare Workers）の準備の手順
└── .github/workflows/  # Cloudflare Workers へのデプロイ
```

フロントとバックエンドは、それぞれ独立したパッケージです。依存関係もそれぞれのフォルダで管理します。

## 必要なもの

- Docker（Docker Desktop など。`docker compose` が使えること）

Node.js や npm をホストに入れる必要はありません。すべてコンテナの中で動きます。

## 起動

```sh
docker compose up
```

| サービス | URL | 編集すると |
| --- | --- | --- |
| フロントエンド（`frontend`） | http://localhost:3100 | ブラウザに自動で反映（ホットリロード） |
| バックエンド（`backend`） | http://localhost:8787/api | 自動で再起動 |
| データベース（`db`） | localhost:3307（MySQL 8.4） | - |

止めるときは `Ctrl+C`、またはバックグラウンドで起動した場合は `docker compose down` です。

ホスト側のポートは `WEB_PORT`（既定 3100）、`API_PORT`（既定 8787）、`DB_PORT`（既定 3307）で変えられます。

```sh
WEB_PORT=3000 API_PORT=9000 DB_PORT=3306 docker compose up
```

## よく使うコマンド

npm のコマンドもコンテナの中で実行します。`docker compose exec` のあとにサービス名（`frontend` か `backend`）を指定します。

```sh
# パッケージを追加する
docker compose exec frontend npm install <パッケージ名>
docker compose exec backend npm install <パッケージ名>

# フロントエンドの Lint
docker compose exec frontend npm run lint

# バックエンドの型チェック
docker compose exec backend npm run typecheck

# バックエンドのテスト
docker compose exec backend npm test
```

`package.json` を変更したあと（別ブランチに切り替えたときなど）に依存関係がずれた場合は、node_modules のボリュームを作り直します。

```sh
docker compose down -v
docker compose up --build
```

## バックエンド API

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 動作確認用。DB にも接続できれば `{ "status": "ok", "db": "ok" }`、できなければ 503 を返します |
| POST | `/api/auth/signup` | 新規登録。`{ name, email, password }` を送ると、登録してトークンと利用者を返します |
| POST | `/api/auth/login` | ログイン。`{ email, password }` を確かめて、トークンと利用者を返します |
| GET | `/api/auth/me` | ログイン中の利用者を返します。`Authorization: Bearer <トークン>` が必要です |
| GET | `/api/users/me` | 自分の詳細（名前、メールアドレス、登録日、トラック数） |
| PATCH | `/api/users/me` | 名前とメールアドレスを変えます。`{ name, email }` |
| PUT | `/api/users/me/password` | パスワードを変えます。`{ currentPassword, newPassword }`（今のパスワードが合っているときだけ） |
| GET | `/api/users/me/addresses` | 自分の CD の送付先の一覧（デフォルトが先頭） |
| POST | `/api/users/me/addresses` | 送付先を追加します。`{ recipientName, postalCode, prefecture, city, addressLine1, addressLine2?, isDefault? }`（最初の 1 件は自動でデフォルト） |
| PUT | `/api/users/me/addresses/:id/default` | デフォルトの送付先を替えます |
| DELETE | `/api/users/me/addresses/:id` | 送付先を削除します（デフォルトを消すと、残りの最初の住所がデフォルトに） |
| GET | `/api/cd-orders` | 自分の CD の依頼の一覧（いまの状態・金額・支払いの状態つき） |
| GET | `/api/cd-orders/price` | CD 1 枚の料金（`CD_PRICE_JPY`）と、支払いを受け付けられるか（`paymentsEnabled`） |
| POST | `/api/cd-orders` | CD を依頼します。`{ trackId, shippingAddressId, returnBaseUrl }`。トラックの中身・送付先・いまの料金を写して「支払い待ち」で保存し、Stripe Checkout の URL（`checkoutUrl`）を返します。`returnBaseUrl` は支払い後に戻るフロントの URL（`CORS_ORIGINS` のものか、API と同じドメインのものだけ） |
| GET | `/api/cd-orders/:id` | 依頼の詳細と、状態の履歴 |
| POST | `/api/cd-orders/:id/checkout` | 支払い待ちの依頼の支払いを再開します。`{ returnBaseUrl }`。開いたままの支払い画面があればその URL、期限が切れていれば新しい URL を返します |
| POST | `/api/cd-orders/:id/cancel` | 依頼を取り消します（「支払い待ち」なら支払い画面を閉じて、「依頼済み」なら Stripe で全額返金して） |
| POST | `/api/stripe/webhook` | Stripe からの通知（ログイン不要。署名を `STRIPE_WEBHOOK_SECRET` で確かめます） |
| GET | `/api/musics?q=曲名` | 曲を曲名で検索します（部分一致、最大 50 件） |
| GET | `/api/tracks` | 自分のトラック一覧（曲数つき） |
| POST | `/api/tracks` | トラックを作ります。`{ name }` |
| GET | `/api/tracks/:id` | トラックと、入っている曲 |
| POST | `/api/tracks/:id/musics` | トラックに曲を追加します。`{ musicId }`（同じ曲は 1 回まで） |
| PUT | `/api/tracks/:id/musics/order` | トラック内の曲を並べ替えます。`{ trackMusicIds: [...] }`（入っている曲をすべて新しい順で） |
| DELETE | `/api/tracks/:id/musics/:trackMusicId` | トラックから曲を外します |
| GET | `/api/track-musics/:id` | トラック内の曲と、保存してある変更区間 |
| PUT | `/api/track-musics/:id/edits` | 変更区間をまとめて保存します。`{ edits: [{ startSecond, endSecond, tempo }] }`（秒は整数、tempo は 50〜150 の %） |

`/api/users`、`/api/musics`、`/api/tracks`、`/api/track-musics` はログインが必要です。トラックとその中の曲は、自分のものしか見たり変えたりできません。

- `backend/src/app.ts`: API 本体（ルートの定義）。実行環境に依存しないので、あとでサーバーレスにもそのまま載せられます
- `backend/src/index.ts`: ローカル用に Node.js で起動する部分
- `backend/src/db.ts`: MySQL への接続（mysql2 の接続プール）
- `backend/src/auth.ts` / `backend/src/routes/auth.ts`: 認証。パスワードは bcrypt でハッシュにして保存し、ログインすると 7 日間有効なトークン（JWT）を返します。署名鍵は `JWT_SECRET` で設定します
- 呼び出しを許可するフロントの URL は、`compose.yaml` の `CORS_ORIGINS` で設定しています

## データベース（MySQL）

開発用の接続情報は次のとおりです。値はトップレベルに `.env` を置くと上書きできます（`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD`）。

| 項目 | 値 |
| --- | --- |
| ホスト（手元の DB クライアントから） | `localhost:3307` |
| ホスト（バックエンドのコンテナから） | `db:3306` |
| データベース | `ballet_conductor` |
| ユーザー / パスワード | `ballet` / `ballet` |
| root のパスワード | `root` |

```sh
# MySQL のコンソールに入る
docker compose exec db mysql -uballet -pballet ballet_conductor
```

### テーブル

定義は `backend/db/init/01_tables.sql` にあります。どのテーブルにも `id`（主キー）、`created_at`、`updated_at` があります。

| テーブル | 主な列 | 内容 |
| --- | --- | --- |
| `users` | `name` | 利用者 |
| `user_passwords` | `user_id` → users、`email`（重複不可）、`password` | ログイン情報（利用者 1 人に 1 行。password はハッシュを入れる） |
| `musics` | `name`、`url` | 曲 |
| `tracks` | `user_id` → users、`name` | トラック（持ち主の利用者を消すと一緒に消える） |
| `track_musics` | `track_id` → tracks、`music_id` → musics、`position` | トラックに入っている曲（`position` は並び順） |
| `edit_musics` | `track_music_id` → track_musics、`start_second`、`end_second`、`tempo` | 変更区間 |
| `shipping_addresses` | `user_id` → users、`recipient_name`、`postal_code`、`prefecture`、`city`、`address_line1`、`address_line2`、`is_default` | CD の送付先（利用者 1 人に複数。デフォルトは 1 件まで） |
| `cd_orders` | `user_id` → users、`track_id` → tracks（消すと空になる）、`track_name`、`track_snapshot`（JSON）、送付先の各列、`price_amount`、`currency` | CD の作成依頼。依頼した時点のトラックの中身・送付先・料金を写して持つ（有料化する前の依頼は `price_amount` が 0） |
| `cd_order_events` | `cd_order_id` → cd_orders、`event`、`note`、`created_at` | 依頼の状態の履歴（`awaiting_payment` → `paid` → `requested` → `accepted` → `in_production` → `shipped`、または `cancelled`。支払い済みで取り消すと続けて `refunded`）。いまの状態は一番新しい行 |
| `cd_order_payments` | `cd_order_id` → cd_orders、`amount`、`currency`、`stripe_checkout_session_id`（重複不可）、`stripe_payment_intent_id`、`stripe_refund_id`、`status` | 依頼の支払い（Stripe Checkout のセッションごとに 1 行。`pending` → `paid` → `refunded`、または `expired`） |

親の行を消すと、それにひもづく行も一緒に消えます（例: トラックを消すと、その track_musics と edit_musics も消える）。

すでに DB がある環境で、あとから足した列を反映するときは `backend/db/migrations/` の SQL を流します。

```sh
docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-07_add_track_musics_position.sql
docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-07_add_shipping_addresses.sql
docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-07_add_cd_orders.sql
docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/migrations/2026-10-10_add_cd_order_payments.sql
```

CD の依頼の状態を進める画面はまだないので、受付や発送はイベントの行を足して記録します（例：依頼 1 番を発送済みにする）。

```sh
docker compose exec db mysql --default-character-set=utf8mb4 -uballet -pballet ballet_conductor \
  -e "INSERT INTO cd_order_events (cd_order_id, event, note) VALUES (1, 'shipped', '送り状 1234-5678')"
```

テーブルを追加・反映するときは、次のように SQL を流します。

```sh
docker compose exec -T db mysql -uballet -pballet ballet_conductor < backend/db/init/01_tables.sql
```

- `backend/db/init/02_seed_musics.sql` は、曲検索を試すためのサンプル曲（22 曲）です。まだ音源ファイルはないので `url` は空です
- `backend/db/init/03_seed_test_audio.sql` は、音源つきのテスト用の曲（11 曲、名前は「テスト音源 …」）です。音源は `frontend/public/audio/test-*.mp3`（自作の合成音、どれも約 1 分。2・3・4 拍子、速さ 66〜150）で、編集画面を開くと自動で読み込まれます
- `musics.url` が `/` で始まるときは、フロントのサイト内のファイル（`frontend/public/` 以下）として読み込みます
- データは `db_data` ボリュームに保存され、`docker compose down` しても残ります
- `backend/db/init/` の `.sql` は、DB を初めて作るとき（ボリュームが空のとき）にだけファイル名順に実行されます
- DB を空から作り直すときは `docker compose down -v` を実行します（node_modules のボリュームも消えるので、次の起動は少し時間がかかります）

## CD の依頼の支払い（Stripe、テストモード）

CD の依頼は有料です（1 枚あたりの固定料金、税込・送料込。既定 3,000 円で、`CD_PRICE_JPY` で変えられます）。支払いは Stripe Checkout（Stripe がホストする支払い画面）で受け付けます。**テストモードのキーだけを使います。本番のキー（`sk_live_…`）は入れないでください。**

1. 確認画面の「支払いに進む」で、依頼を「支払い待ち」で作り、Stripe の支払い画面へ移ります
2. 支払いが済むと、Stripe から Webhook（`checkout.session.completed`）が届き、「支払い済み」→「依頼済み」になります。支払い後に戻ってくる画面では支払い済みにしません（通知が届くまで「支払いを確認しています…」と出ます）。同じ通知が何度届いても 1 回だけ記録します
3. 支払わずに期限が切れると（`checkout.session.expired`、既定 24 時間）、依頼は「取り消し」になります。それまでは詳細画面の「支払いに進む」で再開できます
4. 「依頼済み」（受付前）のうちに取り消すと、Stripe で全額返金して「返金済み」になります

キーがない環境でも起動します。そのときは「支払いに進む」がエラーになるだけで、ほかの機能は動きます。

### ローカルで試す

1. Stripe のアカウントを作り、テストモードのシークレットキー（`sk_test_…`）を https://dashboard.stripe.com/test/apikeys で確かめます
2. `.env.example` をコピーして `.env` を作り、`STRIPE_SECRET_KEY` に入れます

   ```sh
   cp .env.example .env
   ```

3. Webhook の署名シークレットを表示して、`.env` の `STRIPE_WEBHOOK_SECRET` に入れます（stripe-cli のコンテナで表示します）

   ```sh
   docker compose --profile stripe run --rm stripe-cli listen --print-secret
   ```

4. stripe-cli（Webhook の中継）も一緒に起動します。Stripe からの通知が backend の `/api/stripe/webhook` に転送されます

   ```sh
   docker compose --profile stripe up
   ```

   起動時のログに出る `Your webhook signing secret is whsec_…` が `.env` の値と違うときは、入れ直して `docker compose up -d` してください

5. トラックの画面の「CD を依頼する」→「支払いに進む」で、テスト用のカード番号 `4242 4242 4242 4242`（有効期限は未来の日付、セキュリティコードは任意の 3 桁）で支払います

`.env` を変えたら `docker compose up -d` で backend を作り直すと反映されます。

### テスト

Webhook の処理（署名の確認、二重の通知、期限切れ、返金）は、Stripe の API をモックに差し替えて確かめるテストがあります。開発用の DB にテスト用の利用者を作り、終わったら消します。

```sh
docker compose exec backend npm test
```

## 構成メモ

- `node_modules` と `.next` はコンテナ側の名前付きボリュームに置くため、ホストには中身が作られません（空のフォルダだけが見えることがあります）
- macOS の bind mount でも変更を確実に拾えるよう、ファイル監視はポーリングにしています

## 本番環境（Cloudflare Workers）

フロントと API を 1 つの Cloudflare Worker で公開します（DB は TiDB Cloud、Hyperdrive 経由）。`main` ブランチに push すると、GitHub Actions（`.github/workflows/deploy.yml`）がフロントをビルドして Worker ごとデプロイします。プルリクエストでは、型チェックとビルドの確認だけを行います。

最初の準備（Cloudflare・TiDB Cloud・秘密の値・Stripe の Webhook）は [docs/deploy.md](docs/deploy.md) にまとめています。準備が終わるまでは、GitHub Actions はデプロイせずに確認だけを行います。

- Worker の入口は `backend/src/worker.ts`、設定は `backend/wrangler.jsonc` です。ローカル開発の入口（`backend/src/index.ts`）とは別で、ルートの定義（`app.ts`）は共通です。
- Workers では DB の接続をリクエストをまたいで使い回せないため、リクエストごとに接続プールを作ります（`backend/src/db.ts` の `withRequestDb`）。
