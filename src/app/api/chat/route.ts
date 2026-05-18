import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { retrieve, type RetrievedChunk } from "@/lib/retrieve";
import { createClient } from "@/lib/supabase/server";
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
      recent_summary_count: z.number().int().min(1).max(20).optional(),
      integrations: z
        .array(z.object({ provider: z.enum(["github", "jira", "figma", "linear"]) }))
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

  let chunks: RetrievedChunk[] = [];
  if (lastUserMsg.trim()) {
    chunks = await retrieve(
      lastUserMsg,
      { ...selection, meeting_id: meeting_id ?? selection.meeting_id },
      8
    );
  }

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

  const system = `You are MeetingBrain, an assistant for the user's meetings and notes. Use the retrieved context below to answer. Cite sources by bracket number when relevant. If the context doesn't cover the question, say so plainly.

When a retrieved chunk includes a \`screenshot_url:\`, you may show the image inline by writing markdown image syntax: \`![<short alt>](<url>)\`. Do this when the user asks to *see*, *show*, *look at*, or otherwise visual things. Don't invent URLs — only use ones present in the retrieved context.${contextBlock}`;

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

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
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
