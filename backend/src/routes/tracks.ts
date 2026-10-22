import { Hono } from "hono";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { db } from "../db.js";
import { validateJson as validate } from "../validate.js";

type Track = { id: number; name: string; createdAt: string };
type TrackMusic = { trackMusicId: number; musicId: number; name: string; url: string; editCount: number };

const nameSchema = z.object({
  name: z.string().trim().min(1, "トラック名を入力してください。").max(255, "トラック名は255文字以内にしてください。"),
});
const addMusicSchema = z.object({ musicId: z.number().int().positive() });
const orderSchema = z.object({ trackMusicIds: z.array(z.number().int().positive()) });


const tracks = new Hono<{ Variables: { userId: number } }>();

tracks.use("*", requireAuth);

/** ログイン中の利用者のトラックだけを取り出す（他人のトラックは「ない」ものとして扱う） */
async function findOwnTrack(trackId: number, userId: number) {
  if (!Number.isInteger(trackId) || trackId <= 0) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, name, created_at FROM tracks WHERE id = ? AND user_id = ?",
    [trackId, userId],
  );
  const row = rows[0];
  return row ? ({ id: row.id, name: row.name, createdAt: row.created_at } as Track) : null;
}

async function listTrackMusics(trackId: number): Promise<TrackMusic[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT tm.id AS trackMusicId, m.id AS musicId, m.name, m.url,
            (SELECT COUNT(*) FROM edit_musics e WHERE e.track_music_id = tm.id) AS editCount
       FROM track_musics tm JOIN musics m ON m.id = tm.music_id
      WHERE tm.track_id = ?
      ORDER BY tm.position, tm.id`,
    [trackId],
  );
  return rows.map((r) => ({
    trackMusicId: r.trackMusicId,
    musicId: r.musicId,
    name: r.name,
    url: r.url,
    editCount: Number(r.editCount),
  }));
}

const notFound = { error: "トラックが見つかりません。" };

// 自分のトラック一覧（新しい順、曲数つき）
tracks.get("/", async (c) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.id, t.name, t.created_at, COUNT(tm.id) AS musicCount
       FROM tracks t LEFT JOIN track_musics tm ON tm.track_id = t.id
      WHERE t.user_id = ?
      GROUP BY t.id
      ORDER BY t.id DESC`,
    [c.var.userId],
  );
  return c.json({
    tracks: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, musicCount: Number(r.musicCount) })),
  });
});

// トラックを作る
tracks.post("/", validate(nameSchema), async (c) => {
  const { name } = c.req.valid("json");
  const [result] = await db.execute<ResultSetHeader>("INSERT INTO tracks (user_id, name) VALUES (?, ?)", [
    c.var.userId,
    name,
  ]);
  const track = await findOwnTrack(result.insertId, c.var.userId);
  return c.json({ track: { ...track, musics: [] } }, 201);
});

// トラックの中身（入っている曲）
tracks.get("/:id", async (c) => {
  const track = await findOwnTrack(Number(c.req.param("id")), c.var.userId);
  if (!track) return c.json(notFound, 404);
  return c.json({ track: { ...track, musics: await listTrackMusics(track.id) } });
});

// トラックに曲を追加する（同じ曲は 1 回まで）
tracks.post("/:id/musics", validate(addMusicSchema), async (c) => {
  const track = await findOwnTrack(Number(c.req.param("id")), c.var.userId);
  if (!track) return c.json(notFound, 404);
  const { musicId } = c.req.valid("json");

  const [musicRows] = await db.execute<RowDataPacket[]>("SELECT id FROM musics WHERE id = ?", [musicId]);
  if (musicRows.length === 0) return c.json({ error: "曲が見つかりません。" }, 404);

  const [dup] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM track_musics WHERE track_id = ? AND music_id = ?",
    [track.id, musicId],
  );
  if (dup.length > 0) return c.json({ error: "この曲はすでにトラックに入っています。" }, 409);

  // 新しい曲はトラックの最後に入れる
  await db.execute(
    `INSERT INTO track_musics (track_id, music_id, position)
     SELECT ?, ?, COALESCE(MAX(position), 0) + 1 FROM track_musics WHERE track_id = ?`,
    [track.id, musicId, track.id],
  );
  return c.json({ track: { ...track, musics: await listTrackMusics(track.id) } }, 201);
});

// トラック内の曲を並べ替える（トラックに入っている曲をすべて、新しい順番で送る）
tracks.put("/:id/musics/order", validate(orderSchema), async (c) => {
  const track = await findOwnTrack(Number(c.req.param("id")), c.var.userId);
  if (!track) return c.json(notFound, 404);
  const { trackMusicIds } = c.req.valid("json");

  const current = await listTrackMusics(track.id);
  const currentIds = new Set(current.map((m) => m.trackMusicId));
  const sameSet =
    trackMusicIds.length === currentIds.size && new Set(trackMusicIds).size === currentIds.size &&
    trackMusicIds.every((id) => currentIds.has(id));
  if (!sameSet) {
    return c.json({ error: "曲の並びが最新ではありません。画面を読み込み直してください。" }, 409);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const [index, trackMusicId] of trackMusicIds.entries()) {
      await conn.execute("UPDATE track_musics SET position = ? WHERE id = ? AND track_id = ?", [
        index + 1,
        trackMusicId,
        track.id,
      ]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return c.json({ track: { ...track, musics: await listTrackMusics(track.id) } });
});

// トラックから曲を外す
tracks.delete("/:id/musics/:trackMusicId", async (c) => {
  const track = await findOwnTrack(Number(c.req.param("id")), c.var.userId);
  if (!track) return c.json(notFound, 404);
  await db.execute("DELETE FROM track_musics WHERE id = ? AND track_id = ?", [
    Number(c.req.param("trackMusicId")),
    track.id,
  ]);
  return c.json({ track: { ...track, musics: await listTrackMusics(track.id) } });
});

export default tracks;
