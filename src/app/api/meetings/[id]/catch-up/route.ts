import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const FIVE_MIN_MS = 5 * 60 * 1000;
// Catch-up is a quick utility — keep the prompt light. ~40k chars ≈ ~10k tokens.
const TRANSCRIPT_CHAR_BUDGET = 40_000;

type Line = { speaker: string | null; content: string; created_at: string };

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: transcripts } = await supabase
    .from("transcripts")
    .select("speaker,content,created_at")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });

  const lines = (transcripts ?? []) as Line[];
  if (lines.length === 0) {
    return new Response(
      "There's no transcript yet, so there's nothing to catch up on.",
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const fmt = (t: Line) => `${t.speaker ?? "Speaker"}: ${t.content}`;

  // "Last 5 minutes" is measured from the most recent line, so it works whether
  // the meeting is still live or already ended.
  const latestMs = new Date(lines[lines.length - 1].created_at).getTime();
  const cutoff = latestMs - FIVE_MIN_MS;
  const recentLines = lines.filter(
    (t) => new Date(t.created_at).getTime() >= cutoff
  );

  let full = lines.map(fmt).join("\n");
  if (full.length > TRANSCRIPT_CHAR_BUDGET) {
    full =
      "[earlier transcript omitted]\n" +
      full.slice(full.length - TRANSCRIPT_CHAR_BUDGET);
  }
  const recent = recentLines.map(fmt).join("\n");

  const system =
    "You are ContextBrain. The user stepped away from a meeting and wants to get caught up fast. Be concise, concrete, and skimmable. No preamble, no meta-commentary, no apologies.";

  const prompt = `Here is the meeting transcript so far:
<transcript>
${full}
</transcript>

Here is only the last ~5 minutes of that transcript:
<last_5_minutes>
${recent}
</last_5_minutes>

Write exactly two parts in GitHub-flavored markdown:

1. A bullet list of 4–5 short bullets that catch me up on the meeting overall — the key topics, decisions, and any action items so far. Lead each bullet with the point and keep it to one line.

2. A bold heading **Last 5 minutes**, then a single short paragraph (2–4 sentences) recapping what was discussed most recently.

Do not add any other headings, preamble, or closing remarks.`;

  const approxTokens = Math.ceil((system.length + prompt.length) / 4);
  const modelId = approxTokens > 30_000 ? "claude-sonnet-4-6" : "claude-opus-4-7";

  const result = streamText({
    model: anthropic(modelId),
    system,
    prompt,
  });

  return result.toTextStreamResponse();
}
