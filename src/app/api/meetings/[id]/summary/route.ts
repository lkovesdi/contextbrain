import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/embed";
import { NextResponse } from "next/server";
import { z } from "zod";

export const maxDuration = 120;

const SummaryOut = z.object({
  title: z
    .string()
    .min(3)
    .max(160)
    .describe(
      "Specific, scannable headline of the meeting (e.g. 'SSO rollout — auth flow, sub-org access, user types'). Not 'Meeting summary'."
    ),
  markdown: z
    .string()
    .min(40)
    .describe(
      "Full meeting summary as GitHub-flavored markdown. Uses 3-5 H3 sections whose names reflect what actually happened, with hierarchical bullets (parent bullet states the point, sub-bullets give specifics). No top-level H1."
    ),
});

const SYSTEM_PROMPT = `You write meeting summaries for a tool called MeetingBrain. Your output is the canonical record of the meeting — a careful operator should be able to skim it in 30 seconds and know what happened, what was decided, and what comes next.

Output format
- One title that names what the meeting was actually about (project + topic), not generic. Examples of good titles: "Campaign template testing — global templates, sub-orgs, property definitions", "SSO rollout — auth flow and user-type decisions". Examples of bad titles: "Meeting summary", "Team sync", "Discussion".
- The body uses 3-5 H3 (### ) section headers whose names reflect the actual content. Common patterns: a context/setup section, an issues/decisions section, an action items / next steps section. Do not force the same three headers every time — adapt to the meeting.
- Inside each section, use hierarchical bullets: the parent bullet states the point in a short noun phrase, sub-bullets give specifics, numbers, owners, or quotes. Two levels max.
- Mention people by name when they took an action or made a decision. Don't speculate about owners — if the transcript didn't say, leave it.
- Preserve specific numbers, dates, error codes, deadlines, and quoted feedback. These are the load-bearing details.
- The body is plain markdown — no front-matter, no H1.
- You may embed Figma frame screenshots inline using markdown image syntax: \`![<short alt>](<screenshot_url>)\`. Use this when a visual reference would meaningfully sharpen a bullet — e.g. a "Design review" section discussing the new onboarding flow. Place the image directly under the bullet that mentions it. Don't invent URLs — only use \`screenshot_url\` values present in \`<related_designs>\`.

Inputs you may receive
- The transcript (lines tagged by speaker).
- The user's own notes typed during the meeting. These often capture intent the transcript doesn't surface — treat them as ground truth for the user's perspective.
- Meeting context: title hint, attached preset name, prior summaries from the same Space (for recurring meetings).
- Related design frames (Figma) — frames pulled from the meeting's attached design files, ranked by relevance to the conversation. Each carries a \`screenshot_url\` you can drop into the markdown.

Quality bar
- If the transcript is short or empty, write a brief summary anyway — do not refuse. Use the notes if transcript is thin.
- Don't invent facts. If you're not sure who owns an action item, write the action without an owner.
- Don't pad. A 15-minute meeting gets a short summary; a 90-minute meeting gets a longer one.`;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: meeting, error: meetingErr } = await supabase
    .from("meetings")
    .select(
      "id,title,started_at,ended_at,space_id,context_preset_id,pinned_summary_images"
    )
    .eq("id", meetingId)
    .single();
  if (meetingErr || !meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const [{ data: transcripts }, { data: notes }, presetRow, spaceRow, priorSummariesRow] =
    await Promise.all([
      supabase
        .from("transcripts")
        .select("speaker,content,created_at")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true }),
      supabase
        .from("notes")
        .select("content,is_checked,created_at")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: true }),
      meeting.context_preset_id
        ? supabase
            .from("context_presets")
            .select("name")
            .eq("id", meeting.context_preset_id)
            .single()
        : Promise.resolve({ data: null as { name: string } | null }),
      meeting.space_id
        ? supabase
            .from("spaces")
            .select("name,description")
            .eq("id", meeting.space_id)
            .single()
        : Promise.resolve({ data: null as { name: string; description: string | null } | null }),
      meeting.space_id
        ? supabase.rpc("recent_space_summaries", {
            space_id_filter: meeting.space_id,
            user_id_filter: user.id,
            match_count: 3,
            exclude_meeting: meetingId,
          })
        : Promise.resolve({ data: [] as Array<{
            title: string;
            summary_title: string | null;
            summary: string;
            ended_at: string | null;
          }> }),
    ]);

  const transcriptLines = transcripts ?? [];
  const noteLines = notes ?? [];

  if (transcriptLines.length === 0 && noteLines.length === 0) {
    return NextResponse.json(
      { error: "Nothing to summarize — no transcript or notes." },
      { status: 400 }
    );
  }

  const fullTranscript = transcriptLines
    .map((t) => `${t.speaker ?? "Speaker"}: ${t.content}`)
    .join("\n");
  const noteBlock = noteLines
    .map((n) => `- ${n.is_checked ? "[x] " : ""}${n.content}`)
    .join("\n");

  // Soft cap the transcript so a very long meeting still fits comfortably in
  // a single Opus call. 120k chars ≈ ~30k tokens — well under Opus' window
  // and leaves room for notes + prior summaries + headroom.
  const TRANSCRIPT_CHAR_BUDGET = 120_000;
  const transcriptForPrompt =
    fullTranscript.length > TRANSCRIPT_CHAR_BUDGET
      ? fullTranscript.slice(0, TRANSCRIPT_CHAR_BUDGET) +
        `\n\n[transcript truncated at ${TRANSCRIPT_CHAR_BUDGET} chars of ${fullTranscript.length}]`
      : fullTranscript;

  const titleHint =
    meeting.title && meeting.title !== "Untitled meeting" ? meeting.title : null;
  const presetName = presetRow?.data?.name ?? null;
  const space = spaceRow?.data ?? null;
  const priorSummaries = (priorSummariesRow?.data ?? []) as Array<{
    title: string;
    summary_title: string | null;
    summary: string;
    ended_at: string | null;
  }>;

  const contextParts: string[] = [];
  if (titleHint) contextParts.push(`Working title: ${titleHint}`);
  if (space) {
    contextParts.push(
      `Filed under space: ${space.name}${space.description ? ` — ${space.description}` : ""}`
    );
  }
  if (presetName) contextParts.push(`Context preset in use: ${presetName}`);
  if (priorSummaries.length > 0) {
    const priorBlock = priorSummaries
      .map((s, i) => {
        const date = s.ended_at ? new Date(s.ended_at).toLocaleDateString() : "";
        const header = s.summary_title?.trim() || s.title;
        return `### Prior meeting ${i + 1}${date ? ` (${date})` : ""} — ${header}\n${s.summary.slice(0, 4000)}`;
      })
      .join("\n\n");
    contextParts.push(
      `Recent prior meetings in this space (for continuity — do NOT restate, only use to disambiguate names/projects/ongoing threads):\n\n${priorBlock}`
    );
  }

  // Pull figma frames attached to this meeting via its preset, ranked by
  // similarity to the transcript so the summary embeds the *relevant* ones.
  // Only figma_* chips contribute screenshots; other chip types (github/jira/
  // linear) will get image-rendering plumbing later.
  const relatedDesigns = await fetchRelevantFigmaFrames({
    supabase,
    userId: user.id,
    presetExternalIds:
      ((presetRow?.data as { sources?: { external_context_ids?: string[] } } | null)
        ?.sources?.external_context_ids ?? []),
    queryText: fullTranscript || noteBlock,
  });

  const designsBlock =
    relatedDesigns.length > 0
      ? `<related_designs>\n${relatedDesigns
          .map(
            (d, i) =>
              `[design ${i + 1}] ${d.label}\n${d.text}\nscreenshot_url: ${d.screenshotUrl}`
          )
          .join("\n\n")}\n</related_designs>\n\n`
      : "";

  // Pinned images = explicit user picks from the chat (right-click → "Use in
  // summary"). These MUST be embedded — they're the user's own selections,
  // not retrieval guesses.
  const pinnedImages = (meeting.pinned_summary_images ?? []) as {
    url: string;
    alt: string | null;
    label: string | null;
  }[];
  const pinnedBlock =
    pinnedImages.length > 0
      ? `<must_include_images>\n${pinnedImages
          .map(
            (p, i) =>
              `[pinned ${i + 1}] ${p.label ?? p.alt ?? "Pinned image"}\nurl: ${p.url}`
          )
          .join(
            "\n\n"
          )}\n\nEvery pinned image above MUST appear in the markdown body, embedded with markdown image syntax. Place each in the most relevant section; if no clear home, append a "### Visual references" section at the end.\n</must_include_images>\n\n`
      : "";

  const meetingContextBlock =
    contextParts.length > 0
      ? `<meeting_context>\n${contextParts.join("\n\n")}\n</meeting_context>\n\n`
      : "";
  const notesBlock = noteBlock
    ? `<user_notes>\n${noteBlock}\n</user_notes>\n\n`
    : "";
  const transcriptBlock = transcriptForPrompt
    ? `<transcript>\n${transcriptForPrompt}\n</transcript>`
    : `<transcript>\n(No live transcript — base the summary on the user's notes.)\n</transcript>`;

  const prompt = `${meetingContextBlock}${pinnedBlock}${designsBlock}${notesBlock}${transcriptBlock}`;

  let result;
  try {
    result = await generateObject({
      model: anthropic("claude-opus-4-7"),
      schema: SummaryOut,
      system: SYSTEM_PROMPT,
      prompt,
    });
  } catch (e) {
    console.error("[summary] generateObject failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Summary generation failed" },
      { status: 500 }
    );
  }

  const { title, markdown } = result.object;

  // Persist the AI title into `summary_title` (never overwrite the
  // user-editable `title`) and the body into `summary`.
  await supabase
    .from("meetings")
    .update({ summary_title: title, summary: markdown })
    .eq("id", meetingId);

  return NextResponse.json({ title, summary: markdown });
}

// ---- Figma frame retrieval (for inline screenshots in the summary) ----

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

async function fetchRelevantFigmaFrames(args: {
  supabase: SupabaseLike;
  userId: string;
  presetExternalIds: string[];
  queryText: string;
}): Promise<{ label: string; text: string; screenshotUrl: string }[]> {
  if (args.presetExternalIds.length === 0) return [];
  if (!args.queryText.trim()) return [];

  // Narrow to the figma chips on this preset; skip the work entirely if none.
  const { data: figmaCtxRows } = await args.supabase
    .from("external_contexts")
    .select("id")
    .in("id", args.presetExternalIds)
    .eq("user_id", args.userId)
    .like("source_type", "figma_%");
  const figmaCtxIds = (figmaCtxRows ?? []).map((r) => r.id);
  if (figmaCtxIds.length === 0) return [];

  // Embed a snippet of the transcript — enough to capture topic distribution
  // without wasting tokens on the full thing.
  const queryEmbedding = await embed(args.queryText.slice(0, 6000));
  const { data: matches } = await args.supabase.rpc("match_external_chunks", {
    query_embedding: queryEmbedding,
    match_count: 6,
    user_id_filter: args.userId,
    context_ids: figmaCtxIds,
  });

  const seen = new Set<string>();
  const out: { label: string; text: string; screenshotUrl: string }[] = [];
  for (const r of (matches ?? []) as Array<{
    content: string;
    metadata: Record<string, unknown> | null;
    similarity: number;
  }>) {
    const md = r.metadata ?? {};
    const fileKey = typeof md.file_key === "string" ? md.file_key : null;
    const nodeId = typeof md.node_id === "string" ? md.node_id : null;
    if (!fileKey || !nodeId) continue;
    // De-dupe by node — chunked frames produce multiple rows that share a
    // node_id. We only want one screenshot per frame.
    const key = `${fileKey}/${nodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fileName = typeof md.file_name === "string" ? md.file_name : "Figma";
    const nodeName =
      typeof md.node_name === "string" ? md.node_name : `Frame ${nodeId}`;
    out.push({
      label: `${fileName} > ${nodeName}`,
      // Trim — the model already has the transcript; the chunk is just a
      // hint about *what's in* the design so the model can decide whether
      // it's worth embedding.
      text: r.content.slice(0, 600),
      screenshotUrl: `/api/figma/image?file=${encodeURIComponent(
        fileKey
      )}&node=${encodeURIComponent(nodeId)}`,
    });
    if (out.length >= 4) break;
  }
  return out;
}
