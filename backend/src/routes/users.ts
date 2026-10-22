import { Hono } from "hono";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { createToken, hashPassword, requireAuth, verifyPassword } from "../auth.js";
import { db } from "../db.js";
import { validateJson } from "../validate.js";
import addresses from "./addresses.js";

type UserDetail = { id: number; name: string; email: string; createdAt: string; trackCount: number };

const profileSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください。").max(255, "名前は255文字以内にしてください。"),
  email: z.email("メールアドレスの形式が正しくありません。").max(255),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "今のパスワードを入力してください。"),
  newPassword: z
    .string()
    .min(8, "新しいパスワードは8文字以上にしてください。")
    .max(72, "新しいパスワードは72文字以内にしてください。"),
});

const users = new Hono<{ Variables: { userId: number } }>();

users.use("*", requireAuth);

async function findUserDetail(userId: number): Promise<UserDetail | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT u.id, u.name, p.email, u.created_at,
            (SELECT COUNT(*) FROM tracks t WHERE t.user_id = u.id) AS trackCount
       FROM users u JOIN user_passwords p ON p.user_id = u.id
      WHERE u.id = ?`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, name: r.name, email: r.email, createdAt: r.created_at, trackCount: Number(r.trackCount) };
}

const notFound = { error: "利用者が見つかりません。" };

// 自分の詳細（名前・メールアドレス・登録日・トラック数）
users.get("/me", async (c) => {
  const user = await findUserDetail(c.var.userId);
  if (!user) return c.json(notFound, 404);
  return c.json({ user });
});

// 名前とメールアドレスを変える
users.patch("/me", validateJson(profileSchema), async (c) => {
  const { name, email } = c.req.valid("json");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("UPDATE users SET name = ? WHERE id = ?", [name, c.var.userId]);
    await conn.execute("UPDATE user_passwords SET email = ? WHERE user_id = ?", [email, c.var.userId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      return c.json({ error: "このメールアドレスはほかの人が使っています。" }, 409);
    }
    throw err;
  } finally {
    conn.release();
  }
  const user = await findUserDetail(c.var.userId);
  if (!user) return c.json(notFound, 404);
  return c.json({ user });
});

// パスワードを変える（今のパスワードが合っているときだけ）。ほかの端末のログインは切れる
users.put("/me/password", validateJson(passwordSchema), async (c) => {
  const { currentPassword, newPassword } = c.req.valid("json");
  const [rows] = await db.execute<RowDataPacket[]>("SELECT password FROM user_passwords WHERE user_id = ?", [
    c.var.userId,
  ]);
  const row = rows[0];
  if (!row) return c.json(notFound, 404);
  if (!(await verifyPassword(currentPassword, row.password))) {
    return c.json({ error: "今のパスワードが違います。" }, 400);
  }
  const passwordHash = await hashPassword(newPassword);
  await db.execute("UPDATE user_passwords SET password = ? WHERE user_id = ?", [passwordHash, c.var.userId]);
  // それまでのトークンは使えなくなるので、この端末用に新しいトークンを返す
  return c.json({ ok: true, token: await createToken(c.var.userId, passwordHash) });
});

// CD の送付先
users.route("/me/addresses", addresses);

export default users;
