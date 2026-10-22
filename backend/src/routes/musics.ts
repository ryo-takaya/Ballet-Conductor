import { Hono } from "hono";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../auth.js";
import { db } from "../db.js";

export type Music = { id: number; name: string; url: string };

const SEARCH_LIMIT = 50;

const musics = new Hono();

musics.use("*", requireAuth);

// 曲名で検索する（q が空なら名前順に並べて返す）
musics.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  // LIKE の % と _ を文字として扱うためにエスケープする
  const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const [rows] = await db.query<(RowDataPacket & Music)[]>(
    `SELECT id, name, url FROM musics WHERE name LIKE ? ORDER BY name LIMIT ${SEARCH_LIMIT}`,
    [pattern],
  );
  return c.json({ musics: rows.map(({ id, name, url }) => ({ id, name, url })) });
});

export default musics;
