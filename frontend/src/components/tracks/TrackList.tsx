"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, type TrackDetail, type TrackSummary } from "@/lib/api";
import { useAuth } from "../AuthProvider";
import styles from "./tracks.module.css";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}

export default function TrackList() {
  const router = useRouter();
  const { token } = useAuth();
  const [tracks, setTracks] = useState<TrackSummary[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    apiFetch<{ tracks: TrackSummary[] }>("/tracks", { token })
      .then((res) => setTracks(res.tracks))
      .catch((err) => setListError(err instanceof ApiError ? err.message : "トラックを読み込めませんでした。"));
  }, [token]);

  // トラックを作ったら、そのまま曲を追加する画面へ進む
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const { track } = await apiFetch<{ track: TrackDetail }>("/tracks", {
        method: "POST",
        token,
        body: JSON.stringify({ name }),
      });
      router.push(`/tracks/detail?id=${track.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "トラックを作れませんでした。");
      setCreating(false);
    }
  };

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <h1 className={styles.cardTitle}>新しいトラックを作る</h1>
        <p className={styles.hint}>レッスンやクラスごとに、使う曲をまとめておけます。</p>
        <form className={styles.createForm} onSubmit={handleCreate}>
          <label className={styles.field}>
            <span className={styles.label}>トラック名</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：月曜 初級クラス"
              maxLength={255}
            />
          </label>
          <button type="submit" className={styles.primary} disabled={creating || name.trim() === ""}>
            {creating ? "作成しています…" : "＋ 作成する"}
          </button>
        </form>
        {error && <p className={styles.error}>{error}</p>}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>あなたのトラック</h2>
        {listError ? (
          <p className={styles.error}>{listError}</p>
        ) : tracks === null ? (
          <p className={styles.empty}>読み込んでいます…</p>
        ) : tracks.length === 0 ? (
          <p className={styles.empty}>まだトラックはありません。上の欄から作ってみましょう。</p>
        ) : (
          <ul className={styles.trackList}>
            {tracks.map((t) => (
              <li key={t.id}>
                <Link href={`/tracks/detail?id=${t.id}`} className={styles.trackItem}>
                  <span className={styles.trackName}>{t.name}</span>
                  <span className={styles.trackMeta}>
                    {t.musicCount} 曲 ・ {formatDate(t.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
