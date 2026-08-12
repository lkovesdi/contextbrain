import { anthropicModel, MODEL } from "@/lib/llm";
import { creditErrorResponse } from "@/lib/credits";
import { generateText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/embed";
import { NextResponse } from "next/server";

export const maxDuration = 60;

// The output vocabulary is deliberately restricted to what SummaryMarkdown
// can render: ### headers, "- " bullets (one nested level), bold/italic/code.
const SYSTEM_PROMPT = `You reorganize a raw captured meeting note into a clean, scannable structure. The input is typically one unbroken blob of text.

Rules
- Preserve every fact: names, numbers, dates, ticket IDs, decisions, owners, deadlines. Do not summarize details away and do not invent anything.
- Output GitHub-flavored markdown using ONLY: "### " section headers, "- " bullets with at most one nested level (two-space indent), **bold** for key terms, and \`code\` for identifiers/tickets. No H1/H2, no tables, no numbered lists.
- Group the content into 3-6 short sections whose names come from the note itself (e.g. "Context", "Decisions", "Data model", "Open questions", "Tickets & next steps") — adapt to what's actually there; don't force sections that would be empty.
- Keep the note's original language.
- Output the markdown body only — no preamble, no closing remarks, no code fences around the whole output.`;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: note, error } = await supabase
    .from("notes")
    .select("content")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (error || !note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }
  if (note.content.trim().length < 40) {
    return NextResponse.json(
      { error: "Note is too short to organize." },
      { status: 400 }
    );
  }

  let text: string;
  try {
    const result = await generateText({
      model: await anthropicModel(user.id, MODEL.sonnet),
      system: SYSTEM_PROMPT,
      prompt: note.content.slice(0, 60_000),
    });
    text = result.text.trim();
  } catch (e) {
    const credit = creditErrorResponse(e);
    if (credit) return credit;
    console.error("[notes] organize failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Organize failed" },
      { status: 500 }
    );
  }

  // Guard against the model wrapping its whole answer in a code fence.
  const fenced = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();
  if (!text) {
    return NextResponse.json(
      { error: "Model returned empty output" },
      { status: 500 }
    );
  }

  const { error: updateErr } = await supabase
    .from("notes")
    .update({ content: text, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  embed(text)
    .then((vector) =>
      supabase.from("notes").update({ embedding: vector }).eq("id", id)
    )
    .catch((e) => console.error("note embed failed:", e));

  return NextResponse.json({ content: text });
}
