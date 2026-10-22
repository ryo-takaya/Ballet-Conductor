"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, type TrackMusicInfo } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import Editor, { type SavedEdit } from "./Editor";
import styles from "./TrackMusicEditor.module.css";

type Loaded = { trackMusic: TrackMusicInfo; edits: SavedEdit[] };

// 「/」で始まる音源はサイト内のファイル。GitHub Pages ではサイトが /Ballet-Conductor の下にあるので前に付ける
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const resolveMusicUrl = (url: string) => (url.startsWith("/") ? `${BASE_PATH}${url}` : url);

/** トラックに入っている曲を読み込んで、編集画面を出す（自分のトラックの曲だけ） */
export default function TrackMusicEditor() {
  const trackMusicId = useSearchParams().get("trackMusicId") ?? "";
  const { token } = useAuth();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const request = trackMusicId
      ? apiFetch<Loaded>(`/track-musics/${encodeURIComponent(trackMusicId)}`, { token })
      : Promise.reject(new ApiError("編集する曲が選ばれていません。トラックから曲を選んでください。", 400));
    request
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "曲を読み込めませんでした。"));
  }, [trackMusicId, token]);

  const handleSave = useCallback(
    async (edits: SavedEdit[]) => {
      try {
        await apiFetch(`/track-musics/${encodeURIComponent(trackMusicId)}/edits`, {
          method: "PUT",
          token,
          body: JSON.stringify({ edits }),
        });
      } catch (err) {
        throw new Error(err instanceof ApiError ? err.message : "保存できませんでした。");
      }
    },
    [trackMusicId, token],
  );

  if (error) {
    return (
      <section className={styles.card}>
        <p className={styles.error}>{error}</p>
        <Link href="/tracks" className={styles.back}>
          ← トラック一覧へ
        </Link>
      </section>
    );
  }
  if (!data) return <p className={styles.loading}>読み込んでいます…</p>;

  const { trackMusic, edits } = data;
  return (
    <div className={styles.stack}>
      <Link href={`/tracks/detail?id=${trackMusic.track.id}`} className={styles.back}>
        ← 『{trackMusic.track.name}』へ戻る
      </Link>
      <Editor
        key={trackMusic.id}
        musicName={trackMusic.music.name}
        musicUrl={resolveMusicUrl(trackMusic.music.url)}
        initialEdits={edits}
        onSave={handleSave}
      />
    </div>
  );
}
