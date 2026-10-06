"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPluginClass from "wavesurfer.js/dist/plugins/regions.esm.js";
import { createSampleWaltz, encodeWav } from "@/lib/audio";
import styles from "./Editor.module.css";

type RegionsPlugin = ReturnType<typeof RegionsPluginClass.create>;

/** テンポを変える区間。位置は元の曲の時間（秒）で持つ */
type Section = { id: string; start: number; end: number; rate: number };

const TEMPO_PRESETS = [0.75, 0.9, 1, 1.1];
// 波形の色はライト・ダークどちらの背景でも見えるものにしている
const REGION_COLOR = "rgba(56, 182, 240, 0.22)";
const REGION_ACTIVE_COLOR = "rgba(56, 182, 240, 0.45)";
const NEW_SECTION_LENGTH = 4;
const MIN_SECTION_LENGTH = 0.05;

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
  const [text, setText] = useState(value.toFixed(1));
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
    else setText(value.toFixed(1));
  };
  return (
    <label className={styles.secondsField}>
      <span className={styles.secondsLabel}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={0.1}
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
  const sec = (t: number) => `${t.toFixed(1)}秒`;
  if (fitted.startBy && fitted.endBy) {
    return `${label(fitted.startBy)}・${label(fitted.endBy)}と重なるため、${sec(fitted.start)}〜${sec(fitted.end)}にしました。`;
  }
  if (fitted.startBy) return `${label(fitted.startBy)}と重なるため、${sec(fitted.start)}からにしました。`;
  return `${label(fitted.endBy!)}と重なるため、${sec(fitted.end)}までにしました。`;
}

const OVERLAP_MESSAGE = "ほかの区間と重なるため、この範囲にはできません。";

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

export default function Editor() {
  const waveRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sectionsRef = useRef<Section[]>([]);
  const appliedRateRef = useRef(1);

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sectionsVersion, setSectionsVersion] = useState(0);
  const [sectionNotice, setSectionNotice] = useState<{
    id: string;
    message: string;
    kind: "error" | "info";
  } | null>(null);
  const [addNotice, setAddNotice] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [waveReady, setWaveReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

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
        const fitted = fitBetweenNeighbors(others, region.start, region.end, null);
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
        const fitted = fitBetweenNeighbors(others, region.start, region.end, prev);
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

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setBusy("曲を読み込んでいます…");
    try {
      const data = await file.arrayBuffer();
      const decoded = await getAudioContext().decodeAudioData(data);
      setFileName(file.name);
      setBuffer(decoded);
    } catch {
      setError("このファイルは読み込めませんでした。MP3・WAV・M4A などの音声ファイルを選んでください。");
    } finally {
      setBusy("");
    }
  };

  const loadSample = () => {
    setError("");
    setFileName("sample-waltz.wav");
    setBuffer(createSampleWaltz());
  };

  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const findRegion = (id: string) => regionsRef.current?.getRegions().find((r) => r.id === id);

  // 再生位置から NEW_SECTION_LENGTH 秒の区間を追加する
  const addSection = () => {
    const regions = regionsRef.current;
    if (!regions || !buffer) return;
    const start = Math.min(wsRef.current?.getCurrentTime() ?? 0, Math.max(0, buffer.duration - 1));
    const end = Math.min(buffer.duration, start + NEW_SECTION_LENGTH);
    regions.addRegion({ start, end, color: REGION_COLOR });
    // 重なって入らなかった場合は region-created 側でお知らせを出す
  };

  const updateSection = (id: string, patch: Partial<Omit<Section, "id">>) => {
    setSections((prev) => sortSections(prev.map((s) => (s.id === id ? { ...s, ...patch } : s))));
  };

  // 入力された秒数で区間の開始・終了を変える。おかしな値のときは元に戻す
  const setSectionTime = (section: Section, edge: "start" | "end", value: number) => {
    if (!buffer) return;
    const t = Math.round(Math.min(Math.max(0, value), buffer.duration) * 10) / 10;
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

  return (
    <div className={styles.editor}>
      <section
        className={`${styles.card} ${styles.drop} ${dragOver ? styles.dropActive : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <h2 className={styles.sectionTitle}>① 曲選択</h2>
        <div className={styles.dropBody}>
          <p className={styles.dropText}>ファイルをここにドラッグするか、ボタンから選べます。</p>
          <div className={styles.dropActions}>
            <label className={`${styles.button} ${styles.primary}`}>
              ファイルを選ぶ
              <input
                type="file"
                accept="audio/*"
                className={styles.hiddenInput}
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="button" className={styles.button} onClick={loadSample}>
              サンプル曲で試す
            </button>
          </div>
        </div>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          ② {hasAudio ? `『${fileName}』` : "曲が選ばれていません"}
        </h2>
        <div className={styles.waveWrap}>
          <div ref={waveRef} className={styles.wave} />
          {!hasAudio && <p className={styles.waveEmpty}>ここに波形が表示されます</p>}
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
          <h2 className={styles.sectionTitle}>③ 変更区間の編集</h2>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={addSection} disabled={!hasAudio}>
            ＋ 変更区間の追加
          </button>
        </div>
        <p className={styles.hint}>
          再生位置から区間を追加します。②の波形の上をなぞっても区間を追加できます。範囲は秒数で入力するか、波形の上で端をつまんで調整できます。区間の中は、設定したテンポで再生されます。
        </p>

        {addNotice && <p className={styles.fieldError}>{addNotice}</p>}

        {sections.length === 0 ? (
          <p className={styles.emptySections}>まだ変更区間はありません</p>
        ) : (
          <ol className={styles.sectionList}>
            {sections.map((s, i) => (
              <li
                key={s.id}
                className={`${styles.sectionItem} ${s.id === activeId ? styles.sectionItemActive : ""}`}
                onFocus={() => setActiveId(s.id)}
              >
                <div className={styles.sectionItemHead}>
                  <span className={styles.sectionBadge}>区間{i + 1}</span>
                  <span className={styles.selectionInfo}>
                    {formatTime(s.start)} 〜 {formatTime(s.end)}（{formatTime(s.end - s.start)}）
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

      {busy && (
        <div className={styles.busy} role="status">
          <span className={styles.spinner} />
          {busy}
        </div>
      )}
    </div>
  );
}
