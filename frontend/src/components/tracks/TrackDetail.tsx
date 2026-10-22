"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, type Music, type TrackDetail as Track, type TrackMusic } from "@/lib/api";
import { useAuth } from "../AuthProvider";
import ConfirmDialog from "../ConfirmDialog";
import SortableMusicList from "./SortableMusicList";
import styles from "./tracks.module.css";

const SEARCH_DELAY_MS = 300;

export default function TrackDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { token } = useAuth();
  const [track, setTrack] = useState<Track | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Music[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);
  // 外す前の確認で選んでいる曲
  const [removing, setRemoving] = useState<TrackMusic | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ track: Track }>(`/tracks/${encodeURIComponent(id)}`, { token })
      .then((res) => setTrack(res.track))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "トラックを読み込めませんでした。"));
  }, [id, token]);

  // 入力が止まってから検索する（1 文字ごとに問い合わせない）
  useEffect(() => {
    const timer = setTimeout(() => {
      apiFetch<{ musics: Music[] }>(`/musics?q=${encodeURIComponent(query.trim())}`, { token })
        .then((res) => {
          setResults(res.musics);
          setSearchError("");
        })
        .catch((err) => setSearchError(err instanceof ApiError ? err.message : "曲を検索できませんでした。"));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, token]);

  const addMusic = async (music: Music) => {
    if (!track) return;
    setActionError("");
    setPendingId(music.id);
    try {
      const res = await apiFetch<{ track: Track }>(`/tracks/${track.id}/musics`, {
        method: "POST",
        token,
        body: JSON.stringify({ musicId: music.id }),
      });
      setTrack(res.track);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "曲を追加できませんでした。");
    } finally {
      setPendingId(null);
    }
  };

  // 並べ替えはすぐ画面に反映し、保存に失敗したら元に戻す
  const reorderMusics = async (next: TrackMusic[]) => {
    if (!track) return;
    const previous = track;
    setActionError("");
    setTrack({ ...track, musics: next });
    try {
      const res = await apiFetch<{ track: Track }>(`/tracks/${track.id}/musics/order`, {
        method: "PUT",
        token,
        body: JSON.stringify({ trackMusicIds: next.map((m) => m.trackMusicId) }),
      });
      setTrack(res.track);
    } catch (err) {
      setTrack(previous);
      setActionError(err instanceof ApiError ? err.message : "曲の順番を保存できませんでした。");
    }
  };

  // 確認のモーダルで「外す」を押したら、曲と保存済みの変更区間を消す
  const confirmRemove = async () => {
    if (!track || !removing) return;
    setActionError("");
    setRemoveBusy(true);
    try {
      const res = await apiFetch<{ track: Track }>(`/tracks/${track.id}/musics/${removing.trackMusicId}`, {
        method: "DELETE",
        token,
      });
      setTrack(res.track);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "曲を外せませんでした。");
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  };

  if (loadError) {
    return (
      <section className={styles.card}>
        <p className={styles.error}>{loadError}</p>
        <Link href="/tracks" className={styles.back}>
          ← トラック一覧へ戻る
        </Link>
      </section>
    );
  }
  if (!track) return <p className={styles.empty}>読み込んでいます…</p>;

  const addedIds = new Set(track.musics.map((m) => m.musicId));

  return (
    <div className={styles.stack}>
      <Link href="/tracks" className={styles.back}>
        ← トラック一覧へ戻る
      </Link>

      <section className={styles.card}>
        <div className={styles.trackHead}>
          <div>
            <p className={styles.label}>トラック</p>
            <h1 className={styles.trackTitle}>{track.name}</h1>
          </div>
          {track.musics.length > 0 && (
            <Link href={`/orders/new?trackId=${track.id}`} className={`${styles.primary} ${styles.orderLink}`}>
              CD を依頼する
            </Link>
          )}
        </div>
        <h2 className={styles.subTitle}>入っている曲（{track.musics.length} 曲）</h2>
        {track.musics.length === 0 ? (
          <p className={styles.empty}>まだ曲がありません。下の「曲を探す」から追加しましょう。</p>
        ) : (
          <>
            <p className={styles.hint}>左の ⋮⋮ をつまんで上下に動かすと、曲の順番を変えられます。</p>
            <SortableMusicList musics={track.musics} onReorder={reorderMusics} onRemove={setRemoving} />
          </>
        )}
        {actionError && <p className={styles.error}>{actionError}</p>}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>曲を探す</h2>
        <label className={styles.field}>
          <span className={styles.label}>曲名</span>
          <input
            type="search"
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例：ワルツ、白鳥の湖"
          />
        </label>
        {searchError ? (
          <p className={styles.error}>{searchError}</p>
        ) : results === null ? (
          <p className={styles.empty}>読み込んでいます…</p>
        ) : results.length === 0 ? (
          <p className={styles.empty}>「{query.trim()}」に合う曲は見つかりませんでした。</p>
        ) : (
          <ul className={styles.musicList}>
            {results.map((m) => {
              const added = addedIds.has(m.id);
              return (
                <li key={m.id} className={styles.musicItem}>
                  <span className={styles.musicName}>{m.name}</span>
                  <button
                    type="button"
                    className={added ? styles.secondary : styles.primarySmall}
                    disabled={added || pendingId === m.id}
                    onClick={() => addMusic(m)}
                  >
                    {added ? "追加済み" : "＋ 曲を追加"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        title={`「${removing?.name ?? ""}」をトラックから外しますか？`}
        confirmLabel={removeBusy ? "外しています…" : "外す"}
        danger
        busy={removeBusy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      >
        {removing && removing.editCount > 0 ? (
          <p>
            この曲に保存した<strong>変更区間（{removing.editCount} 件）も削除されます</strong>。削除した変更区間は元に戻せません。
          </p>
        ) : (
          <p>この曲に保存した変更区間はありません。外したあとも、「曲を探す」からもう一度追加できます。</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
