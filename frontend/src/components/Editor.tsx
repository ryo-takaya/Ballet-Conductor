"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPluginClass from "wavesurfer.js/dist/plugins/regions.esm.js";
import { encodeWav } from "@/lib/audio";
import styles from "./Editor.module.css";

type RegionsPlugin = ReturnType<typeof RegionsPluginClass.create>;

/** テンポを変える区間。位置は元の曲の時間（秒）で持つ */
type Section = { id: string; start: number; end: number; rate: number };

/** DB に保存する変更区間。秒数は整数、テンポは % */
export type SavedEdit = { startSecond: number; endSecond: number; tempo: number };

type EditorProps = {
  /** 曲名（② の見出しに出す） */
  musicName: string;
  /** 音源の URL。空のときは手元のファイルを選んでもらう */
  musicUrl: string;
  /** 保存してある変更区間 */
  initialEdits: SavedEdit[];
  onSave: (edits: SavedEdit[]) => Promise<void>;
};

const TEMPO_PRESETS = [0.75, 0.9, 1, 1.1];
// 波形の色はライト・ダークどちらの背景でも見えるものにしている
const REGION_COLOR = "rgba(56, 182, 240, 0.22)";
const REGION_ACTIVE_COLOR = "rgba(56, 182, 240, 0.45)";
const NEW_SECTION_LENGTH = 4;
// 区間は DB に整数の秒数で保存するので、1 秒単位で扱う
const MIN_SECTION_LENGTH = 1;
const snap = (t: number) => Math.round(t);

function formatWhole(sec: number) {
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function toSavedEdits(sections: Section[]): SavedEdit[] {
  return sortSections(sections).map((s) => ({
    startSecond: snap(s.start),
    endSecond: snap(s.end),
    tempo: Math.round(s.rate * 100),
  }));
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec)) return "0:00.0";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function sortSections(sections: Section[]) {
  return [...sections].sort((a, b) => a.start - b.start);
}

/** 秒数の入力欄。入力中は文字のまま持ち、確定（フォーカスが外れる・Enter）で反映する */
function SecondsInput({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (value: number) => void;
  label: string;
}) {
  const [text, setText] = useState(String(Math.round(value)));
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
    else setText(String(Math.round(value)));
  };
  return (
    <label className={styles.secondsField}>
      <span className={styles.secondsLabel}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={styles.secondsInput}
      />
      <span className={styles.secondsUnit}>秒</span>
    </label>
  );
}

type Fitted = { start: number; end: number; startBy?: Section; endBy?: Section };

/**
 * 区間がほかの区間と重ならないように、隣の区間の端までで止める。
 * prev は動かす前の区間（新しく作る区間のときは null）。どうしても入らないときは null を返す。
 */
function fitBetweenNeighbors(
  others: Section[],
  start: number,
  end: number,
  prev: Section | null,
): Fitted | null {
  const inside = (t: number) => others.find((o) => t > o.start && t < o.end);
  let anchor = (start + end) / 2;
  const hit = inside(anchor);
  // 真ん中がほかの区間に入ってしまう場合は、元の位置（新しい区間ならその区間の後ろ）を基準にする
  if (hit) anchor = prev ? (prev.start + prev.end) / 2 : hit.end + 1e-6;
  if (inside(anchor)) return null;

  let lo = 0;
  let hi = Infinity;
  let loBy: Section | undefined;
  let hiBy: Section | undefined;
  for (const o of others) {
    if (o.end <= anchor && o.end >= lo) {
      lo = o.end;
      loBy = o;
    }
    if (o.start >= anchor && o.start < hi) {
      hi = o.start;
      hiBy = o;
    }
  }
  const fittedStart = Math.max(start, lo);
  const fittedEnd = Math.min(end, hi);
  if (fittedEnd - fittedStart < MIN_SECTION_LENGTH) return null;
  return {
    start: fittedStart,
    end: fittedEnd,
    startBy: fittedStart > start + 1e-9 ? loBy : undefined,
    endBy: fittedEnd < end - 1e-9 ? hiBy : undefined,
  };
}

/** 重なりを避けて範囲を変えたときに、利用者に伝える文 */
function describeFit(fitted: Fitted, id: string, others: Section[]) {
  if (!fitted.startBy && !fitted.endBy) return null;
  const all = sortSections([...others, { id, start: fitted.start, end: fitted.end, rate: 1 }]);
  const label = (s: Section) => `区間${all.findIndex((x) => x.id === s.id) + 1}`;
  const sec = (t: number) => `${Math.round(t)}秒`;
  if (fitted.startBy && fitted.endBy) {
    return `${label(fitted.startBy)}・${label(fitted.endBy)}と重なるため、${sec(fitted.start)}〜${sec(fitted.end)}にしました。`;
  }
  if (fitted.startBy) return `${label(fitted.startBy)}と重なるため、${sec(fitted.start)}からにしました。`;
  return `${label(fitted.endBy!)}と重なるため、${sec(fitted.end)}までにしました。`;
}

const OVERLAP_MESSAGE = "ほかの区間と重なるため、この範囲にはできません。";

/** 区間で埋まっていない時間（1 秒単位）。[start, end) の組を時間順に返す */
function freeGaps(sections: Section[], length: number) {
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of sortSections(sections)) {
    if (s.start > cursor) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (length > cursor) gaps.push({ start: cursor, end: length });
  return gaps.filter((g) => g.end - g.start >= MIN_SECTION_LENGTH);
}

/**
 * 「＋ 変更区間の追加」で作る区間の場所を決める。
 * 1. 再生位置から NEW_SECTION_LENGTH 秒
 * 2. 再生位置がほかの区間の中なら、その区間のすぐ後ろから
 * 3. 後ろの空きが短いときは、空いている分だけ（1 秒以上）
 * 4. 後ろに空きがなければ、再生位置より前で一番近い空き
 * 5. 曲全体が埋まっていれば null
 */
function findAddSlot(sections: Section[], playhead: number, length: number) {
  const gaps = freeGaps(sections, length);
  let t = Math.min(Math.max(0, snap(playhead)), Math.max(0, length - MIN_SECTION_LENGTH));
  const inside = sections.find((s) => t >= s.start && t < s.end);
  if (inside) t = inside.end;

  const here = gaps.find((g) => t >= g.start && t <= g.end - MIN_SECTION_LENGTH);
  if (here) return { start: t, end: Math.min(t + NEW_SECTION_LENGTH, here.end) };

  const after = gaps.find((g) => g.start >= t);
  if (after) return { start: after.start, end: Math.min(after.start + NEW_SECTION_LENGTH, after.end) };

  const before = gaps.filter((g) => g.end <= t).at(-1);
  if (before) return { start: Math.max(before.start, before.end - NEW_SECTION_LENGTH), end: before.end };

  return null;
}

function TempoControl({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <>
      <div className={styles.tempoRow}>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={styles.tempoSlider}
          aria-label={label}
        />
        <span className={styles.tempoValue}>{Math.round(value * 100)}%</span>
      </div>
      <div className={styles.controls}>
        {TEMPO_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`${styles.chip} ${Math.abs(value - preset) < 1e-3 ? styles.chipActive : ""}`}
            onClick={() => onChange(preset)}
          >
            {preset === 1 ? "もとの速さ" : `${Math.round(preset * 100)}%`}
          </button>
        ))}
      </div>
    </>
  );
}

export default function Editor({ musicName, musicUrl, initialEdits, onSave }: EditorProps) {
  const waveRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sectionsRef = useRef<Section[]>([]);
  const appliedRateRef = useRef(1);
  // 音源を読み込んだあとに波形の上へ戻す区間（最初は保存済みの区間）
  const restoreRef = useRef<SavedEdit[]>(initialEdits);

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sectionsVersion, setSectionsVersion] = useState(0);
  const [sectionNotice, setSectionNotice] = useState<{
    id: string;
    message: string;
    kind: "error" | "info";
  } | null>(null);
  const [addNotice, setAddNotice] = useState("");
  // 追加した区間を、一覧の中で見える位置まで動かすための目印
  const scrollToIdRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [waveReady, setWaveReady] = useState(false);
  const [error, setError] = useState("");
  const [savedEdits, setSavedEdits] = useState<SavedEdit[]>(initialEdits);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  // 再生位置がどの区間にあるかを見て、その区間のテンポで再生する
  const syncPlaybackRate = useCallback((time: number) => {
    const ws = wsRef.current;
    if (!ws) return;
    const section = sectionsRef.current.find((s) => time >= s.start && time < s.end);
    const rate = section?.rate ?? 1;
    if (Math.abs(rate - appliedRateRef.current) > 1e-3) {
      appliedRateRef.current = rate;
      ws.setPlaybackRate(rate, true);
    }
  }, []);

  // wavesurfer は画面表示後にブラウザ側でだけ読み込む
  useEffect(() => {
    let destroyed = false;
    (async () => {
      const [{ default: WaveSurferLib }, { default: Regions }] = await Promise.all([
        import("wavesurfer.js"),
        import("wavesurfer.js/dist/plugins/regions.esm.js"),
      ]);
      if (destroyed || !waveRef.current) return;

      const regions = Regions.create();
      const ws = WaveSurferLib.create({
        container: waveRef.current,
        height: 140,
        waveColor: "#9fd6f2",
        progressColor: "#1ea7e8",
        cursorColor: "#0b7fc0",
        cursorWidth: 2,
        barWidth: 3,
        barGap: 2,
        barRadius: 3,
        normalize: true,
        dragToSeek: false,
        plugins: [regions],
      });

      // 波形をなぞるたびに区間が 1 つ増える
      regions.enableDragSelection({ color: REGION_COLOR });
      // 区間を作る・動かすときは、ほかの区間と重ならないように端をそろえる
      regions.on("region-created", (region) => {
        const others = sectionsRef.current.filter((s) => s.id !== region.id);
        const fitted = fitBetweenNeighbors(others, snap(region.start), snap(region.end), null);
        if (!fitted) {
          region.remove();
          setAddNotice("ほかの区間と重なるため、ここには区間を追加できません。");
          return;
        }
        setAddNotice("");
        if (fitted.start !== region.start || fitted.end !== region.end) {
          region.setOptions({ start: fitted.start, end: fitted.end });
        }
        const added = { id: region.id, start: fitted.start, end: fitted.end, rate: 1 };
        sectionsRef.current = sortSections([...others, added]);
        setSections(sectionsRef.current);
        setActiveId(region.id);
        const message = describeFit(fitted, region.id, others);
        setSectionNotice(message ? { id: region.id, message, kind: "info" } : null);
      });
      regions.on("region-updated", (region) => {
        const prev = sectionsRef.current.find((s) => s.id === region.id);
        if (!prev) return;
        const others = sectionsRef.current.filter((s) => s.id !== region.id);
        const fitted = fitBetweenNeighbors(others, snap(region.start), snap(region.end), prev);
        setActiveId(region.id);
        if (!fitted) {
          region.setOptions({ start: prev.start, end: prev.end });
          setSectionNotice({ id: region.id, message: OVERLAP_MESSAGE, kind: "error" });
          return;
        }
        if (fitted.start !== region.start || fitted.end !== region.end) {
          region.setOptions({ start: fitted.start, end: fitted.end });
        }
        sectionsRef.current = sortSections([...others, { ...prev, start: fitted.start, end: fitted.end }]);
        setSections(sectionsRef.current);
        const message = describeFit(fitted, region.id, others);
        setSectionNotice(message ? { id: region.id, message, kind: "info" } : null);
      });
      regions.on("region-removed", (region) => {
        setSections((prev) => prev.filter((s) => s.id !== region.id));
      });
      regions.on("region-clicked", (region) => setActiveId(region.id));

      ws.on("play", () => setIsPlaying(true));
      ws.on("pause", () => setIsPlaying(false));
      ws.on("finish", () => setIsPlaying(false));
      ws.on("timeupdate", (t) => {
        setCurrentTime(t);
        syncPlaybackRate(t);
      });
      ws.on("ready", () => {
        appliedRateRef.current = 1;
        ws.setPlaybackRate(1, true);
        // 保存済み（または読み込み直す前）の区間を波形の上に戻す
        const restored: Section[] = [];
        restoreRef.current.forEach((e, i) => {
          const region = regions.addRegion({
            id: `restored-${Date.now()}-${i}`,
            start: e.startSecond,
            end: e.endSecond,
            color: REGION_COLOR,
          });
          restored.push({ id: region.id, start: region.start, end: region.end, rate: e.tempo / 100 });
        });
        sectionsRef.current = sortSections(restored.filter((s) => s.end - s.start >= MIN_SECTION_LENGTH));
        setSections(sectionsRef.current);
        setSectionNotice(null);
        setAddNotice("");
        setWaveReady(true);
      });

      wsRef.current = ws;
      regionsRef.current = regions;
    })();

    return () => {
      destroyed = true;
      wsRef.current?.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
  }, [syncPlaybackRate]);

  // 曲が変わるたびに波形を描き直し、区間をリセットする
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !buffer) return;
    // 別の音源を読み込み直しても、いまの区間は残す
    if (sectionsRef.current.length > 0) restoreRef.current = toSavedEdits(sectionsRef.current);
    sectionsRef.current = [];
    regionsRef.current?.clearRegions();
    setSections([]);
    setActiveId(null);
    setCurrentTime(0);
    setWaveReady(false);
    ws.loadBlob(encodeWav(buffer)).catch(() => {});
  }, [buffer]);

  useEffect(() => {
    if (wsRef.current && waveReady) wsRef.current.zoom(zoom);
  }, [zoom, waveReady]);

  // 波形上の区間に番号を表示し、選んでいる区間を濃くする
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    sections.forEach((s, i) => {
      const region = regions.getRegions().find((r) => r.id === s.id);
      region?.setOptions({
        content: String(i + 1),
        color: s.id === activeId ? REGION_ACTIVE_COLOR : REGION_COLOR,
      });
    });
  }, [sections, activeId]);

  const getAudioContext = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  };

  // 曲に音源の URL があれば、最初に自動で読み込む
  useEffect(() => {
    if (!musicUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(musicUrl);
        if (!res.ok) throw new Error(String(res.status));
        const decoded = await getAudioContext().decodeAudioData(await res.arrayBuffer());
        if (!cancelled) setBuffer(decoded);
      } catch {
        if (!cancelled) setError("曲の音源を読み込めませんでした。時間をおいて、ページを読み込み直してください。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [musicUrl]);

  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const findRegion = (id: string) => regionsRef.current?.getRegions().find((r) => r.id === id);

  // 空いている場所を findAddSlot のルールで探して、区間を追加する
  const addSection = () => {
    const regions = regionsRef.current;
    if (!regions || !buffer) return;
    const slot = findAddSlot(sectionsRef.current, wsRef.current?.getCurrentTime() ?? 0, Math.floor(buffer.duration));
    if (!slot) return;
    const region = regions.addRegion({ start: slot.start, end: slot.end, color: REGION_COLOR });
    scrollToIdRef.current = region.id;
  };

  const updateSection = (id: string, patch: Partial<Omit<Section, "id">>) => {
    setSections((prev) => sortSections(prev.map((s) => (s.id === id ? { ...s, ...patch } : s))));
  };

  // 入力された秒数で区間の開始・終了を変える。おかしな値のときは元に戻す
  const setSectionTime = (section: Section, edge: "start" | "end", value: number) => {
    if (!buffer) return;
    const t = snap(Math.min(Math.max(0, value), Math.floor(buffer.duration)));
    const start = edge === "start" ? t : section.start;
    const end = edge === "end" ? t : section.end;
    setActiveId(section.id);
    // 入力欄を作り直して、表示を実際の値にそろえる
    setSectionsVersion((v) => v + 1);
    if (end - start < MIN_SECTION_LENGTH) {
      setSectionNotice({ id: section.id, message: "終わりの秒数は、始まりの秒数より後にしてください。", kind: "error" });
      return;
    }
    const others = sections.filter((s) => s.id !== section.id);
    const fitted = fitBetweenNeighbors(others, start, end, section);
    if (!fitted) {
      setSectionNotice({ id: section.id, message: OVERLAP_MESSAGE, kind: "error" });
      return;
    }
    const message = describeFit(fitted, section.id, others);
    setSectionNotice(message ? { id: section.id, message, kind: "info" } : null);
    findRegion(section.id)?.setOptions({ start: fitted.start, end: fitted.end });
    updateSection(section.id, { start: fitted.start, end: fitted.end });
  };

  const setSectionRate = (section: Section, rate: number) => {
    updateSection(section.id, { rate });
    setActiveId(section.id);
    // 再生中にその区間にいる場合は、すぐに新しいテンポにする
    sectionsRef.current = sectionsRef.current.map((s) => (s.id === section.id ? { ...s, rate } : s));
    syncPlaybackRate(wsRef.current?.getCurrentTime() ?? 0);
  };

  const playSection = (section: Section) => {
    setActiveId(section.id);
    findRegion(section.id)?.play(true);
  };

  const removeSection = (section: Section) => {
    findRegion(section.id)?.remove();
    if (activeId === section.id) setActiveId(null);
  };

  // スペースキーで再生・一時停止
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code !== "Space" || ["INPUT", "BUTTON"].includes(target.tagName)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const duration = buffer?.duration ?? 0;
  const hasAudio = buffer !== null;
  const canAdd = buffer !== null && freeGaps(sections, Math.floor(buffer.duration)).length > 0;

  // 追加した区間が一覧に出たら、その区間まで画面を動かす
  useEffect(() => {
    const id = scrollToIdRef.current;
    if (!id || !sections.some((s) => s.id === id)) return;
    scrollToIdRef.current = null;
    document.querySelector(`[data-section-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [sections]);

  // 音源を読み込むまでは区間が波形の上にないので、保存済みの内容をそのまま「いまの内容」とみなす
  const currentEdits = waveReady ? toSavedEdits(sections) : savedEdits;
  const dirty = JSON.stringify(currentEdits) !== JSON.stringify(savedEdits);

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      await onSave(currentEdits);
      setSavedEdits(currentEdits);
      setSaveMessage({ kind: "info", text: "保存しました。" });
    } catch (err) {
      setSaveMessage({ kind: "error", text: err instanceof Error ? err.message : "保存できませんでした。" });
    } finally {
      setSaving(false);
    }
  };

  // 保存していない変更があるときは、ページを離れる前に確認する
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <div className={styles.editor}>
      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          ① 『{musicName}』
        </h2>
        <div className={styles.waveWrap}>
          <div ref={waveRef} className={styles.wave} />
          {!hasAudio && (
            <p className={styles.waveEmpty}>
              {error ? "音源を読み込めませんでした" : musicUrl ? "音源を読み込んでいます…" : "この曲には、まだ音源が登録されていません"}
            </p>
          )}
        </div>
        <div className={styles.timeRow}>
          <span>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <label className={styles.zoom}>
            拡大
            <input
              type="range"
              min={0}
              max={300}
              step={10}
              value={zoom}
              disabled={!hasAudio}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
        </div>
        <div className={`${styles.controls} ${styles.spaced}`}>
          <button
            type="button"
            className={`${styles.button} ${styles.play}`}
            onClick={togglePlay}
            disabled={!hasAudio}
            aria-label={isPlaying ? "一時停止" : "再生"}
          >
            {isPlaying ? "❚❚ 一時停止" : "▶ 再生"}
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>② 変更区間の編集</h2>
          <div className={styles.controls}>
            <button type="button" className={styles.button} onClick={addSection} disabled={!hasAudio || !canAdd}>
              ＋ 変更区間の追加
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? "保存しています…" : dirty ? "保存する" : "保存済み"}
            </button>
          </div>
        </div>
        {saveMessage && (
          <p className={saveMessage.kind === "error" ? styles.fieldError : styles.fieldNotice} role="status">
            {saveMessage.text}
          </p>
        )}
        <p className={styles.hint}>
          再生位置から区間を追加します。①の波形の上をなぞっても区間を追加できます。範囲は1秒単位で、秒数を入力するか、波形の上で端をつまんで調整できます。区間の中は、設定したテンポで再生されます。変更は「保存する」を押すと、この曲に保存されます。
        </p>

        {addNotice && <p className={styles.fieldError}>{addNotice}</p>}
        {hasAudio && waveReady && !canAdd && (
          <p className={styles.fieldNotice}>曲全体が変更区間で埋まっているため、空きがありません。区間を縮めるか、選択を解除すると追加できます。</p>
        )}

        {!waveReady && savedEdits.length > 0 ? (
          <p className={styles.emptySections}>
            保存済みの変更区間が {savedEdits.length} 件あります。音源を読み込むと表示されます。
          </p>
        ) : sections.length === 0 ? (
          <p className={styles.emptySections}>まだ変更区間はありません</p>
        ) : (
          <ol className={styles.sectionList}>
            {sections.map((s, i) => (
              <li
                key={s.id}
                data-section-id={s.id}
                className={`${styles.sectionItem} ${s.id === activeId ? styles.sectionItemActive : ""}`}
                onFocus={() => setActiveId(s.id)}
              >
                <div className={styles.sectionItemHead}>
                  <span className={styles.sectionBadge}>区間{i + 1}</span>
                  <span className={styles.selectionInfo}>
                    {formatWhole(s.start)} 〜 {formatWhole(s.end)}（{Math.round(s.end - s.start)}秒）
                  </span>
                </div>

                <h3 className={styles.heading}>範囲を選択する</h3>
                <div className={styles.rangeInputs}>
                  <SecondsInput
                    key={`start-${s.start}-${sectionsVersion}`}
                    value={s.start}
                    label="始まり"
                    onCommit={(v) => setSectionTime(s, "start", v)}
                  />
                  <span className={styles.rangeTilde}>〜</span>
                  <SecondsInput
                    key={`end-${s.end}-${sectionsVersion}`}
                    value={s.end}
                    label="終わり"
                    onCommit={(v) => setSectionTime(s, "end", v)}
                  />
                  <button type="button" className={styles.button} onClick={() => playSection(s)}>
                    ▶ 区間を再生
                  </button>
                </div>
                {sectionNotice?.id === s.id && (
                  <p className={sectionNotice.kind === "error" ? styles.fieldError : styles.fieldNotice}>
                    {sectionNotice.message}
                  </p>
                )}

                <h3 className={styles.heading}>テンポを変更する</h3>
                <TempoControl value={s.rate} onChange={(rate) => setSectionRate(s, rate)} label={`区間${i + 1}のテンポ`} />

                <div className={`${styles.controls} ${styles.spaced}`}>
                  <button type="button" className={styles.button} onClick={() => removeSection(s)}>
                    選択を解除する
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

    </div>
  );
}
