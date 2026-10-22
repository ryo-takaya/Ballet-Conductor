import { createMiddleware } from "hono/factory";

/** Workers の Rate Limiting バインディング（wrangler.jsonc の ratelimits で設定） */
type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/**
 * ログイン・新規登録・パスワード変更の試し過ぎを止める（パスワードの総当たり対策）。
 * 回数は接続元の IP ごとに数える。本番（Workers）でだけ働き、ローカルの Node.js では何もしない
 */
export const authRateLimit = createMiddleware<{ Bindings: { AUTH_RATE_LIMITER?: RateLimiter } }>(async (c, next) => {
  const limiter = c.env?.AUTH_RATE_LIMITER;
  if (limiter) {
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await limiter.limit({ key: ip });
    if (!success) {
      return c.json({ error: "試行回数が多すぎます。1分ほど待ってからもう一度お試しください。" }, 429);
    }
  }
  await next();
});
