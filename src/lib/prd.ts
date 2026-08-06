import { z } from "zod";
import { generateObject } from "ai";
import { anthropicModel, MODEL } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import { loadReadyCards, type RepoCard } from "@/lib/atlas";
import { listRepoPaths, getFileContent } from "@/lib/github";
import { findActiveConnection, fetchIntegrationContext } from "@/lib/composio";
import { scrubSecrets } from "@/lib/scrub";
import type { DiagramGraph } from "@/lib/diagrams";

// PRD-mode generation: turn a client call into a grounded PRD.
//
//   transcript ──▶ extract intents ──▶ route over the repo atlas
//        │                                   │
//        │                     deep scout per intent (code + Jira)
//        │                                   │ scope memos (meeting_research)
//        └──────────────▶ Opus PRD ◀─────────┘
//                (pm_doc + eng_doc + open questions)
//
// Runs inside after() from the summary route, so the user can leave the
// meeting the moment they hit Stop. Every stage before the final Opus call is
// Sonnet — cheap, fast, parallelizable.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// ----- Stage schemas --------------------------------------------------------

const IntentsOut = z.object({
  intents: z
    .array(
      z.object({
        topic: z.string().min(3).max(80).describe("Short handle, e.g. 'CSV export for reports'."),
        ask: z
          .string()
          .min(10)
          .max(500)
          .describe("What the client wants, one paragraph, including constraints/deadlines mentioned."),
      })
    )
    .max(5)
    .describe("Distinct feature asks / scope items raised in the meeting. Merge duplicates."),
});

const RouteOut = z.object({
  assignments: z.array(
    z.object({
      topic: z.string().describe("Echo the intent topic VERBATIM."),
      repos: z
        .array(
          z.object({
            full_name: z.string().describe("'owner/name' exactly as listed in the atlas."),
            reason: z.string().max(160),
          })
        )
        .max(2)
        .describe("Best 0-2 repos to investigate. Empty if nothing in the atlas plausibly relates."),
    })
  ),
});

const MemoSchema = z.object({
  feasibility: z
    .enum(["clear", "moderate", "uncertain"])
    .describe("clear = existing patterns cover it; moderate = real work, known shape; uncertain = needs investigation."),
  summary: z.string().max(500).describe("2-3 sentences a PM could read."),
  findings: z
    .array(
      z.object({
        claim: z.string().max(220),
        evidence: z.string().max(200).describe("repo path, ticket key, or tree fact backing the claim."),
      })
    )
    .max(8),
  prior_art: z.array(z.string().max(220)).max(6).default([]),
  risks: z.array(z.string().max(220)).max(6).default([]),
  questions: z.array(z.string().max(220)).max(5).default([]),
});
export type ScopeMemo = z.infer<typeof MemoSchema> & {
  topic: string;
  repos: string[];
};

const OpenQuestionSchema = z.object({
  audience: z.enum(["pm", "engineering"]),
  question: z.string().min(8).max(300),
  why_it_matters: z.string().min(8).max(300),
});
export type PrdOpenQuestion = z.infer<typeof OpenQuestionSchema>;

const PrdOut = z.object({
  summary_title: z
    .string()
    .min(3)
    .max(160)
    .describe("Headline naming the client + the feature area, e.g. 'Acme — reporting exports & scheduling'."),
  summary_markdown: z
    .string()
    .min(40)
    .describe("Short meeting recap (≤300 words, markdown, no H1) — what was discussed and agreed. NOT the PRD."),
  pm_doc: z
    .string()
    .min(300)
    .describe("The PM rendition of the PRD (markdown, no H1): problem, who it's for, user stories, scope in/out, success criteria, rollout considerations. Plain language, no code."),
  eng_doc: z
    .string()
    .min(300)
    .describe("The engineering rendition (markdown, no H1): affected repos/components with paths from the scope memos, data model & API implications, integration points, suggested phasing, risks. Cite evidence inline like (repo/path)."),
  open_questions: z
    .array(OpenQuestionSchema)
    .max(12)
    .default([])
    .describe("Things a human must answer. Route each to 'pm' (product/client questions) or 'engineering' (technical decisions)."),
});
export type PrdArtifact = {
  pm_doc: string;
  eng_doc: string;
  open_questions: PrdOpenQuestion[];
  scouted_repos: string[];
};

// ----- Pipeline -------------------------------------------------------------

export async function generatePrdFromMeeting(
  supabase: SupabaseServer,
  userId: string,
  meetingId: string
): Promise<void> {
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id,title,space_id,speaker_names")
    .eq("id", meetingId)
    .single();
  if (!meeting) throw new Error("Meeting not found");

  const [{ data: transcripts }, { data: notes }] = await Promise.all([
    supabase
      .from("transcripts")
      .select("speaker,content")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true }),
    supabase
      .from("notes")
      .select("content,is_checked")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true }),
  ]);

  const speakerNames = (meeting.speaker_names ?? {}) as Record<string, string>;
  const transcript = (transcripts ?? [])
    .map((t) => `${speakerNames[t.speaker || "Unknown"] ?? t.speaker ?? "Speaker"}: ${t.content}`)
    .join("\n")
    .slice(0, 90_000);
  const noteBlock = (notes ?? [])
    .map((n) => `- ${n.is_checked ? "[x] " : ""}${n.content}`)
    .join("\n");
  if (!transcript && !noteBlock) {
    throw new Error("Nothing to build a PRD from — no transcript or notes.");
  }

  const titleHint = meeting.title && meeting.title !== "Untitled meeting" ? meeting.title : null;
  const meetingBlock = `${titleHint ? `Working title: ${titleHint}\n\n` : ""}${
    noteBlock ? `<user_notes>\n${noteBlock}\n</user_notes>\n\n` : ""
  }<transcript>\n${transcript || "(no transcript — use the notes)"}\n</transcript>`;

  // 1. What is the client actually asking for?
  const sonnet = await anthropicModel(userId, MODEL.sonnet);
  const { object: intentsOut } = await generateObject({
    model: sonnet,
    schema: IntentsOut,
    system:
      "You extract concrete feature asks from a client meeting transcript. Only include things the client actually requested or clearly needs — not every topic mentioned. Merge overlapping asks.",
    prompt: meetingBlock,
  });
  const intents = intentsOut.intents;

  // 2-3. Route intents over the atlas and deep-scout the routed repos.
  const cards = await loadReadyCards(supabase, userId);
  const diagramMaps = await loadDiagramMaps(supabase);
  let memos: ScopeMemo[] = [];

  if (intents.length > 0 && cards.length > 0) {
    const atlasBlock = cards
      .map(
        (c) =>
          `- ${c.owner}/${c.name}: ${c.card.purpose} [domains: ${c.card.domains.join(", ") || "?"}] [stack: ${c.card.stack.join(", ") || "?"}]`
      )
      .join("\n");
    const diagramBlock =
      diagramMaps.length > 0
        ? `\n\nSystem maps (from architecture diagrams — components per repo set):\n${diagramMaps
            .map((d) => `- covers ${d.repos.join(", ")}: ${d.nodeLabels.join(" · ")}`)
            .join("\n")}`
        : "";

    const { object: routeOut } = await generateObject({
      model: sonnet,
      schema: RouteOut,
      system:
        "You route feature requests to the repositories most likely to implement them, using the atlas of repo cards (and system maps when present). Be conservative: only assign repos with a plausible connection.",
      prompt: `## Feature asks\n${intents
        .map((i) => `- ${i.topic}: ${i.ask}`)
        .join("\n")}\n\n## Repo atlas\n${atlasBlock}${diagramBlock}`,
    });
    const routeByTopic = new Map(routeOut.assignments.map((a) => [a.topic, a.repos]));
    const cardByName = new Map(cards.map((c) => [`${c.owner}/${c.name}`, c]));

    const jiraConnected = !!(await findActiveConnection(userId, "jira").catch(() => null));

    memos = (
      await Promise.all(
        intents.slice(0, 4).map(async (intent) => {
          const routed = (routeByTopic.get(intent.topic) ?? [])
            .map((r) => cardByName.get(r.full_name))
            .filter((c): c is NonNullable<typeof c> => !!c);
          try {
            const memo = await deepScout(userId, intent, routed, jiraConnected);
            await supabase.from("meeting_research").insert({
              meeting_id: meetingId,
              user_id: userId,
              topic: intent.topic,
              status: "done",
              memo,
            });
            return memo;
          } catch (e) {
            console.error(`[prd] scout failed for "${intent.topic}":`, e);
            await supabase.from("meeting_research").insert({
              meeting_id: meetingId,
              user_id: userId,
              topic: intent.topic,
              status: "error",
              memo: null,
            });
            return null;
          }
        })
      )
    ).filter((m): m is ScopeMemo => !!m);
  }

  // 4. The PRD itself — one Opus call, both renditions from one analysis so
  // the PM and engineering docs can't drift apart.
  const memosBlock =
    memos.length > 0
      ? `<scope_memos>\n${JSON.stringify(memos, null, 1)}\n</scope_memos>\n\n`
      : "<scope_memos>\n(No repo evidence was available — write the PRD from the meeting alone, state the lack of code grounding explicitly in the engineering doc, and lean harder on open questions.)\n</scope_memos>\n\n";

  const { object: prd } = await generateObject({
    model: await anthropicModel(userId, MODEL.opus),
    schema: PrdOut,
    system: PRD_SYSTEM_PROMPT,
    prompt: `${memosBlock}${meetingBlock}`,
  });

  const artifact: PrdArtifact = {
    pm_doc: prd.pm_doc,
    eng_doc: prd.eng_doc,
    open_questions: prd.open_questions,
    scouted_repos: [...new Set(memos.flatMap((m) => m.repos))],
  };

  await supabase
    .from("meetings")
    .update({
      summary_title: prd.summary_title,
      summary: prd.summary_markdown,
      summary_extras: {},
      prd: artifact,
      summary_status: null,
      summary_error: null,
    })
    .eq("id", meetingId);
}

const PRD_SYSTEM_PROMPT = `You are a principal product engineer writing a PRD from a client meeting. You receive the transcript, the PM's notes, and scope memos — evidence gathered by scouting the org's actual codebase and issue tracker.

Ground rules
- The PRD must be buildable-from: specific enough that an engineering team could pick it up without re-having the meeting.
- Ground every technical claim in the scope memos. If a memo cites a file or ticket, carry the citation into the engineering doc inline, e.g. "(reporting-service: src/exports/csv.ts)". NEVER invent file paths, endpoints, or tickets that aren't in the memos.
- Two renditions of the SAME plan: pm_doc speaks product (problem, users, stories, scope boundaries, success criteria, rollout); eng_doc speaks implementation (affected components, data/API implications, phasing, risks). They must agree with each other.
- Scope discipline: mark explicitly what is OUT of scope. A PRD that promises everything is a PRD that ships nothing.
- open_questions is where uncertainty goes — not hedging inside the docs. Every assumption you were forced to make belongs there as a question, routed to the right audience. Client-preference and priority questions → pm; architectural choices and unknown constraints → engineering.
- Don't pad. If the meeting only justified a one-page PRD, write a one-page PRD.`;

// ----- Deep scout -----------------------------------------------------------

const SCOUT_FILE_CHARS = 4_000;
const SCOUT_FILES_MAX = 6;
const SCOUT_TREE_LINES = 250;

async function deepScout(
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

  const { object } = await generateObject({
    model: await anthropicModel(userId, MODEL.sonnet),
    schema: MemoSchema,
    system:
      "You are a staff engineer scoping a feature request against real code evidence. Only claim what the evidence shows; unknowns become questions, not guesses. Findings must carry their evidence (a path, a ticket key, a tree fact).",
    prompt: `## Feature ask\n${intent.topic}: ${intent.ask}\n\n## Evidence\n${
      repoSections.join("\n\n") || "(no repos were routed for this ask)"
    }${jiraBlock}`,
  });

  return {
    ...object,
    topic: intent.topic,
    repos: repos.map((r) => `${r.owner}/${r.name}`),
  };
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "want", "wants", "need",
  "needs", "should", "would", "could", "have", "they", "them", "will", "when",
  "what", "able", "into", "some", "more", "client", "feature", "support",
]);

function keywordSet(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    ),
  ].slice(0, 12);
}

function pathScore(path: string, keywords: string[]): number {
  const p = path.toLowerCase();
  let score = 0;
  for (const k of keywords) if (p.includes(k)) score += 2;
  // Light preference for source over assets/config when scores tie.
  if (/\.(ts|tsx|js|py|go|rs|rb|java|sql|prisma)$/.test(p)) score += 1;
  return score;
}

// ----- Diagram maps as routing signal ---------------------------------------

async function loadDiagramMaps(
  supabase: SupabaseServer
): Promise<{ repos: string[]; nodeLabels: string[] }[]> {
  const { data: diagrams } = await supabase
    .from("diagrams")
    .select("id,repos,current_version")
    .gt("current_version", 0)
    .limit(3);
  if (!diagrams || diagrams.length === 0) return [];

  const out: { repos: string[]; nodeLabels: string[] }[] = [];
  for (const d of diagrams) {
    const { data: v } = await supabase
      .from("diagram_versions")
      .select("graph")
      .eq("diagram_id", d.id)
      .eq("version", d.current_version)
      .single();
    const graph = v?.graph as DiagramGraph | undefined;
    if (!graph) continue;
    out.push({
      repos: ((d.repos ?? []) as { owner: string; name: string }[]).map(
        (r) => `${r.owner}/${r.name}`
      ),
      nodeLabels: graph.nodes.map((n) => n.label).slice(0, 30),
    });
  }
  return out;
}
