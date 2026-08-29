// Turns a screen recording into what a model can read: a handful of
// timestamped frames (dedup'd — a static screen yields one frame, a flow
// yields one per visible change) and a 16 kHz mono WAV of the narration for
// transcription. Runs entirely in the browser — no ffmpeg. Two inputs:
// a video file (browser MediaRecorder) via extractFrames, or stills already
// sampled over time (desktop `screencapture -R` loop) via dedupeFrames.

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
  source: CanvasImageSource,
  ctx: CanvasRenderingContext2D
): Uint8ClampedArray {
  ctx.drawImage(source, 0, 0, FP_W, FP_H);
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

function fingerprintCanvas(): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = FP_W;
  c.height = FP_H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas isn't available in this browser.");
  return ctx;
}

/** Too many changes → keep ≤ max, evenly spaced, both ends included. */
function thinEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (items.length - 1)) / (max - 1));
    if (out[out.length - 1] !== items[idx]) out.push(items[idx]);
  }
  return out;
}

async function encodeScaled(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number
): Promise<NormalizedImage> {
  const scale = fitScale(srcWidth, srcHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcWidth * scale));
  canvas.height = Math.max(1, Math.round(srcHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't available in this browser.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return encodeCanvas(canvas);
}

/** Desktop path: stills sampled ~1/s → keep the ones where the picture
    changed (first and last always), ≤ maxFrames, downscaled + encoded. */
export async function dedupeFrames(
  stills: Array<{ t: number; blob: Blob }>,
  maxFrames = MAX_VIDEO_FRAMES
): Promise<ExtractedFrame[]> {
  if (!stills.length) return [];
  const fpCtx = fingerprintCanvas();
  const kept: Array<{ t: number; bitmap: ImageBitmap }> = [];
  let lastFp: Uint8ClampedArray | null = null;
  for (let i = 0; i < stills.length; i++) {
    const bitmap = await createImageBitmap(stills[i].blob);
    const fp = fingerprint(bitmap, fpCtx);
    const isEdge = i === 0 || i === stills.length - 1;
    if (isEdge || !lastFp || meanDiff(fp, lastFp) > CHANGE_THRESHOLD) {
      kept.push({ t: stills[i].t, bitmap });
      lastFp = fp;
    } else {
      bitmap.close();
    }
  }
  const chosen = thinEvenly(kept, maxFrames);
  const frames: ExtractedFrame[] = [];
  for (const k of kept) {
    if (chosen.includes(k)) {
      frames.push({ t: k.t, image: await encodeScaled(k.bitmap, k.bitmap.width, k.bitmap.height) });
    }
    k.bitmap.close();
  }
  return frames;
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

    const fpCtx = fingerprintCanvas();

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

    const chosen = thinEvenly(kept, maxFrames);
    const frames: ExtractedFrame[] = [];
    for (const t of chosen) {
      await seek(video, t);
      frames.push({
        t,
        image: await encodeScaled(video, video.videoWidth, video.videoHeight),
      });
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
