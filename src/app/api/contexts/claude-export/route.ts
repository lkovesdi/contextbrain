import { createClient } from "@/lib/supabase/server";
import { embedBatch } from "@/lib/embed";
import { scrubSecrets } from "@/lib/scrub";
import { NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 60;

const Msg = z.object({
  text: z.string().optional(),
  content: z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .optional(),
  sender: z.enum(["human", "assistant"]).optional(),
  created_at: z.string().optional(),
});
const Convo = z.object({
  uuid: z.string(),
  name: z.string().optional(),
  created_at: z.string().optional(),
  chat_messages: z.array(Msg),
});
const Export = z.array(Convo);

function extractText(m: z.infer<typeof Msg>): string {
  if (m.text) return m.text;
  if (m.content) {
    return m.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
  }
  return "";
}

function chunkConvo(c: z.infer<typeof Convo>) {
  const chunks: { content: string; metadata: Record<string, unknown> }[] = [];
  for (let i = 0; i < c.chat_messages.length; i += 2) {
    const u = c.chat_messages[i];
    const a = c.chat_messages[i + 1];
    const parts: string[] = [];
    if (u) parts.push(`User: ${extractText(u)}`);
    if (a) parts.push(`Assistant: ${extractText(a)}`);
    const content = parts.join("\n\n").trim();
    if (!content) continue;
    chunks.push({
      content,
      metadata: {
        conversation_id: c.uuid,
        conversation_name: c.name,
        created_at: u?.created_at,
        message_index: i,
      },
    });
  }
  return chunks;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  let parsed: z.infer<typeof Export>;
  try {
    parsed = Export.parse(JSON.parse(await file.text()));
  } catch {
    return NextResponse.json(
      { error: "Invalid Claude export file" },
      { status: 400 }
    );
  }

  const { data: ctx, error: ctxErr } = await supabase
    .from("external_contexts")
    .insert({
      user_id: user.id,
      source_type: "claude_export",
      name: `Claude export — ${parsed.length} conversations`,
      metadata: {
        conversation_count: parsed.length,
        imported_at: new Date().toISOString(),
      },
    })
    .select("id")
    .single();
  if (ctxErr) return NextResponse.json({ error: ctxErr.message }, { status: 500 });

  // People paste keys into chats; scrub before the content is stored.
  const allChunks = parsed
    .flatMap(chunkConvo)
    .map((c) => ({ ...c, content: scrubSecrets(c.content) }));
  const BATCH = 50;
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    try {
      const embeddings = await embedBatch(batch.map((c) => c.content));
      await supabase.from("external_chunks").insert(
        batch.map((c, idx) => ({
          external_context_id: ctx.id,
          user_id: user.id,
          content: c.content,
          embedding: embeddings[idx],
          metadata: c.metadata,
        }))
      );
    } catch (e) {
      console.error("chunk batch failed (will continue):", e);
      // Insert without embeddings so content is at least there; a future backfill can fill them in.
      await supabase.from("external_chunks").insert(
        batch.map((c) => ({
          external_context_id: ctx.id,
          user_id: user.id,
          content: c.content,
          metadata: c.metadata,
        }))
      );
    }
  }

  return NextResponse.json({
    ok: true,
    context_id: ctx.id,
    chunk_count: allChunks.length,
  });
}
