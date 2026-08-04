import { anthropicModel } from "@/lib/llm";
import { generateObject } from "ai";
import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/embed";
import { z } from "zod";

// Meeting-summary generation, extracted from the POST /api/meetings/[id]/summary
// handler so the route can run it server-side *after* responding (Next's
// after()) — the user shouldn't have to keep the page open while Opus writes
// their notes. The route owns HTTP concerns + summary_status bookkeeping;
// everything from "gather context" to "persist the summary" lives here.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

type PriorSummary = {
  meeting_id: string;
  title: string;
  summary_title: string | null;
  summary: string;
  ended_at: string | null;
};

const TicketType = z.enum(["story", "task", "bug", "epic"]);
const TicketPriority = z.enum(["urgent", "high", "medium", "low", "none"]);

const SuggestedTicket = z.object({
  title: z
    .string()
    .min(4)
    .max(160)
    .describe("Imperative title in the voice of the team (e.g. 'Backfill embeddings for old transcripts')."),
  description: z
    .string()
    .min(8)
    .describe(
      "1-3 sentences of context from the meeting: what, why, and any constraints. No fluff."
    ),
  type: TicketType.describe(
    "story = user-facing capability, task = engineering chore, bug = defect, epic = umbrella spanning multiple tickets."
  ),
  priority: TicketPriority.describe(
    "Map from the meeting's tone — urgent only if explicitly stated; default 'medium'."
  ),
  suggested_owner: z
    .string()
    .nullable()
    .optional()
    .describe("Person named as owner in the meeting, or null if unassigned."),
});

const Decision = z.object({
  text: z.string().min(4).describe("The decision itself, stated as a complete sentence."),
  owner: z
    .string()
    .nullable()
    .optional()
    .describe("Who's accountable, if named."),
});

const OpenQuestion = z.object({
  text: z.string().min(4).describe("The unresolved question, phrased as a question."),
  raised_by: z
    .string()
    .nullable()
    .optional()
    .describe("Who raised it, if identifiable."),
});

const Tangent = z.object({
  topic: z.string().min(2).describe("Short label for the side topic."),
  note: z
    .string()
    .min(4)
    .describe("One-line summary of what was said and why it was set aside."),
});

const GithubRefKind = z.enum(["pr", "issue", "commit", "branch"]);
const GithubRef = z.object({
  kind: GithubRefKind.describe(
    "pr = pull request, issue = GitHub issue, commit = SHA, branch = branch name."
  ),
  identifier: z
    .string()
    .min(1)
    .describe(
      "The exact identifier: PR/issue number (no '#'), short or full commit SHA, or branch name."
    ),
  repo_hint: z
    .string()
    .nullable()
    .optional()
    .describe(
      "If the meeting names a specific repo (e.g. 'in the auth repo' or 'owner/repo'), put that here. Null otherwise."
    ),
  context: z
    .string()
    .min(4)
    .max(200)
    .describe("One-sentence snippet from the meeting explaining what this ref is about."),
});

const SummaryExtras = z.object({
  decisions: z.array(Decision).default([]),
  open_questions: z.array(OpenQuestion).default([]),
  tangents: z.array(Tangent).default([]),
  suggested_tickets: z.array(SuggestedTicket).default([]),
  github_refs: z.array(GithubRef).default([]),
});

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
      "Full meeting summary as GitHub-flavored markdown. Uses 3-5 H3 sections whose names reflect what actually happened, with hierarchical bullets (parent bullet states the point, sub-bullets give specifics). No top-level H1. Do NOT duplicate items that appear in the structured 'decisions', 'open_questions', 'tangents', or 'suggested_tickets' fields — those are rendered separately."
    ),
  extras: SummaryExtras.describe(
    "Structured pulls from the meeting. Each list may be empty if the meeting genuinely had none — do not invent items."
  ),
});

const SYSTEM_PROMPT = `You write meeting summaries for a tool called ContextBrain. Your output is the canonical record of the meeting — a careful operator should be able to skim it in 30 seconds and know what happened, what was decided, and what comes next.

Output format
- One title that names what the meeting was actually about (project + topic), not generic. Examples of good titles: "Campaign template testing — global templates, sub-orgs, property definitions", "SSO rollout — auth flow and user-type decisions". Examples of bad titles: "Meeting summary", "Team sync", "Discussion".
- The body uses 3-5 H3 (### ) section headers whose names reflect the actual content. Common patterns: a context/setup section, an issues/decisions section, an action items / next steps section. Do not force the same three headers every time — adapt to the meeting.
- Inside each section, use hierarchical bullets: the parent bullet states the point in a short noun phrase, sub-bullets give specifics, numbers, owners, or quotes. Two levels max.
- Mention people by name when they took an action or made a decision. Don't speculate about owners — if the transcript didn't say, leave it.
- Preserve specific numbers, dates, error codes, deadlines, and quoted feedback. These are the load-bearing details.
- The body is plain markdown — no front-matter, no H1.
- Do NOT add sections titled "Decisions", "Open Questions", "Tangents", or "Tickets" to the markdown body — those are returned as structured \`extras\` and the UI renders them separately. The markdown should narrate the *flow* of the meeting; the extras are the extracted artifacts.

Structured extras (the \`extras\` field)
- \`decisions\`: things the group concretely committed to. A statement of intent is not a decision; a chosen course of action is. If the meeting didn't make any decisions, return [].
- \`open_questions\`: things explicitly raised but not answered, OR clear unknowns the group acknowledged. Phrase as a question. If everything got resolved, return [].
- \`tangents\`: side topics that came up and got parked or rabbit-holed — useful for the user to revisit. One short label + one-line note. Skip filler small talk.
- \`suggested_tickets\`: actionable engineering or product work the meeting implied. Each suggestion should map to something a sprint board could accept. Skip "discuss further" or "think about X" — only concrete units of work. Prefer 0-5 high-quality suggestions over a long padded list. If nothing actionable came up, return [].
- \`github_refs\`: concrete GitHub artifacts that came up in the meeting — pull request or issue numbers ("PR 1234", "#56"), commit SHAs (7+ hex chars in context that makes it clearly a commit), or branch names ("the feature/auth-rework branch"). Skip non-references like Slack channels (#general), hashtags, or generic numbers. If the meeting names a specific repo for the ref, include it in \`repo_hint\`. If nothing concrete was referenced, return [].
- All five lists may be empty. Do not invent items to fill them out.
- You may embed Figma frame screenshots inline using markdown image syntax: \`![<short alt>](<screenshot_url>)\`. Use this when a visual reference would meaningfully sharpen a bullet — e.g. a "Design review" section discussing the new onboarding flow. Place the image directly under the bullet that mentions it. Don't invent URLs — only use \`screenshot_url\` values present in \`<related_designs>\`.
- You may embed a **Mermaid diagram** when the meeting discusses something genuinely diagrammable: a data schema (\`erDiagram\`), a request/response flow (\`sequenceDiagram\`), an architecture or pipeline (\`flowchart LR\`), a state machine (\`stateDiagram-v2\`), or a class structure (\`classDiagram\`). Use a fenced \`\`\`mermaid block — the renderer turns it into an SVG.
  - Only include a diagram when one would clarify the conversation, not as decoration. If the meeting is non-technical (1:1s, status, planning chats) skip it entirely.
  - Keep it small (5–12 nodes); diagrams that try to capture every detail end up unreadable.
  - Place it in the section where the topic comes up, not as a separate "Diagram" section.

Inputs you may receive
- The transcript (lines tagged by speaker).
- The user's own notes typed during the meeting. These often capture intent the transcript doesn't surface — treat them as ground truth for the user's perspective.
- Meeting context: title hint, attached preset name, prior summaries from the same Space (for recurring meetings).
- Related design frames (Figma) — frames pulled from the meeting's attached design files, ranked by relevance to the conversation. Each carries a \`screenshot_url\` you can drop into the markdown.

Quality bar
- If the transcript is short or empty, write a brief summary anyway — do not refuse. Use the notes if transcript is thin.
- Don't invent facts. If you're not sure who owns an action item, write the action without an owner.
- Don't pad. A 15-minute meeting gets a short summary; a 90-minute meeting gets a longer one.`;

export type GeneratedSummary = {
  title: string;
  summary: string;
  extras: Record<string, unknown>;
};

// Gathers every input (transcript, notes, priors, designs, repos), runs the
// model, and persists the result — clearing summary_status on success. Throws
// on failure; the caller records summary_status = 'error'.
export async function generateAndStoreSummary(
  supabase: SupabaseServer,
  userId: string,
  meetingId: string
): Promise<GeneratedSummary> {
  const { data: meeting } = await supabase
    .from("meetings")
    .select(
      "id,title,started_at,ended_at,space_id,context_preset_id,pinned_summary_images,speaker_names"
    )
    .eq("id", meetingId)
    .single();
  if (!meeting) throw new Error("Meeting not found");

  const [
    { data: transcripts },
    { data: notes },
    presetRow,
    spaceRow,
    priorSummariesRow,
    { data: tagRows },
  ] = await Promise.all([
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
            .select("name,sources")
            .eq("id", meeting.context_preset_id)
            .single()
        : Promise.resolve({ data: null as { name: string; sources?: unknown } | null }),
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
            user_id_filter: userId,
            match_count: 3,
            exclude_meeting: meetingId,
          })
        : Promise.resolve({ data: [] as PriorSummary[] }),
      supabase.from("meeting_tags").select("tag_id").eq("meeting_id", meetingId),
    ]);

  const transcriptLines = transcripts ?? [];
  const noteLines = notes ?? [];

  if (transcriptLines.length === 0 && noteLines.length === 0) {
    throw new Error("Nothing to summarize — no transcript or notes.");
  }

  // Apply the user's per-meeting speaker renames so the summary uses real
  // names instead of raw diarization labels. Keyed the same way the transcript
  // UI keys them (null/empty speaker → "Unknown").
  const speakerNames = (meeting.speaker_names ?? {}) as Record<string, string>;
  const fullTranscript = transcriptLines
    .map((t) => {
      const label = speakerNames[t.speaker || "Unknown"] ?? t.speaker ?? "Speaker";
      return `${label}: ${t.content}`;
    })
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

  // Continuity context comes from two places: meetings in the same space, and
  // meetings sharing any of this meeting's tags. Merge both and dedup by
  // meeting so a meeting that's both in the space and co-tagged appears once.
  const spacePrior = (priorSummariesRow?.data ?? []) as PriorSummary[];
  const tagIds = ((tagRows ?? []) as { tag_id: string }[]).map((r) => r.tag_id);
  let taggedPrior: PriorSummary[] = [];
  if (tagIds.length > 0) {
    const { data } = await supabase.rpc("recent_tagged_summaries", {
      tag_ids: tagIds,
      user_id_filter: userId,
      match_count: 3,
      exclude_meeting: meetingId,
    });
    taggedPrior = (data ?? []) as PriorSummary[];
  }
  const seenPrior = new Set<string>();
  const priorSummaries: PriorSummary[] = [];
  for (const s of [...spacePrior, ...taggedPrior]) {
    if (seenPrior.has(s.meeting_id)) continue;
    seenPrior.add(s.meeting_id);
    priorSummaries.push(s);
  }

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
      `Recent related meetings — same space or shared tags (for continuity — do NOT restate, only use to disambiguate names/projects/ongoing threads):\n\n${priorBlock}`
    );
  }

  // Pull figma frames attached to this meeting via its preset, ranked by
  // similarity to the transcript so the summary embeds the *relevant* ones.
  // Only figma_* chips contribute screenshots; other chip types (github/jira/
  // linear) will get image-rendering plumbing later.
  const presetExternalIds =
    ((presetRow?.data as { sources?: { external_context_ids?: string[] } } | null)
      ?.sources?.external_context_ids ?? []);

  const [relatedDesigns, githubRepos] = await Promise.all([
    fetchRelevantFigmaFrames({
      supabase,
      userId,
      presetExternalIds,
      queryText: fullTranscript || noteBlock,
    }),
    fetchPresetGithubRepos({
      supabase,
      userId,
      presetExternalIds,
    }),
  ]);

  const designsBlock =
    relatedDesigns.length > 0
      ? `<related_designs>\n${relatedDesigns
          .map(
            (d, i) =>
              `[design ${i + 1}] ${d.label}\n${d.text}\nscreenshot_url: ${d.screenshotUrl}`
          )
          .join("\n\n")}\n</related_designs>\n\n`
      : "";

  // Tell the model which GitHub repos are wired up to this meeting so it can
  // produce sensible `repo_hint` values when extracting refs. We don't pass
  // the model any GitHub content — only the available repo names — to keep
  // the prompt small.
  const githubReposBlock =
    githubRepos.length > 0
      ? `<github_repos_available>\n${githubRepos
          .map((r) => `${r.owner}/${r.repo}`)
          .join(
            "\n"
          )}\n\nWhen extracting github_refs and a ref clearly belongs to one of these repos, set repo_hint to "owner/repo". If unclear, leave repo_hint null.\n</github_repos_available>\n\n`
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

  const prompt = `${meetingContextBlock}${pinnedBlock}${designsBlock}${githubReposBlock}${notesBlock}${transcriptBlock}`;

  const result = await generateObject({
    model: await anthropicModel(userId, "claude-opus-4-8"),
    schema: SummaryOut,
    system: SYSTEM_PROMPT,
    prompt,
  });

  const { title, markdown, extras } = result.object;

  // Stamp the candidate repos onto extras so the UI can render clickable
  // links without re-querying. The model picks `repo_hint` per ref when
  // possible; otherwise the UI shows a per-ref repo picker.
  const extrasWithRepos = { ...extras, github_repos: githubRepos };

  // Persist the AI title into `summary_title` (never overwrite the
  // user-editable `title`), the body into `summary`, and the structured
  // outputs into `summary_extras`; clear the in-flight status marker.
  // Regenerate replaces all of these wholesale; created tickets live in
  // `meeting_tickets` and are not touched.
  await supabase
    .from("meetings")
    .update({
      summary_title: title,
      summary: markdown,
      summary_extras: extrasWithRepos,
      summary_status: null,
      summary_error: null,
    })
    .eq("id", meetingId);

  return { title, summary: markdown, extras: extrasWithRepos };
}

// ---- GitHub repo resolver (for ref chip links in the summary) ----

async function fetchPresetGithubRepos(args: {
  supabase: SupabaseServer;
  userId: string;
  presetExternalIds: string[];
}): Promise<{ owner: string; repo: string }[]> {
  if (args.presetExternalIds.length === 0) return [];
  const { data } = await args.supabase
    .from("external_contexts")
    .select("metadata")
    .in("id", args.presetExternalIds)
    .eq("user_id", args.userId)
    .like("source_type", "github_%");
  const seen = new Set<string>();
  const out: { owner: string; repo: string }[] = [];
  for (const row of (data ?? []) as Array<{ metadata: Record<string, unknown> | null }>) {
    const md = row.metadata ?? {};
    const owner = typeof md.owner === "string" ? md.owner : null;
    const repo = typeof md.repo === "string" ? md.repo : null;
    if (!owner || !repo) continue;
    const key = `${owner}/${repo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo });
  }
  return out;
}

// ---- Figma frame retrieval (for inline screenshots in the summary) ----

async function fetchRelevantFigmaFrames(args: {
  supabase: SupabaseServer;
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
