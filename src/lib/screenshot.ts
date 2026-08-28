// Client-side image capture + normalization for chat attachments.
//
// Two capture paths:
//   - Desktop (Tauri): the `capture_screenshot` command runs macOS's own
//     `screencapture -i` — the ⌘⇧4 crosshair, region or window, any app.
//   - Browser: getDisplayMedia() → one frame off the shared window/screen.
//     No region picker (the browser's share dialog is the selector), but it
//     works in Chrome/Edge/Safari with nothing installed.
// Paste (⌘V) and drag-drop are handled by the composer hook and land here
// only for normalization.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { MAX_LONG_EDGE, type AttachmentMediaType } from "@/lib/chat-attachments";

/** PNG above this size gets re-encoded as JPEG — UI screenshots compress
    well as PNG, photos/gradients don't. */
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

/** Downscale to ≤ MAX_LONG_EDGE and re-encode (PNG, or JPEG when the PNG is
    heavy). Always re-encodes so HEIC/WebP/animated GIF pastes come out as
    something every model accepts. */
export async function normalizeImage(source: Blob): Promise<NormalizedImage> {
  const objectUrl = URL.createObjectURL(source);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(
      1,
      MAX_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight)
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas isn't available in this browser.");
    ctx.drawImage(img, 0, 0, width, height);

    let blob = await canvasToBlob(canvas, "image/png");
    let mediaType: AttachmentMediaType = "image/png";
    if (blob.size > PNG_BUDGET_BYTES) {
      // JPEG has no alpha: matte transparent pixels onto white first so they
      // don't come out black. (Pixel data, not UI chrome — not a theme color.)
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
      mediaType = "image/jpeg";
    }
    const url = await blobToDataUrl(blob);
    return { data: url.slice(url.indexOf(",") + 1), mediaType, url, width, height };
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
  "Update ContextBrain to capture screenshots from the app — or take one with ⌘⇧4 (⌃ to copy) and paste it here.";

async function captureViaDesktop(): Promise<Blob | null> {
  let b64: string | null;
  try {
    b64 = await invoke<string | null>("capture_screenshot");
  } catch (e) {
    // A shell predating the command rejects with "not found"/"not allowed".
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|not allowed/i.test(msg)) throw new Error(UPDATE_HINT);
    throw new Error(msg || "Screenshot failed.");
  }
  return b64 ? base64ToBlob(b64, "image/png") : null;
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
    if (
      e instanceof DOMException &&
      (e.name === "NotAllowedError" || e.name === "AbortError")
    ) {
      return null;
    }
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
