import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { retrieve, type RetrievedChunk, type ContextSelection } from "@/lib/retrieve";
import { createClient } from "@/lib/supabase/server";
import type { Provider } from "@/lib/composio";
import { z } from "zod";

export const maxDuration = 60;

const Body = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })
  ),
  selection: z
    .object({
      meeting_id: z.string().uuid().optional(),
      include_notes: z.boolean().optional(),
      external_context_ids: z.array(z.string().uuid()).optional(),
      note_ids: z.array(z.string().uuid()).optional(),
      space_id: z.string().uuid().nullable().optional(),
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
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(parsed.error.message, { status: 400 });
  }
  const { messages, selection, meeting_id } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Drop any placeholder messages with empty content — the client seeds an
  // empty assistant turn before streaming starts; if a previous turn errored
  // or returned nothing, that empty block stays in conversation state and
  // Anthropic rejects the next request with "text content blocks must be
  // non-empty".
  const cleanMessages = messages.filter((m) => m.content.trim().length > 0);

  const lastUserMsg =
    [...cleanMessages].reverse().find((m) => m.role === "user")?.content ?? "";

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

  let chunks: RetrievedChunk[] = [];
  if (lastUserMsg.trim()) {
    chunks = await retrieve(lastUserMsg, effectiveSelection, 8, contextUserId);
  }

  // TEMP DIAGNOSTIC — remove once guest context is confirmed working.
  console.error(
    "[chat-diag] " +
      JSON.stringify({
        uid: user.id,
        isAnonymous: (user as { is_anonymous?: boolean }).is_anonymous ?? null,
        effectiveMeetingId: effectiveMeetingId ?? null,
        meetingOwner: diagMeetingOwner,
        contextUserId: contextUserId ?? null,
        selMeetingId: effectiveSelection.meeting_id ?? null,
        chunks: chunks.length,
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

Never write meta-commentary like "based on the retrieved context," "the context doesn't cover this," or "from what's available." Just answer. If a question genuinely requires user-specific info you don't have and retrieval missed it, say so in one short sentence and move on — don't pad the answer with apologies.

When a retrieved chunk includes a \`screenshot_url:\`, show the image inline with markdown: \`![<short alt>](<url>)\`. Do this when the user asks to *see*, *show*, or *look at* something. Don't invent URLs — only use ones present in retrieved context.${contextBlock}`;

  // Persist the user message + which sources we retrieved (don't block on it)
  if (meeting_id && lastUserMsg.trim()) {
    void supabase.from("chat_messages").insert({
      meeting_id,
      user_id: user.id,
      role: "user",
      content: lastUserMsg,
      sources: chunks.map((c) => ({ source: c.source, score: c.score })),
    });
  }

  // Opus for sharp reasoning on short turns; Sonnet once context is heavy
  // enough that the 5x cost premium stops paying for itself. ~4 chars/token.
  const approxTokens = Math.ceil(
    (system.length +
      cleanMessages.reduce((sum, m) => sum + m.content.length, 0)) /
      4
  );
  const modelId = approxTokens > 30_000 ? "claude-sonnet-4-6" : "claude-opus-4-7";

  const result = streamText({
    model: anthropic(modelId),
    system,
    messages: cleanMessages,
    onFinish: async ({ text }) => {
      if (meeting_id && text) {
        await supabase.from("chat_messages").insert({
          meeting_id,
          user_id: user.id,
          role: "assistant",
          content: text,
          sources: chunks.map((c) => ({ source: c.source, score: c.score })),
        });
      }
    },
  });

  return result.toTextStreamResponse();
}
