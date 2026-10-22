import { Hono } from "hono";
import { contextStorage } from "hono/context-storage";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { pingDb } from "./db.js";
import { allowedOrigins } from "./origins.js";
import cdOrders from "./routes/cdOrders.js";
import auth from "./routes/auth.js";
import musics from "./routes/musics.js";
import stripeWebhook from "./routes/stripeWebhook.js";
import trackMusics from "./routes/trackMusics.js";
import tracks from "./routes/tracks.js";
import users from "./routes/users.js";

// アプリ本体。実行環境（Node.js・サーバーレス）に依存しないように、起動処理は index.ts に分けている
const app = new Hono().basePath("/api");

// 処理中のリクエストをどこからでも参照できるようにする（支払い後の戻り先の確認で使う）
app.use("*", contextStorage());
// フロントのローカル開発サーバーからの呼び出しを許可する（本番は同じドメインなので CORS は使わない）
app.use("*", cors({ origin: (origin) => (allowedOrigins().includes(origin) ? origin : null) }));

app.get("/health", async (c) => {
  const dbOk = await pingDb();
  return c.json(
    {
      status: dbOk ? "ok" : "error",
      service: "ballet-conductor-backend",
      db: dbOk ? "ok" : "unreachable",
      time: new Date().toISOString(),
    },
    dbOk ? 200 : 503,
  );
});

app.route("/auth", auth);
app.route("/musics", musics);
app.route("/tracks", tracks);
app.route("/track-musics", trackMusics);
app.route("/users", users);
app.route("/cd-orders", cdOrders);
// Stripe からの通知（ログイン不要。署名で Stripe からの呼び出しかを確かめる）
app.route("/stripe/webhook", stripeWebhook);

// 想定外のエラーは中身を見せずに 500 を返す（詳細はサーバーのログに出す）
app.onError((err, c) => {
  // 壊れた JSON など、リクエスト側の問題はそのままのステータスで返す
  if (err instanceof HTTPException && err.status < 500) {
    return c.json({ error: "リクエストの形式が正しくありません。" }, err.status);
  }
  console.error(err);
  return c.json({ error: "サーバーでエラーが起きました。" }, 500);
});

export default app;
