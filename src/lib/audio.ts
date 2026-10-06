// ブラウザ内で完結する音声編集の処理（Web Audio API の AudioBuffer を直接扱う）

function createBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  return new AudioBuffer({
    numberOfChannels,
    length: Math.max(1, length),
    sampleRate,
  });
}

function clampRange(buffer: AudioBuffer, start: number, end: number) {
  const s = Math.max(0, Math.min(buffer.length, Math.round(start * buffer.sampleRate)));
  const e = Math.max(s, Math.min(buffer.length, Math.round(end * buffer.sampleRate)));
  return [s, e] as const;
}

/** start〜end 秒だけを残した新しいバッファを返す */
export function keepRange(buffer: AudioBuffer, start: number, end: number): AudioBuffer {
  const [s, e] = clampRange(buffer, start, end);
  const out = createBuffer(buffer.numberOfChannels, e - s, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(s, e));
  }
  return out;
}

/**
 * 音の高さを変えずにテンポだけを変える（WSOLA 方式のタイムストレッチ）。
 * rate > 1 で速く、rate < 1 でゆっくりになる。
 */
export function timeStretch(buffer: AudioBuffer, rate: number): AudioBuffer {
  if (Math.abs(rate - 1) < 1e-3) return buffer;

  const { sampleRate, numberOfChannels, length } = buffer;
  const frame = sampleRate >= 32000 ? 2048 : 1024;
  const synthesisHop = frame / 2;
  const analysisHop = synthesisHop * rate;
  const tolerance = frame / 4;

  const channels = Array.from({ length: numberOfChannels }, (_, ch) => buffer.getChannelData(ch));

  // 位置合わせの探索は、モノラルにして 1/4 に間引いた信号で行い計算量を抑える
  const decim = 4;
  const monoLen = Math.floor(length / decim);
  const mono = new Float32Array(monoLen);
  for (let i = 0; i < monoLen; i++) {
    let sum = 0;
    for (let ch = 0; ch < numberOfChannels; ch++) sum += channels[ch][i * decim];
    mono[i] = sum / numberOfChannels;
  }
  const corrLen = frame / decim / 2;

  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  const outLen = Math.ceil(length / rate) + frame;
  const out = createBuffer(numberOfChannels, outLen, sampleRate);
  const outData = Array.from({ length: numberOfChannels }, (_, ch) => out.getChannelData(ch));
  const weight = new Float32Array(outLen);

  let prevPos = 0;
  for (let k = 0; ; k++) {
    const outPos = k * synthesisHop;
    const nominal = Math.round(k * analysisHop);
    if (nominal + frame > length || outPos + frame > outLen) break;

    let pos = nominal;
    if (k > 0) {
      // 直前のフレームの自然な続きと最も似ている位置を探す
      const target = Math.floor((prevPos + synthesisHop) / decim);
      const lo = Math.max(0, Math.floor((nominal - tolerance) / decim));
      const hi = Math.min(monoLen - corrLen, Math.floor((nominal + tolerance) / decim), Math.floor((length - frame) / decim));
      if (target + corrLen <= monoLen && hi >= lo) {
        let best = -Infinity;
        let bestPos = lo;
        for (let p = lo; p <= hi; p++) {
          let c = 0;
          for (let i = 0; i < corrLen; i++) c += mono[p + i] * mono[target + i];
          if (c > best) {
            best = c;
            bestPos = p;
          }
        }
        pos = Math.min(bestPos * decim, length - frame);
      }
    }

    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = channels[ch];
      const dst = outData[ch];
      for (let i = 0; i < frame; i++) dst[outPos + i] += src[pos + i] * window[i];
    }
    for (let i = 0; i < frame; i++) weight[outPos + i] += window[i];
    prevPos = pos;
  }

  let lastIndex = 0;
  for (let i = 0; i < outLen; i++) {
    if (weight[i] > 1e-3) {
      for (let ch = 0; ch < numberOfChannels; ch++) outData[ch][i] /= weight[i];
      lastIndex = i;
    }
  }

  const trimmed = Math.min(outLen, Math.max(lastIndex + 1, Math.round(length / rate)));
  return keepRange(out, 0, trimmed / sampleRate);
}

/** AudioBuffer を 16bit PCM の WAV ファイルに変換する */
export function encodeWav(buffer: AudioBuffer): Blob {
  const { numberOfChannels, sampleRate, length } = buffer;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataSize));

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: numberOfChannels }, (_, ch) => buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/** 試し用に、オルゴール風の 3 拍子（ワルツ）の短い曲を合成する */
export function createSampleWaltz(sampleRate = 44100): AudioBuffer {
  const bpm = 132;
  const beat = 60 / bpm;
  // [音の高さ(MIDI), 拍数] のメロディ。0 は休符
  const melody: [number, number][] = [
    [76, 1], [79, 1], [84, 1], [83, 2], [79, 1],
    [81, 1], [77, 1], [74, 1], [79, 3],
    [76, 1], [79, 1], [84, 1], [86, 2], [84, 1],
    [83, 1], [81, 1], [79, 1], [84, 3],
  ];
  const bass = [48, 43, 53, 43, 48, 45, 43, 48];

  const totalBeats = melody.reduce((sum, [, b]) => sum + b, 0);
  const length = Math.ceil((totalBeats * beat + 1.5) * sampleRate);
  const buffer = createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const pluck = (midi: number, startSec: number, durSec: number, gain: number, pan: number) => {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const start = Math.floor(startSec * sampleRate);
    const len = Math.floor((durSec + 0.8) * sampleRate);
    for (let i = 0; i < len && start + i < length; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t * 200) * Math.exp(-t * 3.2);
      const v =
        gain *
        env *
        (Math.sin(2 * Math.PI * freq * t) +
          0.35 * Math.sin(2 * Math.PI * freq * 2 * t) +
          0.12 * Math.sin(2 * Math.PI * freq * 3 * t));
      left[start + i] += v * (1 - pan);
      right[start + i] += v * (1 + pan);
    }
  };

  let t = 0;
  for (const [note, beats] of melody) {
    if (note > 0) pluck(note, t, beats * beat, 0.16, 0.15);
    t += beats * beat;
  }
  // 伴奏は 1 小節ごとに「ズン・チャッ・チャッ」
  const bars = Math.ceil(totalBeats / 3);
  for (let bar = 0; bar < bars; bar++) {
    const root = bass[bar % bass.length];
    const barStart = bar * 3 * beat;
    pluck(root, barStart, beat, 0.2, -0.2);
    pluck(root + 16, barStart + beat, beat * 0.5, 0.07, -0.1);
    pluck(root + 19, barStart + beat, beat * 0.5, 0.07, -0.1);
    pluck(root + 16, barStart + 2 * beat, beat * 0.5, 0.07, -0.1);
    pluck(root + 19, barStart + 2 * beat, beat * 0.5, 0.07, -0.1);
  }
  return buffer;
}

/** start〜end 秒の区間だけテンポを変えた新しいバッファを返す（前後はそのまま） */
export function stretchRange(
  buffer: AudioBuffer,
  start: number,
  end: number,
  rate: number,
): AudioBuffer {
  const [s, e] = clampRange(buffer, start, end);
  if (e - s < 2048 || Math.abs(rate - 1) < 1e-3) return buffer;

  const middle = timeStretch(keepRange(buffer, start, end), rate);
  const out = createBuffer(
    buffer.numberOfChannels,
    s + middle.length + (buffer.length - e),
    buffer.sampleRate,
  );
  // つなぎ目のプチッという音を防ぐための短いクロスフェード
  const fade = Math.min(Math.floor(buffer.sampleRate * 0.005), Math.floor(middle.length / 4));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const mid = middle.getChannelData(ch);
    const dst = out.getChannelData(ch);
    dst.set(src.subarray(0, s), 0);
    dst.set(mid, s);
    dst.set(src.subarray(e), s + mid.length);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      if (s > 0) dst[s + i] = mid[i] * g + src[s + i] * (1 - g);
      const j = s + mid.length - fade + i;
      if (e < buffer.length) dst[j] = mid[mid.length - fade + i] * (1 - g) + src[e - fade + i] * g;
    }
  }
  return out;
}
