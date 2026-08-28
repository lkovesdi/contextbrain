// Chat image attachments — shared shapes for the client composer, the chat
// API, and the history loaders. Framework-free so server and client code can
// both import it.
//
// Lifecycle of an attachment:
//   1. Client captures/pastes an image → normalized (≤ MAX_LONG_EDGE px,
//      PNG or JPEG) and held in memory as base64 (`data`) for the session.
//   2. Every /api/chat call re-sends the base64 for attachments added this
//      session; the route inlines them as image parts for the model.
//   3. The route uploads new images to the private `chat-attachments` bucket
//      and stores `{ path, media_type }` on chat_messages.attachments.
//   4. On reload, history rows carry `path` only; the client previews them via
//      /api/chat/attachments/<path> and the route re-downloads them from
//      storage when an older turn needs to reach the model.

export const ATTACHMENTS_BUCKET = "chat-attachments";

/** Max images per message. Keeps a single request bounded (~1.6k tokens each). */
export const MAX_ATTACHMENTS = 6;

/** Anthropic downsizes anything above this on the long edge — resize
    client-side instead so uploads stay small and nothing is lost in transit. */
export const MAX_LONG_EDGE = 1568;

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

/** What lives in chat_messages.attachments (jsonb). */
export type StoredAttachment = {
  path: string;
  media_type: AttachmentMediaType;
  width?: number;
  height?: number;
};

/** What the client holds per message. Fresh images carry `data`; ones loaded
    from history carry `path`. `url` is always something an <img> can show. */
export type ChatAttachment = {
  id: string;
  mediaType: AttachmentMediaType;
  url: string;
  data?: string;
  path?: string;
  width?: number;
  height?: number;
};

/** Wire shape for /api/chat — one of `data` (base64) or `path`. */
export type RequestAttachment = {
  media_type: AttachmentMediaType;
  data?: string;
  path?: string;
};

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

function isStoredAttachment(v: unknown): v is StoredAttachment {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.path === "string" &&
    ATTACHMENT_PATH_RE.test(o.path) &&
    typeof o.media_type === "string" &&
    (ATTACHMENT_MEDIA_TYPES as string[]).includes(o.media_type)
  );
}

/** chat_messages.attachments (untyped jsonb) → client attachments. Tolerates
    the column being absent (pre-migration rows) and junk values. */
export function attachmentsFromStored(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredAttachment).map((a) => ({
    id: a.path,
    mediaType: a.media_type,
    url: attachmentUrl(a.path),
    path: a.path,
    width: a.width,
    height: a.height,
  }));
}

/** Client attachments → what /api/chat expects. `undefined` when empty so
    text-only messages serialize exactly as before. */
export function toRequestAttachments(
  attachments: ChatAttachment[] | undefined
): RequestAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map((a) =>
    a.data
      ? { media_type: a.mediaType, data: a.data }
      : { media_type: a.mediaType, path: a.path }
  );
}
