import { z } from "zod";
import { anthropicModel, generateObjectRetrying, MODEL } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import { loadReadyCards, type RepoCard } from "@/lib/atlas";
import { listRepoPaths, getFileContent } from "@/lib/github";
import { findActiveConnection, fetchIntegrationContext } from "@/lib/composio";
import { scrubSecrets } from "@/lib/scrub";
import { InsufficientCreditsError } from "@/lib/credits";

// The scout: turns a feature ask into a scope memo grounded in real code.
// Shared by two callers —
//   * the PRD pipeline (src/lib/prd.ts), which scouts every intent at
//     generation time after the meeting ends, and
//   * the live scout step below, which runs periodically DURING a meeting
//     (any mode) so findings surface in the workspace as they're noticed.
// Memos live in meeting_research (status running | done | error).

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Every size limit in the LLM-facing schemas below is guidance in the prose,
// never a zod constraint. A cap enforced by validation turns "the model was
// verbose" into NoObjectGeneratedError and throws away the entire run — which
// is exactly how a rich meeting used to fail summary/PRD generation every
// time, retries included. Callers trim instead.
export const IntentsOut = z.object({
  intents: z
    .array(
      z.object({
        topic: z
          .string()
          .describe("Short handle, under 80 characters, e.g. 'CSV export for reports'."),
        ask: z
          .string()
          .describe(
            "What the client wants, one paragraph (aim for 500 characters or fewer), including constraints/deadlines mentioned."
          ),
      })
    )
    .describe(
      "At most 5 distinct feature asks / scope items raised in the meeting, best first. Merge duplicates."
    ),
});

// Model-facing caps, applied after the fact.
export const MAX_INTENTS = 5;
const MAX_REPOS_PER_INTENT = 2;

export const MemoSchema = z.object({
  feasibility: z
    .enum(["clear", "moderate", "uncertain"])
    .describe("clear = existing patterns cover it; moderate = real work, known shape; uncertain = needs investigation."),
  summary: z.string().describe("2-3 sentences a PM could read."),
  findings: z
    .array(
      z.object({
        claim: z.string().describe("One line."),
        evidence: z
          .string()
          .describe("repo path, ticket key, or tree fact backing the claim."),
      })
    )
    .describe("At most 8, strongest first."),
  prior_art: z.array(z.string()).default([]).describe("At most 6, one line each."),
  risks: z.array(z.string()).default([]).describe("At most 6, one line each."),
  questions: z.array(z.string()).default([]).describe("At most 5, one line each."),
});

// The memo's list caps, enforced here rather than by the schema.
function clampMemo(memo: z.infer<typeof MemoSchema>): z.infer<typeof MemoSchema> {
  return {
    ...memo,
    findings: memo.findings.slice(0, 8),
    prior_art: memo.prior_art.slice(0, 6),
    risks: memo.risks.slice(0, 6),
    questions: memo.questions.slice(0, 5),
  };
}
export type ScopeMemo = z.infer<typeof MemoSchema> & {
  topic: string;
  repos: string[];
};

export type ResearchRow = {
  id: string;
  topic: string;
  status: string;
  memo: ScopeMemo | null;
  created_at: string;
};

// ----- Deep scout -----------------------------------------------------------

const SCOUT_FILE_CHARS = 4_000;
const SCOUT_FILES_MAX = 6;
const SCOUT_TREE_LINES = 250;

export async function deepScout(
  userId: string,
  intent: { topic: string; ask: string },
  repos: { owner: string; name: string; default_branch: string; card: RepoCard }[],
  jiraConnected: boolean
): Promise<ScopeMemo> {
  const keywords = keywordSet(`${intent.topic} ${intent.ask}`);

  const repoSections: string[] = [];
  for (const repo of repos) {
    const paths = await listRepoPaths(userId, repo.owner, repo.name, repo.default_branch).catch(
      () => [] as { path: string; size: number }[]
    );
    const scored = paths
      .map((p) => ({ path: p.path, score: pathScore(p.path, keywords) }))
      .sort((a, b) => b.score - a.score);
    const treeSample = scored
      .slice(0, SCOUT_TREE_LINES)
      .map((s) => s.path)
      .join("\n");
    const filePicks = scored
      .filter((s) => s.score > 0)
      .slice(0, SCOUT_FILES_MAX)
      .map((s) => s.path);
    const fileSections: string[] = [];
    for (const path of filePicks) {
      const content = await getFileContent(
        userId, repo.owner, repo.name, path, repo.default_branch
      ).catch(() => null);
      if (content) {
        fileSections.push(`--- ${path} ---\n${scrubSecrets(content).slice(0, SCOUT_FILE_CHARS)}`);
      }
    }
    repoSections.push(
      `### ${repo.owner}/${repo.name}\nCard: ${JSON.stringify(repo.card)}\n\nMost relevant paths:\n${treeSample}\n\nRelevant files:\n${fileSections.join("\n\n") || "(no keyword-matched files)"}`
    );
  }

  let jiraBlock = "";
  if (jiraConnected) {
    const jira = await fetchIntegrationContext(userId, "jira", intent.topic).catch(() => null);
    if (jira) {
      jiraBlock = `\n\n### Jira search for "${intent.topic}"\n${scrubSecrets(
        JSON.stringify(jira)
      ).slice(0, 2_500)}`;
    }
  }

  const object = await generateObjectRetrying({
    model: await anthropicModel(userId, MODEL.sonnet),
    schema: MemoSchema,
    label: "scope-memo",
    system:
      "You are a staff engineer scoping a feature request against real code evidence. Only claim what the evidence shows; unknowns become questions, not guesses. Findings must carry their evidence (a path, a ticket key, a tree fact).",
    prompt: `## Feature ask\n${intent.topic}: ${intent.ask}\n\n## Evidence\n${
      repoSections.join("\n\n") || "(no repos were routed for this ask)"
    }${jiraBlock}`,
  });

  return {
    ...clampMemo(object),
    topic: intent.topic,
    repos: repos.map((r) => `${r.owner}/${r.name}`),
  };
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "want", "wants", "need",
  "needs", "should", "would", "could", "have", "they", "them", "will", "when",
  "what", "able", "into", "some", "more", "client", "feature", "support",
]);

export function keywordSet(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    ),
  ].slice(0, 12);
}

export function pathScore(path: string, keywords: string[]): number {
  const p = path.toLowerCase();
  let score = 0;
  for (const k of keywords) if (p.includes(k)) score += 2;
  // Light preference for source over assets/config when scores tie.
  if (/\.(ts|tsx|js|py|go|rs|rb|java|sql|prisma)$/.test(p)) score += 1;
  return score;
}

// ----- Live scout step ------------------------------------------------------

// One in-meeting scout pass, driven by the workspace on an interval while
// recording. Stateless between calls: the transcript-so-far is re-read and
// already-researched topics are excluded, so each pass only chases what's new.
// At most LIVE_INTENTS_PER_STEP asks are scouted per call to stay well inside
// the serverless budget; the next tick picks up the rest.

const LIVE_TRANSCRIPT_CHARS = 20_000;
const LIVE_MIN_TRANSCRIPT_CHARS = 400;
const LIVE_INTENTS_PER_STEP = 2;
const RUNNING_STALE_MS = 5 * 60_000;

export async function listResearch(
  supabase: SupabaseServer,
  meetingId: string
): Promise<ResearchRow[]> {
  const { data } = await supabase
    .from("meeting_research")
    .select("id,topic,status,memo,created_at")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: true });
  return (data ?? []) as ResearchRow[];
}

export async function liveScoutStep(
  supabase: SupabaseServer,
  userId: string,
  meetingId: string
): Promise<ResearchRow[]> {
  const [{ data: meeting }, { data: transcripts }, existing] = await Promise.all([
    supabase
      .from("meetings")
      .select("id,speaker_names")
      .eq("id", meetingId)
      .single(),
    supabase
      .from("transcripts")
      .select("speaker,content")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true }),
    listResearch(supabase, meetingId),
  ]);
  if (!meeting) throw new Error("Meeting not found");

  // A crashed step can strand rows in 'running' — age them out so they stop
  // blocking new passes and stop rendering as an eternal spinner.
  const now = Date.now();
  const stale = existing.filter(
    (r) =>
      r.status === "running" &&
      now - new Date(r.created_at).getTime() > RUNNING_STALE_MS
  );
  for (const r of stale) {
    r.status = "error";
    await supabase
      .from("meeting_research")
      .update({ status: "error" })
      .eq("id", r.id);
  }
  // A fresh running row means another step is mid-flight — don't pile on.
  if (existing.some((r) => r.status === "running")) return existing;

  const speakerNames = (meeting.speaker_names ?? {}) as Record<string, string>;
  const transcript = (transcripts ?? [])
    .map((t) => `${speakerNames[t.speaker || "Unknown"] ?? t.speaker ?? "Speaker"}: ${t.content}`)
    .join("\n");
  if (transcript.length < LIVE_MIN_TRANSCRIPT_CHARS) return existing;

  const cards = await loadReadyCards(supabase, userId);
  if (cards.length === 0) return existing;

  const coveredTopics = existing.map((r) => r.topic);
  const intentsOut = await generateObjectRetrying({
    model: await anthropicModel(userId, MODEL.sonnet),
    schema: IntentsOut,
    label: "live-intents",
    system:
      "You extract concrete feature asks from a live, in-progress client meeting transcript. Only include things the client actually requested or clearly needs — not every topic mentioned — and only asks specific enough to research in a codebase. Merge overlapping asks. If a list of already-researched topics is provided, do NOT return those asks again, even rephrased. Return an empty list when nothing new and concrete has come up.",
    prompt: `${
      coveredTopics.length > 0
        ? `## Already researched (exclude)\n${coveredTopics.map((t) => `- ${t}`).join("\n")}\n\n`
        : ""
    }## Transcript so far (most recent portion)\n${transcript.slice(-LIVE_TRANSCRIPT_CHARS)}`,
  });

  const coveredLower = new Set(coveredTopics.map((t) => t.toLowerCase()));
  const fresh = intentsOut.intents
    .filter((i) => !coveredLower.has(i.topic.toLowerCase()))
    .slice(0, LIVE_INTENTS_PER_STEP);
  if (fresh.length === 0) return existing;

  // Route the new asks over the atlas; asks with no plausible repo are
  // dropped silently — a memo with zero evidence is noise, not signal.
  const atlasBlock = cards
    .map(
      (c) =>
        `- ${c.owner}/${c.name}: ${c.card.purpose} [domains: ${c.card.domains.join(", ") || "?"}] [stack: ${c.card.stack.join(", ") || "?"}]`
    )
    .join("\n");
  const RouteOut = z.object({
    assignments: z.array(
      z.object({
        topic: z.string().describe("Echo the intent topic VERBATIM."),
        repos: z
          .array(
            z.object({
              full_name: z.string().describe("'owner/name' exactly as listed in the atlas."),
              reason: z.string().describe("One line, under 160 characters."),
            })
          )
          .describe("Best 0-2 repos to investigate. Empty if nothing in the atlas plausibly relates."),
      })
    ),
  });
  const routeOut = await generateObjectRetrying({
    model: await anthropicModel(userId, MODEL.sonnet),
    schema: RouteOut,
    label: "live-routing",
    system:
      "You route feature requests to the repositories most likely to implement them, using the atlas of repo cards. Be conservative: only assign repos with a plausible connection.",
    prompt: `## Feature asks\n${fresh
      .map((i) => `- ${i.topic}: ${i.ask}`)
      .join("\n")}\n\n## Repo atlas\n${atlasBlock}`,
  });
  const routeByTopic = new Map(routeOut.assignments.map((a) => [a.topic, a.repos]));
  const cardByName = new Map(cards.map((c) => [`${c.owner}/${c.name}`, c]));

  const jiraConnected = !!(await findActiveConnection(userId, "jira").catch(() => null));

  for (const intent of fresh) {
    const routed = (routeByTopic.get(intent.topic) ?? [])
      .slice(0, MAX_REPOS_PER_INTENT)
      .map((r) => cardByName.get(r.full_name))
      .filter((c): c is NonNullable<typeof c> => !!c);
    if (routed.length === 0) continue;

    const { data: row } = await supabase
      .from("meeting_research")
      .insert({
        meeting_id: meetingId,
        user_id: userId,
        topic: intent.topic,
        status: "running",
        memo: null,
      })
      .select("id")
      .single();
    if (!row) continue;

    try {
      const memo = await deepScout(userId, intent, routed, jiraConnected);
      await supabase
        .from("meeting_research")
        .update({ status: "done", memo })
        .eq("id", row.id);
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        await supabase
          .from("meeting_research")
          .update({ status: "error" })
          .eq("id", row.id);
        throw e;
      }
      console.error(`[scout] live scout failed for "${intent.topic}":`, e);
      await supabase
        .from("meeting_research")
        .update({ status: "error" })
        .eq("id", row.id);
    }
  }

  return listResearch(supabase, meetingId);
}
