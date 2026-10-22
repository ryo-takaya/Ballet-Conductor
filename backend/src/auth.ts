import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { createMiddleware } from "hono/factory";
import { sign, verify } from "hono/jwt";
import { db } from "./db.js";

// トークンの署名に使う鍵。開発用の既定値があるが、本番では必ず JWT_SECRET を設定する
// （Workers では環境変数がリクエストのときに読めるようになるので、使うときに読む）
const jwtSecret = () => process.env.JWT_SECRET ?? "dev-only-secret-change-me";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const BCRYPT_ROUNDS = 10;

export type AuthUser = { id: number; name: string; email: string };

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/**
 * パスワードのハッシュから作る短い目印。トークンに入れておき、パスワードが変わったら
 * 目印が合わなくなって、それまでに発行したトークンが使えなくなる
 */
async function passwordStamp(passwordHash: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passwordHash));
  return Buffer.from(digest).toString("base64url").slice(0, 16);
}

/** ログインした利用者に渡すトークン（JWT）を作る。passwordHash はその利用者のいまのパスワードのハッシュ */
export async function createToken(userId: number, passwordHash: string) {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { sub: String(userId), pwd: await passwordStamp(passwordHash), iat: now, exp: now + TOKEN_TTL_SECONDS },
    jwtSecret(),
    "HS256",
  );
}

const expired = { error: "ログインの有効期限が切れました。もう一度ログインしてください。" };

/** Authorization: Bearer <トークン> を確かめ、利用者の id を c.var.userId に入れる */
export const requireAuth = createMiddleware<{ Variables: { userId: number } }>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return c.json({ error: "ログインしてください。" }, 401);
  let payload: Awaited<ReturnType<typeof verify>>;
  try {
    payload = await verify(token, jwtSecret(), "HS256");
  } catch {
    return c.json(expired, 401);
  }
  // パスワードが変わった・利用者が消えたときは、署名が正しくても受け付けない
  const userId = Number(payload.sub);
  const [rows] = await db.execute<RowDataPacket[]>("SELECT password FROM user_passwords WHERE user_id = ?", [userId]);
  const row = rows[0];
  if (!row || payload.pwd !== (await passwordStamp(row.password))) return c.json(expired, 401);
  c.set("userId", userId);
  await next();
});
