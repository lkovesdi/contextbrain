// Turns a screen recording into what a model can read: a handful of
// timestamped frames (dedup'd — a static screen yields one frame, a flow
// yields one per visible change) and a 16 kHz mono WAV of the narration for
// transcription. Runs entirely in the browser off a <video> element and
// canvas — no ffmpeg, works on the desktop .mov and the browser .webm alike.

import { MAX_RECORDING_SECONDS, MAX_VIDEO_FRAMES } from "@/lib/chat-attachments";
import { encodeCanvas, fitScale, type NormalizedImage } from "@/lib/screenshot";

export type ExtractedFrame = { t: number; image: NormalizedImage };

/** Mean absolute gray-level difference (0–255) above which two candidate
    frames count as "something changed". Cursor blink stays under it;
    a menu opening or a page changing clears it. */
const CHANGE_THRESHOLD = 6;
const FP_W = 32;
const FP_H = 18;

function once<K extends keyof HTMLVideoElementEventMap>(
  video: HTMLVideoElement,
  event: K,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      reject(new Error("Couldn't read that recording."));
    }, timeoutMs);
    const onEvent = () => {
      clearTimeout(timer);
      video.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      reject(new Error("Couldn't read that recording."));
    };
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function loadVideo(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await once(video, "loadedmetadata", 15_000);
  // MediaRecorder's webm has no duration header (Infinity) until the element
  // has seen the end — the classic seek-past-the-end trick forces it.
  if (!Number.isFinite(video.duration)) {
    video.currentTime = 1e101;
    await once(video, "timeupdate", 15_000);
  }
  return { video, revoke: () => URL.revokeObjectURL(url) };
}

async function seek(video: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.05));
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return;
  video.currentTime = target;
  await once(video, "seeked", 5_000);
}

function fingerprint(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D
): Uint8ClampedArray {
  ctx.drawImage(video, 0, 0, FP_W, FP_H);
  const { data } = ctx.getImageData(0, 0, FP_W, FP_H);
  const gray = new Uint8ClampedArray(FP_W * FP_H);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return gray;
}

function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** Sample ≤ maxFrames frames where the picture actually changed. */
export async function extractFrames(
  blob: Blob,
  maxFrames = MAX_VIDEO_FRAMES
): Promise<{ frames: ExtractedFrame[]; duration: number }> {
  const { video, revoke } = await loadVideo(blob);
  try {
    const duration = Math.min(
      Number.isFinite(video.duration) ? video.duration : 0,
      MAX_RECORDING_SECONDS + 5
    );
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("That recording has no video track.");
    }

    // Candidate instants: one per second (or ~120 evenly spaced for long clips).
    const step = duration <= 120 ? 1 : duration / 120;
    const candidates: number[] = [];
    for (let t = 0; t < duration; t += step) candidates.push(t);
    const last = Math.max(0, duration - 0.1);
    if (!candidates.length || last - candidates[candidates.length - 1] > 0.3) {
      candidates.push(last);
    }

    const fpCanvas = document.createElement("canvas");
    fpCanvas.width = FP_W;
    fpCanvas.height = FP_H;
    const fpCtx = fpCanvas.getContext("2d", { willReadFrequently: true });
    if (!fpCtx) throw new Error("Canvas isn't available in this browser.");

    // Keep an instant when it differs from the last kept one; always keep
    // the first and the last so the start and end states are both present.
    const kept: number[] = [];
    let lastFp: Uint8ClampedArray | null = null;
    for (let i = 0; i < candidates.length; i++) {
      await seek(video, candidates[i]);
      const fp = fingerprint(video, fpCtx);
      const isEdge = i === 0 || i === candidates.length - 1;
      if (isEdge || !lastFp || meanDiff(fp, lastFp) > CHANGE_THRESHOLD) {
        kept.push(candidates[i]);
        lastFp = fp;
      }
    }

    // Too many changes → thin evenly, keeping both ends.
    let chosen = kept;
    if (kept.length > maxFrames) {
      chosen = [];
      for (let i = 0; i < maxFrames; i++) {
        const idx = Math.round((i * (kept.length - 1)) / (maxFrames - 1));
        if (chosen[chosen.length - 1] !== kept[idx]) chosen.push(kept[idx]);
      }
    }

    const scale = fitScale(video.videoWidth, video.videoHeight);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const frames: ExtractedFrame[] = [];
    for (const t of chosen) {
      await seek(video, t);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas isn't available in this browser.");
      ctx.drawImage(video, 0, 0, width, height);
      frames.push({ t, image: await encodeCanvas(canvas) });
    }
    return { frames, duration };
  } finally {
    revoke();
    video.removeAttribute("src");
    video.load();
  }
}

function writeWavHeader(view: DataView, sampleRate: number, dataBytes: number) {
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataBytes, true);
}

/** Decode the recording's audio to 16 kHz mono 16-bit WAV for transcription.
    Resolves null when there's no audio track or it's effectively silent —
    no point paying to transcribe nothing. */
export async function extractAudioWav(
  blob: Blob,
  sampleRate = 16000
): Promise<Blob | null> {
  const Offline =
    typeof OfflineAudioContext === "function"
      ? OfflineAudioContext
      : (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
  if (!Offline) return null;
  const bytes = await blob.arrayBuffer();
  // decodeAudioData resamples to the context's rate, so this yields 16 kHz.
  const ctx = new Offline(1, 1, sampleRate);
  let decoded: AudioBuffer;
  try {
    decoded = await new Promise<AudioBuffer>((resolve, reject) =>
      ctx.decodeAudioData(bytes.slice(0), resolve, () =>
        reject(new Error("no audio"))
      )
    );
  } catch {
    return null;
  }

  const length = Math.min(decoded.length, (MAX_RECORDING_SECONDS + 5) * sampleRate);
  const mono = new Float32Array(length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  let energy = 0;
  for (let i = 0; i < length; i++) energy += mono[i] * mono[i];
  const rms = Math.sqrt(energy / Math.max(1, length));
  if (rms < 0.003) return null;

  const out = new ArrayBuffer(44 + length * 2);
  const view = new DataView(out);
  writeWavHeader(view, sampleRate, length * 2);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out], { type: "audio/wav" });
}
