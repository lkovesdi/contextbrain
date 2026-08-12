import { NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { createClient } from "@/lib/supabase/server";
import { anthropicModel, MODEL } from "@/lib/llm";
import { creditErrorResponse } from "@/lib/credits";
import { findActiveConnection } from "@/lib/composio";
import { buildRepoDigest } from "@/lib/diagram-source";
import {
  DiagramGraphSchema,
  DiagramChangeSchema,
  sanitizeGraph,
  type DiagramGraph,
  type DiagramRepoRef,
} from "@/lib/diagrams";

// Repo walking + an Opus call — comfortably the slowest route in the app.
export const maxDuration = 300;

const GenOut = z.object({
  title: z
    .string()
    .min(3)
    .max(80)
    .describe("Short name for the system, e.g. 'ContextBrain — web + desktop'. Used only when the diagram is still untitled."),
  graph: DiagramGraphSchema,
  summary: z
    .string()
    .min(20)
    .describe(
      "First version: 2-3 sentences describing the architecture. Later versions: 2-3 sentences describing WHAT CHANGED since the previous version, plain and specific."
    ),
  changes: z
    .array(DiagramChangeSchema)
    .default([])
    .describe("Empty for the first version. Later versions: one entry per meaningful add/remove/change."),
});

const SYSTEM_PROMPT = `You are an expert software architect. From a digest of one or more code repositories (file trees + key files), produce an architecture diagram as a structured graph. The graph is rendered as an Azure-architecture-style diagram: icon nodes on a grid, labeled group boxes for deployment boundaries, and animated flow lines showing how data moves.

What to diagram
- Model the RUNNING SYSTEM, not the folder structure: apps, services, API layers, databases, caches, queues, third-party services (auth, AI, payments, analytics), background jobs, CI/CD, and the humans at the edges (users, developers, operators).
- Only include components with real evidence in the digest. Do not invent infrastructure.
- 8–25 nodes is the sweet spot. Collapse trivial detail (one node per service, not per file). Multiple repos usually mean multiple apps/services — show how they connect.

Layout rules (a renderer draws exactly what you emit)
- The grid is columns 0–11 (left → right) and rows 0–11 (top → bottom). Data flows left to right: users/clients in the leftmost columns, entry points and app servers in the middle, data stores and third-party SaaS on the right. CI/CD and observability sit in their own cluster (bottom or right).
- Never place two nodes on the same (col, row). Leave a free column between major stages so edges have room.
- Keep nodes of one group in adjacent cells forming a tight rectangle; the group box is drawn around them. Groups may nest one level (e.g. 'PRODUCTION' and 'STAGING' inside 'DEPLOYMENT'). Nodes in nested groups must sit inside the parent's rectangle, and sibling groups must not overlap.
- Group tone: 'cortex' for the primary app platform, 'violet' for environments, 'amber' for CI/CD or build, 'green' for data, 'neutral' otherwise, 'red' only for something explicitly dangerous/legacy.

Edges
- style 'flow' for the runtime request/data path — these animate, so use them for the story you want the eye to follow.
- style 'dashed' for secondary paths: deploys, webhooks back, cron/async, feedback loops (e.g. operator → developer).
- Every node should be connected — no floating nodes. Prefer specific edge labels ('SQL', 'embeddings', 'OAuth') but only where non-obvious.

Versioning
- If a previous version of the graph is provided, you are UPDATING it: reuse the exact node ids and keep positions of unchanged components stable, so the two versions can be compared visually. Only add/remove/reposition what the code changes justify.
- Report the differences in 'changes' (kind: added | removed | modified) and write 'summary' as a terse changelog of the architecture (not of the code). If nothing architectural changed, say so in the summary and return an empty changes list.`;

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

  const conn = await findActiveConnection(user.id, "github");
  if (!conn) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 412 });
  }

  const { data: diagram } = await supabase
    .from("diagrams")
    .select("id,title,repos,current_version")
    .eq("id", id)
    .single();
  if (!diagram) return NextResponse.json({ error: "Diagram not found" }, { status: 404 });

  const repos = (diagram.repos ?? []) as DiagramRepoRef[];
  if (repos.length === 0) {
    return NextResponse.json({ error: "Diagram has no repos attached" }, { status: 400 });
  }

  const { data: prevRow } = diagram.current_version
    ? await supabase
        .from("diagram_versions")
        .select("graph")
        .eq("diagram_id", id)
        .eq("version", diagram.current_version)
        .single()
    : { data: null };
  const prevGraph = (prevRow?.graph ?? null) as DiagramGraph | null;

  let digest: string;
  try {
    digest = await buildRepoDigest(user.id, repos);
  } catch (e) {
    console.error("[diagrams] digest failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read repos" },
      { status: 502 }
    );
  }

  const prevBlock = prevGraph
    ? `<previous_graph>\n${JSON.stringify(prevGraph)}\n</previous_graph>\n\nThe previous version above is v${diagram.current_version}. Update it against the current code state — stable ids, stable positions for unchanged parts.\n\n`
    : "";

  let result;
  try {
    result = await generateObject({
      model: await anthropicModel(user.id, MODEL.opus),
      schema: GenOut,
      system: SYSTEM_PROMPT,
      prompt: `${prevBlock}<repo_digest>\n${digest}\n</repo_digest>`,
    });
  } catch (e) {
    const credit = creditErrorResponse(e);
    if (credit) return credit;
    console.error("[diagrams] generateObject failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Diagram generation failed" },
      { status: 500 }
    );
  }

  const { title, summary, changes } = result.object;
  const graph = sanitizeGraph(result.object.graph);
  const nextVersion = (diagram.current_version ?? 0) + 1;

  const { data: versionRow, error: insertErr } = await supabase
    .from("diagram_versions")
    .insert({
      diagram_id: id,
      user_id: user.id,
      version: nextVersion,
      graph,
      summary,
      changes: nextVersion === 1 ? [] : changes,
    })
    .select("id,version,graph,summary,changes,created_at")
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Adopt the generated title only while the diagram still has the default
  // name — never clobber a user-chosen title.
  const patch: Record<string, unknown> = {
    current_version: nextVersion,
    updated_at: new Date().toISOString(),
  };
  if (diagram.title === "Untitled diagram" && nextVersion === 1) patch.title = title;
  await supabase.from("diagrams").update(patch).eq("id", id);

  return NextResponse.json({ version: versionRow });
}
