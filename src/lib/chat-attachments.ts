// Chat attachments — shared shapes for the client composer, the chat API, and
// the history loaders. Framework-free so server and client code can both
// import it.
//
// Two kinds:
//   - image: a screenshot / pasted / dropped picture.
//   - video: a screen recording, already reduced client-side to what the
//     model can consume — a handful of timestamped frames plus a transcript
//     of the narration. No model takes video input; this is the video.
//
// Lifecycle:
//   1. Client captures → normalizes (≤ MAX_LONG_EDGE px, PNG or JPEG) and
//      holds base64 (`data`) in memory for the session.
//   2. Every /api/chat call re-sends the base64 for attachments added this
//      session; the route inlines them as image parts for the model.
//   3. The route uploads new images to the private `chat-attachments` bucket
//      and stores `{ path, media_type }` (per image / per frame) on
//      chat_messages.attachments.
//   4. On reload, history rows carry `path` only; the client previews them
//      via /api/chat/attachments/<path> and the route re-downloads them from
//      storage when an older turn needs to reach the model.

export const ATTACHMENTS_BUCKET = "chat-attachments";

/** Max attachments per message (a recording counts as one). */
export const MAX_ATTACHMENTS = 6;

/** Anthropic downsizes anything above this on the long edge — resize
    client-side instead so uploads stay small and nothing is lost in transit. */
export const MAX_LONG_EDGE = 1568;

/** Frames kept per recording — enough to follow a flow, bounded for cost
    (~2k tokens each). */
export const MAX_VIDEO_FRAMES = 12;

/** Recording length cap. Desktop recordings are full-res H.264 that travel
    over IPC as raw bytes (~2 MB/s for a full Retina screen), so keep it short. */
export const MAX_RECORDING_SECONDS = 60;

export type AttachmentMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export const ATTACHMENT_MEDIA_TYPES: AttachmentMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** Storage object key: `<user_id>/<uuid>.<ext>` — the folder is the owner,
    which is what the bucket's RLS policies key on. */
export const ATTACHMENT_PATH_RE =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/;

// ---- What lives in chat_messages.attachments (jsonb) -----------------------

export type StoredImage = {
  kind?: "image";
  path: string;
  media_type: AttachmentMediaType;
  width?: number;
  height?: number;
};
export type StoredVideoFrame = {
  path: string;
  media_type: AttachmentMediaType;
  t: number;
};
export type StoredVideo = {
  kind: "video";
  duration: number;
  transcript: string | null;
  frames: StoredVideoFrame[];
};
export type StoredAttachment = StoredImage | StoredVideo;

// ---- What the client holds per message -------------------------------------
// Fresh images carry `data`; ones loaded from history carry `path`. `url` is
// always something an <img> can show.

export type ImageAttachment = {
  kind: "image";
  id: string;
  mediaType: AttachmentMediaType;
  url: string;
  data?: string;
  path?: string;
  width?: number;
  height?: number;
};
export type VideoFrame = {
  mediaType: AttachmentMediaType;
  url: string;
  data?: string;
  path?: string;
  /** Seconds into the recording. */
  t: number;
};
export type VideoAttachment = {
  kind: "video";
  id: string;
  duration: number;
  transcript: string | null;
  frames: VideoFrame[];
};
export type ChatAttachment = ImageAttachment | VideoAttachment;

// ---- Wire shape for /api/chat ---------------------------------------------

export type RequestImage = {
  kind?: "image";
  media_type: AttachmentMediaType;
  data?: string;
  path?: string;
};
export type RequestVideoFrame = {
  media_type: AttachmentMediaType;
  data?: string;
  path?: string;
  t: number;
};
export type RequestVideo = {
  kind: "video";
  duration: number;
  transcript: string | null;
  frames: RequestVideoFrame[];
};
export type RequestAttachment = RequestImage | RequestVideo;

export function attachmentUrl(path: string): string {
  return `/api/chat/attachments/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function extensionFor(mediaType: AttachmentMediaType): string {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
  }
}

export function mediaTypeForPath(path: string): AttachmentMediaType {
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  return "image/png";
}

/** 83 → "1:23". */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function isStoredRef(v: unknown): v is { path: string; media_type: AttachmentMediaType } {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.path === "string" &&
    ATTACHMENT_PATH_RE.test(o.path) &&
    typeof o.media_type === "string" &&
    (ATTACHMENT_MEDIA_TYPES as string[]).includes(o.media_type)
  );
}

function isStoredImage(v: unknown): v is StoredImage {
  return isStoredRef(v) && (v as { kind?: string }).kind !== "video";
}

function isStoredVideo(v: unknown): v is StoredVideo {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.kind === "video" &&
    typeof o.duration === "number" &&
    Array.isArray(o.frames) &&
    o.frames.length > 0 &&
    o.frames.every(
      (f) => isStoredRef(f) && typeof (f as StoredVideoFrame).t === "number"
    )
  );
}

/** chat_messages.attachments (untyped jsonb) → client attachments. Tolerates
    the column being absent (pre-migration rows) and junk values. */
export function attachmentsFromStored(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  for (const v of raw) {
    if (isStoredVideo(v)) {
      out.push({
        kind: "video",
        id: v.frames[0].path,
        duration: v.duration,
        transcript: typeof v.transcript === "string" ? v.transcript : null,
        frames: v.frames.map((f) => ({
          mediaType: f.media_type,
          url: attachmentUrl(f.path),
          path: f.path,
          t: f.t,
        })),
      });
    } else if (isStoredImage(v)) {
      out.push({
        kind: "image",
        id: v.path,
        mediaType: v.media_type,
        url: attachmentUrl(v.path),
        path: v.path,
        width: v.width,
        height: v.height,
      });
    }
  }
  return out;
}

/** Every storage key referenced by a row's attachments — for cleanup. */
export function storedAttachmentPaths(raw: unknown): string[] {
  return attachmentsFromStored(raw).flatMap((a) =>
    a.kind === "video"
      ? a.frames.map((f) => f.path!).filter(Boolean)
      : a.path
        ? [a.path]
        : []
  );
}

/** Client attachments → what /api/chat expects. `undefined` when empty so
    text-only messages serialize exactly as before. */
export function toRequestAttachments(
  attachments: ChatAttachment[] | undefined
): RequestAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map((a): RequestAttachment => {
    if (a.kind === "video") {
      return {
        kind: "video",
        duration: a.duration,
        transcript: a.transcript,
        frames: a.frames.map((f) =>
          f.data
            ? { media_type: f.mediaType, data: f.data, t: f.t }
            : { media_type: f.mediaType, path: f.path, t: f.t }
        ),
      };
    }
    return a.data
      ? { kind: "image", media_type: a.mediaType, data: a.data }
      : { kind: "image", media_type: a.mediaType, path: a.path };
  });
}
