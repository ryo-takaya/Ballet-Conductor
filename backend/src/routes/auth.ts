import { Hono } from "hono";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { createToken, hashPassword, requireAuth, verifyPassword, type AuthUser } from "../auth.js";
import { db } from "../db.js";
import { validateJson as validate } from "../validate.js";

const signupSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください。").max(255, "名前は255文字以内にしてください。"),
  email: z.email("メールアドレスの形式が正しくありません。").max(255),
  password: z.string().min(8, "パスワードは8文字以上にしてください。").max(72, "パスワードは72文字以内にしてください。"),
});

const loginSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません。"),
  password: z.string().min(1, "パスワードを入力してください。"),
});


type UserRow = RowDataPacket & AuthUser & { password: string };

const auth = new Hono();

// 新規登録：users と user_passwords に 1 行ずつ追加して、そのままログイン状態にする
auth.post("/signup", validate(signupSchema), async (c) => {
  const { name, email, password } = c.req.valid("json");
  const passwordHash = await hashPassword(password);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [userResult] = await conn.execute<ResultSetHeader>("INSERT INTO users (name) VALUES (?)", [name]);
    await conn.execute(
      "INSERT INTO user_passwords (user_id, email, password) VALUES (?, ?, ?)",
      [userResult.insertId, email, passwordHash],
    );
    await conn.commit();

    const user: AuthUser = { id: userResult.insertId, name, email };
    return c.json({ token: await createToken(user.id, passwordHash), user }, 201);
  } catch (err) {
    await conn.rollback();
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      return c.json({ error: "このメールアドレスはすでに登録されています。" }, 409);
    }
    throw err;
  } finally {
    conn.release();
  }
});

// ログイン：メールアドレスとパスワードを確かめて、トークンを返す
auth.post("/login", validate(loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const [rows] = await db.execute<UserRow[]>(
    `SELECT u.id, u.name, p.email, p.password
       FROM user_passwords p JOIN users u ON u.id = p.user_id
      WHERE p.email = ?`,
    [email],
  );
  const row = rows[0];
  // どちらが違うかは教えない（登録済みのメールアドレスを推測されないようにする）
  if (!row || !(await verifyPassword(password, row.password))) {
    return c.json({ error: "メールアドレスまたはパスワードが違います。" }, 401);
  }
  const user: AuthUser = { id: row.id, name: row.name, email: row.email };
  return c.json({ token: await createToken(user.id, row.password), user });
});

// ログイン中の利用者の情報
auth.get("/me", requireAuth, async (c) => {
  const [rows] = await db.execute<UserRow[]>(
    `SELECT u.id, u.name, p.email
       FROM users u JOIN user_passwords p ON p.user_id = u.id
      WHERE u.id = ?`,
    [c.var.userId],
  );
  const row = rows[0];
  if (!row) return c.json({ error: "利用者が見つかりません。" }, 404);
  return c.json({ user: { id: row.id, name: row.name, email: row.email } satisfies AuthUser });
});

export default auth;
