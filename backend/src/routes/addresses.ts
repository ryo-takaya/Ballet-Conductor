import { Hono } from "hono";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { db } from "../db.js";
import { PREFECTURES } from "../prefectures.js";
import { validateJson } from "../validate.js";

type Address = {
  id: number;
  recipientName: string;
  postalCode: string;
  prefecture: string;
  city: string;
  addressLine1: string;
  addressLine2: string | null;
  isDefault: boolean;
};

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label}を入力してください。`).max(max, `${label}は${max}文字以内にしてください。`);

const addressSchema = z.object({
  recipientName: text("宛名", 255),
  // 「1500001」のようにハイフンなしでも受け付けて、「150-0001」の形にそろえる
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{3}-?\d{4}$/, "郵便番号は「150-0001」のように7桁で入力してください。")
    .transform((v) => `${v.replace("-", "").slice(0, 3)}-${v.replace("-", "").slice(3)}`),
  prefecture: z.enum(PREFECTURES, "都道府県を選んでください。"),
  city: text("市区町村", 255),
  addressLine1: text("町名・番地", 255),
  addressLine2: z
    .string()
    .trim()
    .max(255, "建物名・部屋番号は255文字以内にしてください。")
    .optional()
    .transform((v) => (v ? v : null)),
  isDefault: z.boolean().optional(),
});

// users ルーターの下（/users/me/addresses）につなぐので、ログインの確認は users 側で済んでいる
const addresses = new Hono<{ Variables: { userId: number } }>();

async function listAddresses(userId: number): Promise<Address[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, recipient_name, postal_code, prefecture, city, address_line1, address_line2, is_default
       FROM shipping_addresses WHERE user_id = ?
      ORDER BY is_default DESC, id`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    recipientName: r.recipient_name,
    postalCode: r.postal_code,
    prefecture: r.prefecture,
    city: r.city,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    isDefault: Boolean(r.is_default),
  }));
}

/** 指定した住所をデフォルトにする（いまのデフォルトを先に外す。デフォルトは 1 人 1 件まで） */
async function makeDefault(conn: PoolConnection, userId: number, addressId: number) {
  await conn.execute("UPDATE shipping_addresses SET is_default = FALSE WHERE user_id = ? AND is_default", [userId]);
  await conn.execute("UPDATE shipping_addresses SET is_default = TRUE WHERE id = ? AND user_id = ?", [addressId, userId]);
}

async function inTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const notFound = { error: "住所が見つかりません。" };

// 自分の送付先の一覧（デフォルトが先頭）
addresses.get("/", async (c) => c.json({ addresses: await listAddresses(c.var.userId) }));

// 送付先を追加する。最初の 1 件は、指定がなくてもデフォルトにする
addresses.post("/", validateJson(addressSchema), async (c) => {
  const a = c.req.valid("json");
  const userId = c.var.userId;
  await inTransaction(async (conn) => {
    const [countRows] = await conn.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM shipping_addresses WHERE user_id = ?",
      [userId],
    );
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO shipping_addresses
         (user_id, recipient_name, postal_code, prefecture, city, address_line1, address_line2)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, a.recipientName, a.postalCode, a.prefecture, a.city, a.addressLine1, a.addressLine2],
    );
    if (a.isDefault || Number(countRows[0].n) === 0) await makeDefault(conn, userId, result.insertId);
  });
  return c.json({ addresses: await listAddresses(userId) }, 201);
});

// デフォルトの送付先を替える
addresses.put("/:id/default", async (c) => {
  const userId = c.var.userId;
  const id = Number(c.req.param("id"));
  const own = (await listAddresses(userId)).some((a) => a.id === id);
  if (!own) return c.json(notFound, 404);
  await inTransaction((conn) => makeDefault(conn, userId, id));
  return c.json({ addresses: await listAddresses(userId) });
});

// 送付先を削除する。デフォルトを消したときは、残りのうち一番古い住所をデフォルトにする
addresses.delete("/:id", async (c) => {
  const userId = c.var.userId;
  const id = Number(c.req.param("id"));
  const target = (await listAddresses(userId)).find((a) => a.id === id);
  if (!target) return c.json(notFound, 404);
  await inTransaction(async (conn) => {
    await conn.execute("DELETE FROM shipping_addresses WHERE id = ? AND user_id = ?", [id, userId]);
    if (target.isDefault) {
      const [rest] = await conn.execute<RowDataPacket[]>(
        "SELECT id FROM shipping_addresses WHERE user_id = ? ORDER BY id LIMIT 1",
        [userId],
      );
      if (rest[0]) await makeDefault(conn, userId, rest[0].id);
    }
  });
  return c.json({ addresses: await listAddresses(userId) });
});

export default addresses;
