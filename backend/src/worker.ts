import type { ExecutionContext } from "hono";
import app from "./app.js";
import { withRequestDb } from "./db.js";

// 本番（Cloudflare Workers）の入口。ローカル開発では index.ts（Node.js）を使う。
// /api/* 以外のリクエストは、wrangler.jsonc の assets（フロントの静的ファイル）が先に返すのでここには来ない

type Env = {
  // DB への接続を中継する Hyperdrive（wrangler.jsonc で設定）
  HYPERDRIVE: { host: string; port: number; database: string; user: string; password: string };
  JWT_SECRET?: string;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // 署名の鍵が開発用の既定値のままだと、誰でもトークンを作れてしまう。設定されるまで API を止める
    if (!env.JWT_SECRET?.trim()) {
      console.error("[worker] JWT_SECRET が設定されていません。`wrangler secret put JWT_SECRET` で設定してください。");
      return Response.json({ error: "サーバーの設定が終わっていません。" }, { status: 503 });
    }
    const { host, port, database, user, password } = env.HYPERDRIVE;
    return withRequestDb(
      { host, port, database, user, password },
      async () => app.fetch(request, env, ctx),
      (promise) => ctx.waitUntil(promise),
    );
  },
};
