import { Hono } from "hono";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { db } from "../db.js";
import { validateJson } from "../validate.js";

type Edit = { startSecond: number; endSecond: number; tempo: number };

const MIN_TEMPO = 50;
const MAX_TEMPO = 150;

const editsSchema = z
  .object({
    edits: z.array(
      z.object({
        startSecond: z.number().int("秒数は整数にしてください。").min(0, "始まりは0秒以上にしてください。"),
        endSecond: z.number().int("秒数は整数にしてください。").min(1, "終わりは1秒以上にしてください。"),
        tempo: z
          .number()
          .int("テンポは整数（%）にしてください。")
          .min(MIN_TEMPO, `テンポは${MIN_TEMPO}%以上にしてください。`)
          .max(MAX_TEMPO, `テンポは${MAX_TEMPO}%以下にしてください。`),
      }),
    ),
  })
  .refine((v) => v.edits.every((e) => e.endSecond > e.startSecond), {
    message: "区間の終わりは、始まりより後にしてください。",
  })
  .refine(
    (v) => {
      const sorted = [...v.edits].sort((a, b) => a.startSecond - b.startSecond);
      return sorted.every((e, i) => i === 0 || e.startSecond >= sorted[i - 1].endSecond);
    },
    { message: "区間どうしが重なっています。" },
  );

const trackMusics = new Hono<{ Variables: { userId: number } }>();

trackMusics.use("*", requireAuth);

/** ログイン中の利用者のトラックに入っている曲だけを取り出す（他人の曲は「ない」ものとして扱う） */
async function findOwnTrackMusic(trackMusicId: number, userId: number) {
  if (!Number.isInteger(trackMusicId) || trackMusicId <= 0) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT tm.id, t.id AS trackId, t.name AS trackName, m.id AS musicId, m.name AS musicName, m.url AS musicUrl
       FROM track_musics tm
       JOIN tracks t ON t.id = tm.track_id
       JOIN musics m ON m.id = tm.music_id
      WHERE tm.id = ? AND t.user_id = ?`,
    [trackMusicId, userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as number,
    track: { id: r.trackId as number, name: r.trackName as string },
    music: { id: r.musicId as number, name: r.musicName as string, url: r.musicUrl as string },
  };
}

async function listEdits(trackMusicId: number): Promise<Edit[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT start_second, end_second, tempo FROM edit_musics WHERE track_music_id = ? ORDER BY start_second",
    [trackMusicId],
  );
  return rows.map((r) => ({ startSecond: r.start_second, endSecond: r.end_second, tempo: r.tempo }));
}

const notFound = { error: "編集できる曲が見つかりません。" };

// トラック内の曲と、保存してある変更区間
trackMusics.get("/:id", async (c) => {
  const trackMusic = await findOwnTrackMusic(Number(c.req.param("id")), c.var.userId);
  if (!trackMusic) return c.json(notFound, 404);
  return c.json({ trackMusic, edits: await listEdits(trackMusic.id) });
});

// 変更区間をまとめて保存する（送られた内容で置き換える）
trackMusics.put(
  "/:id/edits",
  validateJson(editsSchema),
  async (c) => {
    const trackMusic = await findOwnTrackMusic(Number(c.req.param("id")), c.var.userId);
    if (!trackMusic) return c.json(notFound, 404);
    const { edits } = c.req.valid("json");

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM edit_musics WHERE track_music_id = ?", [trackMusic.id]);
      for (const e of edits) {
        await conn.execute(
          "INSERT INTO edit_musics (track_music_id, start_second, end_second, tempo) VALUES (?, ?, ?, ?)",
          [trackMusic.id, e.startSecond, e.endSecond, e.tempo],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    return c.json({ trackMusic, edits: await listEdits(trackMusic.id) });
  },
);

export default trackMusics;
