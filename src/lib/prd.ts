import { z } from "zod";
import { anthropicModel, generateObjectRetrying, MODEL } from "@/lib/llm";
import { createClient } from "@/lib/supabase/server";
import { loadReadyCards } from "@/lib/atlas";
import { findActiveConnection } from "@/lib/composio";
import { deepScout, IntentsOut, MAX_INTENTS, type ScopeMemo } from "@/lib/scout";
import { InsufficientCreditsError } from "@/lib/credits";
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

export type { ScopeMemo };

const OpenQuestionSchema = z.object({
  audience: z.enum(["pm", "engineering"]),
  question: z.string().describe("One or two sentences."),
  why_it_matters: z.string().describe("One or two sentences."),
});
export type PrdOpenQuestion = z.infer<typeof OpenQuestionSchema>;

// Same rule as the scout schemas: sizes are prose guidance, not zod
// constraints — see the note above IntentsOut in @/lib/scout. Trimming
// happens where the PRD is persisted.
const PrdOut = z.object({
  summary_title: z
    .string()
    .describe("Headline (under 160 characters) naming the client + the feature area, e.g. 'Acme — reporting exports & scheduling'."),
  summary_markdown: z
    .string()
    .describe("Short meeting recap (≤300 words, markdown, no H1) — what was discussed and agreed. NOT the PRD."),
  pm_doc: z
    .string()
    .describe("The PM rendition of the PRD (markdown, no H1): problem, who it's for, user stories, scope in/out, success criteria, rollout considerations. Plain language, no code."),
  eng_doc: z
    .string()
    .describe("The engineering rendition (markdown, no H1): affected repos/components with paths from the scope memos, data model & API implications, integration points, suggested phasing, risks. Cite evidence inline like (repo/path)."),
  open_questions: z
    .array(OpenQuestionSchema)
    .default([])
    .describe("At most 12 things a human must answer. Route each to 'pm' (product/client questions) or 'engineering' (technical decisions)."),
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
  // Intents only decide what gets scouted — they're an enrichment step, not the
  // PRD. If extraction fails, write the PRD from the transcript and notes alone
  // rather than losing the whole run to a preparatory call.
  let intents: { topic: string; ask: string }[] = [];
  try {
    const intentsOut = await generateObjectRetrying({
      model: sonnet,
      schema: IntentsOut,
      label: "prd-intents",
      system:
        "You extract concrete feature asks from a client meeting transcript. Only include things the client actually requested or clearly needs — not every topic mentioned. Merge overlapping asks.",
      prompt: meetingBlock,
    });
    intents = intentsOut.intents.slice(0, MAX_INTENTS);
  } catch (e) {
    if (e instanceof InsufficientCreditsError) throw e;
    console.error("[prd] intent extraction failed — scouting skipped", e);
  }

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

    // Routing and scouting are evidence-gathering: if they fall over, the PRD
    // still gets written from the meeting itself (and says so). Only running
    // out of credits stops the run, since every later call would fail too.
    try {
      const routeOut = await generateObjectRetrying({
        model: sonnet,
        schema: RouteOut,
        label: "prd-routing",
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
              .slice(0, 2)
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
              // Out of credits kills the whole run (every remaining call would
              // fail the same way) — let it surface as the summary error instead
              // of marking each research topic individually errored.
              if (e instanceof InsufficientCreditsError) throw e;
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
    } catch (e) {
      if (e instanceof InsufficientCreditsError) throw e;
      console.error("[prd] routing failed — writing the PRD without scope memos", e);
    }
  }

  // 4. The PRD itself — one Opus call, both renditions from one analysis so
  // the PM and engineering docs can't drift apart.
  const memosBlock =
    memos.length > 0
      ? `<scope_memos>\n${JSON.stringify(memos, null, 1)}\n</scope_memos>\n\n`
      : "<scope_memos>\n(No repo evidence was available — write the PRD from the meeting alone, state the lack of code grounding explicitly in the engineering doc, and lean harder on open questions.)\n</scope_memos>\n\n";

  const prd = await generateObjectRetrying({
    model: await anthropicModel(userId, MODEL.opus),
    schema: PrdOut,
    label: "prd",
    system: PRD_SYSTEM_PROMPT,
    prompt: `${memosBlock}${meetingBlock}`,
  });

  const artifact: PrdArtifact = {
    pm_doc: prd.pm_doc,
    eng_doc: prd.eng_doc,
    open_questions: prd.open_questions.slice(0, 12),
    scouted_repos: [...new Set(memos.flatMap((m) => m.repos))],
  };

  await supabase
    .from("meetings")
    .update({
      summary_title: prd.summary_title.slice(0, 160),
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
