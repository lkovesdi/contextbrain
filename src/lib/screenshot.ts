// Client-side screen capture (stills and recordings) + image normalization
// for chat attachments.
//
// Stills:
//   - Desktop (Tauri): `capture_screenshot` runs macOS's `screencapture -i` —
//     the ⌘⇧4 crosshair, region or window, any app.
//   - Browser: getDisplayMedia() → one frame off the shared window/screen.
// Recordings:
//   - Desktop: `capture_screen_recording` runs `screencapture -v -i` — the
//     region picker in video mode; stops via our Stop button (SIGINT) or the
//     menu bar ■; the finished .mov comes back over IPC as raw bytes.
//   - Browser: getDisplayMedia() + the mic → MediaRecorder (webm / mp4).
// Recordings are then reduced to frames + a narration transcript in
// video-frames.ts — no model takes video, so that IS the video.
// Paste (⌘V) and drag-drop are handled by the composer hook and land here
// only for normalization.

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  MAX_LONG_EDGE,
  MAX_RECORDING_SECONDS,
  type AttachmentMediaType,
} from "@/lib/chat-attachments";

/** PNG above this size gets re-encoded as JPEG — UI screenshots compress
    well as PNG, photos/gradients/video frames don't. */
const PNG_BUDGET_BYTES = 900_000;

export type NormalizedImage = {
  data: string;
  mediaType: AttachmentMediaType;
  url: string;
  width: number;
  height: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file isn't an image we can read."));
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))),
      type,
      quality
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read the image."));
    r.readAsDataURL(blob);
  });
}

/** Scale factor that brings a w×h source under MAX_LONG_EDGE. */
export function fitScale(width: number, height: number): number {
  return Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
}

/** Encode an already-drawn canvas: PNG, or JPEG when the PNG is heavy. */
export async function encodeCanvas(
  canvas: HTMLCanvasElement
): Promise<NormalizedImage> {
  const { width, height } = canvas;
  let blob = await canvasToBlob(canvas, "image/png");
  let mediaType: AttachmentMediaType = "image/png";
  if (blob.size > PNG_BUDGET_BYTES) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // JPEG has no alpha: matte transparent pixels onto white first so they
      // don't come out black. (Pixel data, not UI chrome — not a theme color.)
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
    }
    blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
    mediaType = "image/jpeg";
  }
  const url = await blobToDataUrl(blob);
  return { data: url.slice(url.indexOf(",") + 1), mediaType, url, width, height };
}

/** Downscale to ≤ MAX_LONG_EDGE and re-encode. Always re-encodes so
    HEIC/WebP/animated GIF pastes come out as something every model accepts. */
export async function normalizeImage(source: Blob): Promise<NormalizedImage> {
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    const scale = fitScale(img.naturalWidth, img.naturalHeight);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas isn't available in this browser.");
    ctx.drawImage(img, 0, 0, width, height);
    return await encodeCanvas(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const UPDATE_HINT =
  "Update ContextBrain to capture from the app — or take a screenshot with ⌘⇧4 (⌃ to copy) and paste it here.";

// A shell predating a command rejects with "not found"/"not allowed".
function mapInvokeError(e: unknown, fallback: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|not allowed/i.test(msg)) return new Error(UPDATE_HINT);
  return new Error(msg || fallback);
}

// ---- Stills ---------------------------------------------------------------

async function captureViaDesktop(): Promise<Blob | null> {
  let b64: string | null;
  try {
    b64 = await invoke<string | null>("capture_screenshot");
  } catch (e) {
    throw mapInvokeError(e, "Screenshot failed.");
  }
  return b64 ? base64ToBlob(b64, "image/png") : null;
}

function isUserCancel(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "NotAllowedError" || e.name === "AbortError")
  );
}

async function captureViaDisplayMedia(): Promise<Blob | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (e) {
    // Dismissing the share picker is a cancel, not an error.
    if (isUserCancel(e)) return null;
    throw e;
  }
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    // Wait for a real frame: the first ones after the picker closes can be
    // black or still show the picker's fade.
    await new Promise<void>((resolve) => {
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => void;
      };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => resolve());
      else setTimeout(resolve, 150);
    });
    await new Promise((r) => setTimeout(r, 200));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas isn't available in this browser.");
    ctx.drawImage(video, 0, 0);
    return await canvasToBlob(canvas, "image/png");
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** True when a Screenshot button makes sense here at all. */
export function canCaptureScreen(): boolean {
  if (typeof navigator === "undefined") return false;
  return isTauri() || typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/** Raw capture (not yet normalized). Resolves null when the user cancels. */
export async function captureScreenshot(): Promise<Blob | null> {
  if (isTauri()) return captureViaDesktop();
  if (typeof navigator.mediaDevices?.getDisplayMedia === "function") {
    return captureViaDisplayMedia();
  }
  throw new Error(
    "Screen capture isn't available in this browser — paste a screenshot instead."
  );
}

// ---- Recordings -----------------------------------------------------------

export type RecordingHandle = {
  /** Ask the recording to end; `done` resolves once the file is finalized. */
  stop: () => void;
  /** The finished recording, or null if the user cancelled before recording. */
  done: Promise<Blob | null>;
  /** Where the recording is being driven from — the tray words its hint on it. */
  source: "desktop" | "browser";
};

/** True when a Record button makes sense here at all. */
export function canRecordScreen(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  if (isTauri()) return true;
  return (
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof window.MediaRecorder === "function"
  );
}

function bytesToBlob(raw: unknown, type: string): Blob | null {
  // Custom-protocol IPC hands back an ArrayBuffer; the postMessage fallback
  // serializes raw bodies as a plain number array.
  let bytes: Uint8Array<ArrayBuffer> | null = null;
  if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
  else if (raw instanceof Uint8Array) bytes = Uint8Array.from(raw);
  else if (Array.isArray(raw)) bytes = Uint8Array.from(raw as number[]);
  if (!bytes || bytes.byteLength === 0) return null;
  return new Blob([bytes], { type });
}

function recordViaDesktop(): RecordingHandle {
  const done = invoke<unknown>("capture_screen_recording")
    .then((raw) => bytesToBlob(raw, "video/quicktime"))
    .catch((e) => {
      throw mapInvokeError(e, "Recording failed.");
    });
  return {
    source: "desktop",
    done,
    stop: () => {
      void invoke("stop_screen_recording").catch(() => {});
    },
  };
}

function pickMimeType(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

async function recordViaBrowser(): Promise<RecordingHandle> {
  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: false,
    });
  } catch (e) {
    if (isUserCancel(e)) {
      return { source: "browser", stop: () => {}, done: Promise.resolve(null) };
    }
    throw e;
  }
  // Narration: the mic is optional — a denied prompt just means no transcript.
  let mic: MediaStream | null = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    mic = null;
  }
  const tracks = [...display.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])];
  const stream = new MediaStream(tracks);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 2_500_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const cleanup = () => {
    display.getTracks().forEach((t) => t.stop());
    mic?.getTracks().forEach((t) => t.stop());
  };
  const done = new Promise<Blob | null>((resolve, reject) => {
    recorder.onstop = () => {
      cleanup();
      resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType }) : null);
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("Recording failed."));
    };
  });
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  // "Stop sharing" in the browser's own bar ends the recording too.
  display.getVideoTracks()[0]?.addEventListener("ended", stop);
  const cap = setTimeout(stop, MAX_RECORDING_SECONDS * 1000);
  void done.finally(() => clearTimeout(cap));

  recorder.start(1000);
  return { source: "browser", stop, done };
}

/** Start a screen recording. On desktop the user first picks a region (the
    handle's `done` resolves null if they cancel there). */
export async function startScreenRecording(): Promise<RecordingHandle> {
  if (isTauri()) return recordViaDesktop();
  if (canRecordScreen()) return recordViaBrowser();
  throw new Error("Screen recording isn't available in this browser.");
}
