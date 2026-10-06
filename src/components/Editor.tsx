"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPluginClass from "wavesurfer.js/dist/plugins/regions.esm.js";
import {
  createSampleWaltz,
  cutRange,
  encodeWav,
  timeStretch,
} from "@/lib/audio";
import styles from "./Editor.module.css";

type Selection = { start: number; end: number };
type RegionsPlugin = ReturnType<typeof RegionsPluginClass.create>;

// 波形の色はライト・ダークどちらの背景でも見えるものにしている
const REGION_COLOR = "rgba(56, 182, 240, 0.25)";
const MAX_HISTORY = 20;

function formatTime(sec: number) {
  if (!Number.isFinite(sec)) return "0:00.0";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "") || "ballet";
}

export default function Editor() {
  const waveRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rateRef = useRef(1);

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [history, setHistory] = useState<AudioBuffer[]>([]);
  const [fileName, setFileName] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [zoom, setZoom] = useState(0);
  const [waveReady, setWaveReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

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

      regions.enableDragSelection({ color: REGION_COLOR });
      regions.on("region-created", (region) => {
        for (const r of regions.getRegions()) if (r !== region) r.remove();
        setSelection({ start: region.start, end: region.end });
      });
      regions.on("region-updated", (region) => {
        setSelection({ start: region.start, end: region.end });
      });
      regions.on("region-removed", () => {
        if (regions.getRegions().length === 0) setSelection(null);
      });

      ws.on("play", () => setIsPlaying(true));
      ws.on("pause", () => setIsPlaying(false));
      ws.on("finish", () => setIsPlaying(false));
      ws.on("timeupdate", (t) => setCurrentTime(t));
      ws.on("ready", () => {
        ws.setPlaybackRate(rateRef.current, true);
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
  }, []);

  // バッファが変わるたびに波形を描き直す
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !buffer) return;
    regionsRef.current?.clearRegions();
    setSelection(null);
    setCurrentTime(0);
    setWaveReady(false);
    ws.loadBlob(encodeWav(buffer)).catch(() => {});
  }, [buffer]);

  useEffect(() => {
    if (wsRef.current && waveReady) wsRef.current.zoom(zoom);
  }, [zoom, waveReady]);

  const getAudioContext = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  };

  const loadNewBuffer = (next: AudioBuffer, name: string) => {
    setHistory([]);
    setFileName(name);
    setBuffer(next);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setBusy("曲を読み込んでいます…");
    try {
      const data = await file.arrayBuffer();
      const decoded = await getAudioContext().decodeAudioData(data);
      loadNewBuffer(decoded, file.name);
    } catch {
      setError("このファイルは読み込めませんでした。MP3・WAV・M4A などの音声ファイルを選んでください。");
    } finally {
      setBusy("");
    }
  };

  const loadSample = () => {
    setError("");
    loadNewBuffer(createSampleWaltz(), "sample-waltz.wav");
  };

  const applyEdit = (edit: (b: AudioBuffer) => AudioBuffer) => {
    if (!buffer) return;
    wsRef.current?.pause();
    setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), buffer]);
    setBuffer(edit(buffer));
  };

  const handleCut = () => {
    if (!selection) return;
    applyEdit((b) => cutRange(b, selection.start, selection.end));
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    wsRef.current?.pause();
    setBuffer(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  };

  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const playSelection = () => {
    regionsRef.current?.getRegions()[0]?.play(true);
  };

  const clearSelection = () => {
    regionsRef.current?.clearRegions();
    setSelection(null);
  };

  const handleRate = (value: number) => {
    rateRef.current = value;
    setRate(value);
    wsRef.current?.setPlaybackRate(value, true);
  };

  const handleExport = () => {
    if (!buffer) return;
    setBusy("書き出しの準備をしています…");
    // 描画を先に反映させてから重い処理を行う
    setTimeout(() => {
      try {
        const stretched = timeStretch(buffer, rate);
        const url = URL.createObjectURL(encodeWav(stretched));
        const a = document.createElement("a");
        a.href = url;
        const tempo = rate === 1 ? "" : `_x${rate.toFixed(2)}`;
        a.download = `${baseName(fileName)}_edit${tempo}.wav`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        setError("書き出しに失敗しました。もう一度お試しください。");
      } finally {
        setBusy("");
      }
    }, 50);
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
        <div className={styles.dropText}>
          <strong>{hasAudio ? fileName : "曲をえらんでください"}</strong>
          <span>
            {hasAudio
              ? `長さ ${formatTime(duration)}`
              : "ファイルをここにドラッグするか、ボタンから選べます"}
          </span>
        </div>
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
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.card}>
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
        <p className={styles.hint}>
          波形の上をなぞると範囲を選べます。端をつまむと範囲を調整できます。
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.button} ${styles.play}`}
            onClick={togglePlay}
            disabled={!hasAudio}
            aria-label={isPlaying ? "一時停止" : "再生"}
          >
            {isPlaying ? "❚❚ 一時停止" : "▶ 再生"}
          </button>
          <button type="button" className={styles.button} onClick={handleUndo} disabled={history.length === 0}>
            ↶ 元に戻す
          </button>
        </div>

        <h2 className={styles.heading}>えらんだ範囲</h2>
        <p className={styles.selectionInfo}>
          {selection
            ? `${formatTime(selection.start)} 〜 ${formatTime(selection.end)}（${formatTime(selection.end - selection.start)}）`
            : "まだ選ばれていません"}
        </p>
        <div className={styles.controls}>
          <button type="button" className={styles.button} onClick={playSelection} disabled={!selection}>
            ▶ 範囲を再生
          </button>
          <button type="button" className={`${styles.button} ${styles.danger}`} onClick={handleCut} disabled={!selection}>
            ✂ カット
          </button>
          <button type="button" className={styles.button} onClick={clearSelection} disabled={!selection}>
            選択を解除
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.heading}>テンポ</h2>
        <div className={styles.tempoRow}>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={rate}
            onChange={(e) => handleRate(Number(e.target.value))}
            className={styles.tempoSlider}
            aria-label="テンポ"
          />
          <span className={styles.tempoValue}>{Math.round(rate * 100)}%</span>
        </div>
        <div className={styles.controls}>
          {[0.75, 0.9, 1, 1.1].map((preset) => (
            <button
              key={preset}
              type="button"
              className={`${styles.chip} ${Math.abs(rate - preset) < 1e-3 ? styles.chipActive : ""}`}
              onClick={() => handleRate(preset)}
            >
              {preset === 1 ? "もとの速さ" : `${Math.round(preset * 100)}%`}
            </button>
          ))}
        </div>
        <p className={styles.hint}>音の高さは変えずに速さだけを変えます。書き出しにも反映されます。</p>
      </section>

      <section className={`${styles.card} ${styles.exportCard}`}>
        <button
          type="button"
          className={`${styles.button} ${styles.primary} ${styles.export}`}
          onClick={handleExport}
          disabled={!hasAudio || busy !== ""}
        >
          WAV で書き出す
        </button>
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
