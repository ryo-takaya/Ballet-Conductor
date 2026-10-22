import bcrypt from "bcryptjs";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";

// トークンの署名に使う鍵。開発用の既定値があるが、本番では必ず JWT_SECRET を設定する
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret-change-me";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const BCRYPT_ROUNDS = 10;

export type AuthUser = { id: number; name: string; email: string };

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** ログインした利用者に渡すトークン（JWT）を作る */
export function createToken(userId: number) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(userId), iat: now, exp: now + TOKEN_TTL_SECONDS }, JWT_SECRET, "HS256");
}

/** Authorization: Bearer <トークン> を確かめ、利用者の id を c.var.userId に入れる */
export const requireAuth = createMiddleware<{ Variables: { userId: number } }>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return c.json({ error: "ログインしてください。" }, 401);
  try {
    const payload = await verify(token, JWT_SECRET, "HS256");
    c.set("userId", Number(payload.sub));
  } catch {
    return c.json({ error: "ログインの有効期限が切れました。もう一度ログインしてください。" }, 401);
  }
  await next();
});
