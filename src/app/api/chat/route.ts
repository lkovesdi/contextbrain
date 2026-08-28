import { anthropicModel } from "@/lib/llm";
import { creditErrorResponse } from "@/lib/credits";
import {
  streamText,
  type ImagePart,
  type ModelMessage,
  type TextPart,
} from "ai";
import { retrieve, type RetrievedChunk, type ContextSelection } from "@/lib/retrieve";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserVerified } from "@/lib/supabase/auth";
import type { Provider } from "@/lib/composio";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_MEDIA_TYPES,
  ATTACHMENT_PATH_RE,
  MAX_ATTACHMENTS,
  MAX_VIDEO_FRAMES,
  extensionFor,
  formatTimestamp,
  type AttachmentMediaType,
  type StoredAttachment,
} from "@/lib/chat-attachments";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const maxDuration = 60;

// Base64 of a ≤1568px PNG/JPEG lands well under this; the cap just stops a
// hostile client from posting a 100 MB "image".
const MAX_ATTACHMENT_B64 = 6_000_000;
// Images (screenshots + recording frames) one model call may carry. The
// client re-sends the whole thread every turn, so this bounds cost on
// screenshot-heavy chats; the newest images win.
const MAX_IMAGES_IN_CONTEXT = 24;
// Anthropic's rule of thumb is (w×h)/750 tokens — a 1568×980 screenshot ≈ 2k.
const APPROX_TOKENS_PER_IMAGE = 2000;

const ImageRef = z
  .object({
    media_type: z.enum(ATTACHMENT_MEDIA_TYPES),
    // Fresh this session: base64 payload.
    data: z.string().max(MAX_ATTACHMENT_B64).optional(),
    // Loaded from history: storage key under the caller's own folder.
    path: z.string().regex(ATTACHMENT_PATH_RE).optional(),
  })
  .refine((a) => !!(a.data || a.path), {
    message: "attachment needs data or path",
  });
type ImageRef = z.infer<typeof ImageRef>;

const ImageAttachment = ImageRef.and(
  z.object({ kind: z.literal("image").optional() })
);
// A screen recording, pre-reduced by the client to timestamped frames + the
// narration transcript (see src/lib/video-frames.ts).
const VideoAttachment = z.object({
  kind: z.literal("video"),
  duration: z.number().min(0).max(3600),
  transcript: z.string().max(20_000).nullable(),
  frames: z
    .array(ImageRef.and(z.object({ t: z.number().min(0).max(3600) })))
    .min(1)
    .max(MAX_VIDEO_FRAMES),
});
const Attachment = z.union([VideoAttachment, ImageAttachment]);
type Attachment = z.infer<typeof Attachment>;

const Message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  attachments: z.array(Attachment).max(MAX_ATTACHMENTS).optional(),
});
type Message = z.infer<typeof Message>;

const Body = z.object({
  messages: z.array(Message),
  selection: z
    .object({
      meeting_id: z.string().uuid().optional(),
      include_notes: z.boolean().optional(),
      external_context_ids: z.array(z.string().uuid()).optional(),
      note_ids: z.array(z.string().uuid()).optional(),
      space_id: z.string().uuid().nullable().optional(),
      space_wide: z.boolean().optional(),
      tag_ids: z.array(z.string().uuid()).optional(),
      recent_summary_count: z.number().int().min(1).max(20).optional(),
      integrations: z
        .array(
          z.object({
            provider: z.enum([
              "github",
              "jira",
              "figma",
              "linear",
              "linkedin",
              "zoom",
              "slack",
              "gmail",
            ]),
          })
        )
        .optional(),
    })
    .default({}),
  meeting_id: z.string().uuid().optional(),
  // Space chat: persists the thread against the space instead of a meeting.
  space_id: z.string().uuid().optional(),
});

// A history attachment only has a storage key; pull the bytes back so the
// model still sees screenshots from before a reload. The prefix check is a
// fast reject — the bucket's RLS enforces the same ownership rule.
async function loadStoredImage(
  supabase: SupabaseClient,
  userId: string,
  path: string
): Promise<string | null> {
  if (!path.startsWith(`${userId}/`)) return null;
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer()).toString("base64");
}

// Wire messages → model messages. User turns with images become multipart
// content; the newest MAX_IMAGES_IN_CONTEXT images win, older ones collapse
// to a one-line note so the model knows something was there. A recording
// becomes a header (duration + narration) followed by its frames, each
// introduced by its timestamp.
async function toModelMessages(
  msgs: Message[],
  supabase: SupabaseClient,
  userId: string
): Promise<{ messages: ModelMessage[]; imageCount: number }> {
  let budget = MAX_IMAGES_IN_CONTEXT;
  let imageCount = 0;
  const out: ModelMessage[] = [];

  const resolveImage = async (ref: ImageRef): Promise<string | null> =>
    ref.data ?? (ref.path ? loadStoredImage(supabase, userId, ref.path) : null);

  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const attachments = m.role === "user" ? (m.attachments ?? []) : [];
    if (!attachments.length) {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const parts: Array<TextPart | ImagePart> = [];
    if (m.content.trim()) parts.push({ type: "text", text: m.content });
    let omitted = 0;

    // Push one image if the budget allows; count it as omitted otherwise.
    const pushImage = async (
      ref: ImageRef,
      mediaType: AttachmentMediaType,
      label?: string
    ) => {
      if (budget <= 0) {
        omitted++;
        return;
      }
      const data = await resolveImage(ref);
      if (!data) {
        omitted++;
        return;
      }
      if (label) parts.push({ type: "text", text: label });
      parts.push({ type: "image", image: data, mediaType });
      budget--;
      imageCount++;
    };

    for (const a of attachments) {
      if ("kind" in a && a.kind === "video") {
        const narration = a.transcript?.trim()
          ? ` The user narrated: "${a.transcript.trim()}"`
          : " (no narration)";
        parts.push({
          type: "text",
          text: `Screen recording, ${formatTimestamp(a.duration)} long, shown as ${a.frames.length} frames where the screen changed.${narration}`,
        });
        for (const f of a.frames) {
          await pushImage(f, f.media_type, `[frame at ${formatTimestamp(f.t)}]`);
        }
      } else {
        await pushImage(a, a.media_type);
      }
    }
    if (omitted) {
      parts.push({
        type: "text",
        text: `[${omitted} earlier image${omitted > 1 ? "s" : ""} omitted]`,
      });
    }
    out.push({ role: "user", content: parts });
  }
  out.reverse();
  return { messages: out, imageCount };
}

// Upload one fresh image (or pass a stored one through). Returns null when
// the upload fails — the message still persists, just without that image.
async function storeImage(
  supabase: SupabaseClient,
  userId: string,
  ref: ImageRef
): Promise<{ path: string; media_type: AttachmentMediaType } | null> {
  if (ref.path) return { path: ref.path, media_type: ref.media_type };
  if (!ref.data) return null;
  const path = `${userId}/${randomUUID()}.${extensionFor(ref.media_type)}`;
  const { error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(path, Buffer.from(ref.data, "base64"), {
      contentType: ref.media_type,
      upsert: false,
    });
  if (error) {
    console.error("[chat] attachment upload failed:", error.message);
    return null;
  }
  return { path, media_type: ref.media_type };
}

// Persist the user turn. New images go to the private bucket first so the
// row only ever references stored objects. If the insert with `attachments`
// fails (migration 0022 not applied yet), fall back to the text alone —
// losing a thumbnail on reload beats losing the message.
async function persistUserMessage(
  supabase: SupabaseClient,
  userId: string,
  persistKey: { meeting_id: string } | { space_id: string },
  text: string,
  attachments: Attachment[],
  sources: { source: string; score: number }[]
): Promise<void> {
  const stored: StoredAttachment[] = [];
  for (const a of attachments) {
    if ("kind" in a && a.kind === "video") {
      const frames = (
        await Promise.all(
          a.frames.map(async (f) => {
            const s = await storeImage(supabase, userId, f);
            return s ? { ...s, t: f.t } : null;
          })
        )
      ).filter((f): f is NonNullable<typeof f> => f !== null);
      if (frames.length) {
        stored.push({
          kind: "video",
          duration: a.duration,
          transcript: a.transcript,
          frames,
        });
      }
    } else {
      const s = await storeImage(supabase, userId, a);
      if (s) stored.push({ kind: "image", ...s });
    }
  }

  // Untyped client: a union-typed row trips supabase-js's excess-property
  // check, so keep the literal loose.
  const row: Record<string, unknown> = {
    ...persistKey,
    user_id: userId,
    role: "user",
    content: text,
    sources,
  };
  const { error } = await supabase
    .from("chat_messages")
    .insert(stored.length ? { ...row, attachments: stored } : row);
  if (error && stored.length) {
    console.error(
      "[chat] insert with attachments failed, retrying without:",
      error.message
    );
    await supabase.from("chat_messages").insert(row);
  }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(parsed.error.message, { status: 400 });
  }
  const { messages, selection, meeting_id, space_id } = parsed.data;

  const supabase = await createClient();
  const user = await getAuthUserVerified(supabase);
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Drop any placeholder messages with empty content — the client seeds an
  // empty assistant turn before streaming starts; if a previous turn errored
  // or returned nothing, that empty block stays in conversation state and
  // Anthropic rejects the next request with "text content blocks must be
  // non-empty". A user turn that's only a screenshot (no text) is kept.
  const cleanMessages = messages.filter(
    (m) => m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0
  );

  const lastUser = [...cleanMessages].reverse().find((m) => m.role === "user");
  const lastUserMsg = lastUser?.content ?? "";
  const lastAttachments = lastUser?.attachments ?? [];

  // Resolve whose context to search. The meeting owner searches their own
  // (trusting their client selection). A guest of the meeting searches the
  // *host's* attached context, but with a server-derived selection only — we
  // never trust a guest's client selection, or they could pull the host's
  // unrelated notes/contexts.
  const effectiveMeetingId = meeting_id ?? selection.meeting_id;
  let contextUserId: string | undefined;
  let effectiveSelection: ContextSelection = {
    ...selection,
    meeting_id: effectiveMeetingId,
  };

  let diagMeetingOwner: string | null = null;
  if (effectiveMeetingId) {
    const { data: meetingRow } = await supabase
      .from("meetings")
      .select("user_id")
      .eq("id", effectiveMeetingId)
      .single();
    diagMeetingOwner = meetingRow?.user_id ?? null;

    if (meetingRow && meetingRow.user_id !== user.id) {
      // Not the owner — authorize as a participant and fetch the host scope in
      // one SECURITY DEFINER call (returns nothing for non-participants).
      const { data: scopeRows } = await supabase.rpc("guest_meeting_context", {
        p_meeting_id: effectiveMeetingId,
      });
      const scope = (Array.isArray(scopeRows) ? scopeRows[0] : scopeRows) as
        | { owner_id: string; external_context_ids: string[] | null; integrations: Record<string, unknown> | null }
        | undefined;
      if (!scope) {
        return new Response("Forbidden", { status: 403 });
      }
      contextUserId = scope.owner_id;
      effectiveSelection = {
        meeting_id: effectiveMeetingId,
        include_notes: false,
        note_ids: [],
        external_context_ids: scope.external_context_ids ?? [],
        space_id: null,
        tag_ids: [],
        recent_summary_count: 3,
        integrations: Object.keys(scope.integrations ?? {}).map((provider) => ({
          provider: provider as Provider,
        })),
      };
    }
  }

  // Space chat: owner-only (no guest flow). RLS hides spaces the caller
  // doesn't own, so a foreign space_id just comes back empty.
  if (space_id) {
    const { data: spaceRow } = await supabase
      .from("spaces")
      .select("id")
      .eq("id", space_id)
      .single();
    if (!spaceRow) return new Response("Forbidden", { status: 403 });
  }

  let chunks: RetrievedChunk[] = [];
  if (lastUserMsg.trim()) {
    // Space chats search wider (all meetings in the folder), so give them a
    // few more ambient slots than a single-meeting chat needs.
    chunks = await retrieve(
      lastUserMsg,
      effectiveSelection,
      space_id ? 12 : 8,
      contextUserId
    );
  }

  // TEMP DIAGNOSTIC — remove once guest context is confirmed working.
  console.error(
    "[chat-diag] " +
      JSON.stringify({
        uid: user.id,
        isAnonymous: user.isAnonymous,
        effectiveMeetingId: effectiveMeetingId ?? null,
        meetingOwner: diagMeetingOwner,
        contextUserId: contextUserId ?? null,
        selMeetingId: effectiveSelection.meeting_id ?? null,
        chunks: chunks.length,
        images: lastAttachments.length,
      })
  );

  // Figma chunks carry file_key + node_id in their metadata. We surface a
  // ready-to-embed screenshot URL alongside the text so the model can answer
  // visual questions ("show me…") with an inline image.
  const renderedChunks = chunks.map((c) => {
    const md = c.metadata ?? {};
    const sourceType =
      typeof md.source_type === "string" ? md.source_type : null;
    if (!sourceType?.startsWith("figma_")) return c;

    // file_key + node_id were stored on every figma chunk by the indexer;
    // see /api/contexts/figma/route.ts and src/lib/contexts/collectors.ts.
    // Path looks like `figma/<file_key>/<node-name>.md`; rather than parse
    // that, the indexer also stamps repo + we can derive file from metadata
    // injected at insert time. We added file_key/node_id at the chunk
    // metadata level when chunking.
    const fileKey =
      typeof md.file_key === "string" ? md.file_key : null;
    const nodeId = typeof md.node_id === "string" ? md.node_id : null;
    if (!fileKey || !nodeId) return c;

    const screenshotUrl = `/api/figma/image?file=${encodeURIComponent(
      fileKey
    )}&node=${encodeURIComponent(nodeId)}`;
    return {
      ...c,
      content: `${c.content}\n\nscreenshot_url: ${screenshotUrl}`,
    };
  });

  const contextBlock = renderedChunks.length
    ? `\n\n<retrieved_context>\n${renderedChunks
        .map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`)
        .join("\n\n")}\n</retrieved_context>`
    : "";

  const system = `You are ContextBrain, an assistant for a technical user's meetings and notes. Be direct, use precise terminology (software, product, engineering), and don't hedge.

Two sources of knowledge, used differently:
- **Retrieved context** below is authoritative for anything user-specific: their meetings, notes, decisions, people, projects, integrations. When you draw on it, cite with bracket numbers like [1], [2].
- **Your own knowledge** covers everything else: software concepts, frameworks, APIs, protocols, industry conventions, general world knowledge. Use it freely. Don't refuse or hedge just because retrieval came up thin — retrieval is for *their* data; your training is for everything else.

The user may attach screenshots to a message (images in the conversation). Treat them as first-class context: read any text in them verbatim when relevant, describe UI, diagrams, code, and error messages precisely, and connect what you see to the retrieved context when it fits. A message that is only a screenshot with no text means "look at this" — say what matters in it.

A screen recording arrives as a sequence of timestamped frames (sampled where the screen changed) plus a transcript of what the user said while recording. Treat it as one continuous clip: follow what changes from frame to frame, use the narration to understand intent, and refer to moments by timestamp when useful. Don't describe each frame in isolation.

Never write meta-commentary like "based on the retrieved context," "the context doesn't cover this," or "from what's available." Just answer. If a question genuinely requires user-specific info you don't have and retrieval missed it, say so in one short sentence and move on — don't pad the answer with apologies.

When a retrieved chunk includes a \`screenshot_url:\`, show the image inline with markdown: \`![<short alt>](<url>)\`. Do this when the user asks to *see*, *show*, or *look at* something. Don't invent URLs — only use ones present in retrieved context.${contextBlock}`;

  // Persist the user message + which sources we retrieved (don't block on it;
  // onFinish awaits it so the assistant row always lands after the user's).
  // Meeting chats key on meeting_id, space chats on space_id.
  const persistKey = meeting_id
    ? { meeting_id }
    : space_id
      ? { space_id }
      : null;
  const sources = chunks.map((c) => ({ source: c.source, score: c.score }));
  const persisted =
    persistKey && (lastUserMsg.trim() || lastAttachments.length)
      ? persistUserMessage(
          supabase,
          user.id,
          persistKey,
          lastUserMsg,
          lastAttachments,
          sources
        ).catch((e) => console.error("[chat] persist failed:", e))
      : Promise.resolve();

  const { messages: modelMessages, imageCount } = await toModelMessages(
    cleanMessages,
    supabase,
    user.id
  );

  // Opus for sharp reasoning on short turns; Sonnet once context is heavy
  // enough that the 5x cost premium stops paying for itself. ~4 chars/token,
  // plus a flat estimate per image.
  const approxTokens =
    Math.ceil(
      (system.length +
        cleanMessages.reduce((sum, m) => sum + m.content.length, 0)) /
        4
    ) +
    imageCount * APPROX_TOKENS_PER_IMAGE;
  const modelId = approxTokens > 30_000 ? "claude-sonnet-4-6" : "claude-opus-4-8";

  // Model construction is where the credit gate throws — before any streaming
  // starts, so an out-of-credit user gets a clean 402 instead of a 500.
  let model;
  try {
    model = await anthropicModel(user.id, modelId);
  } catch (e) {
    const r = creditErrorResponse(e);
    if (r) return r;
    throw e;
  }

  const result = streamText({
    model,
    system,
    messages: modelMessages,
    onFinish: async ({ text }) => {
      if (persistKey && text) {
        await persisted;
        await supabase.from("chat_messages").insert({
          ...persistKey,
          user_id: user.id,
          role: "assistant",
          content: text,
          sources,
        });
      }
    },
  });

  // Drain the provider stream even if the client disconnects mid-response —
  // otherwise an abort skips onFinish (message persistence) AND the metering
  // middleware's usage debit, making "stop generating" a free Opus call.
  result.consumeStream();

  return result.toTextStreamResponse();
}
