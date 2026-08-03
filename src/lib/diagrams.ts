import { z } from "zod";

// Shared contract for architecture diagrams: the zod schemas drive the model's
// structured output, the inferred types are what diagram_versions.graph stores,
// and the renderer consumes the same types. Client-safe — no server imports.

// ----- Graph schema ---------------------------------------------------------

export const DIAGRAM_ICONS = [
  "user", "browser", "mobile", "frontend", "server", "api", "service",
  "worker", "queue", "database", "cache", "storage", "auth", "security",
  "ai", "function", "scheduler", "webhook", "analytics", "monitor",
  "pipeline", "repo", "cloud", "external", "mail", "payment", "search",
  "doc", "config", "chat",
] as const;
export type DiagramIcon = (typeof DIAGRAM_ICONS)[number];

export const GROUP_TONES = ["neutral", "cortex", "violet", "amber", "green", "red"] as const;
export type GroupTone = (typeof GROUP_TONES)[number];

export const DiagramNodeSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(48)
    .describe(
      "Stable kebab-case id for this component (e.g. 'nextjs-app', 'postgres'). MUST be reused unchanged across versions for the same component."
    ),
  label: z.string().min(1).max(36).describe("Short display name, e.g. 'Next.js App'."),
  sublabel: z
    .string()
    .max(44)
    .nullable()
    .optional()
    .describe("Tiny secondary line — a tech or role ('Fluid Compute', 'primary DB'). Null if not needed."),
  icon: z.enum(DIAGRAM_ICONS),
  col: z
    .number()
    .int()
    .min(0)
    .max(11)
    .describe("Grid column, 0 = far left. Data flows left → right: clients/users leftmost, data stores and third parties rightmost."),
  row: z.number().int().min(0).max(11).describe("Grid row, 0 = top."),
  group: z
    .string()
    .nullable()
    .optional()
    .describe("Id of the group box this node sits inside, or null."),
});
export type DiagramNode = z.infer<typeof DiagramNodeSchema>;

export const DiagramGroupSchema = z.object({
  id: z.string().min(1).max(48),
  label: z.string().min(1).max(32).describe("Uppercase-friendly boundary name, e.g. 'VERCEL', 'SUPABASE', 'CI/CD'."),
  tone: z.enum(GROUP_TONES),
  parent: z
    .string()
    .nullable()
    .optional()
    .describe("Id of a parent group when boundaries nest (one level max), else null."),
});
export type DiagramGroup = z.infer<typeof DiagramGroupSchema>;

export const DiagramEdgeSchema = z.object({
  from: z.string().describe("Source node id."),
  to: z.string().describe("Target node id."),
  label: z
    .string()
    .max(28)
    .nullable()
    .optional()
    .describe("Optional tiny verb phrase ('reads', 'webhooks', 'SQL'). Null for obvious links."),
  style: z
    .enum(["flow", "dashed"])
    .describe("'flow' = runtime data path (rendered with animated motion). 'dashed' = secondary path: deploy-time, async feedback, occasional sync."),
});
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>;

export const DiagramGraphSchema = z.object({
  nodes: z.array(DiagramNodeSchema).min(2).max(40),
  groups: z.array(DiagramGroupSchema).max(12).default([]),
  edges: z.array(DiagramEdgeSchema).max(80),
});
export type DiagramGraph = z.infer<typeof DiagramGraphSchema>;

export const DiagramChangeSchema = z.object({
  kind: z.enum(["added", "removed", "modified"]),
  target: z.string().max(60).describe("Human label of the affected component or connection."),
  detail: z.string().max(200).describe("One line: what changed and why it matters."),
});
export type DiagramChange = z.infer<typeof DiagramChangeSchema>;

// ----- Row shapes (as the pages/API pass them around) -----------------------

export type DiagramRepoRef = { owner: string; name: string; branch: string };

export type DiagramRow = {
  id: string;
  title: string;
  repos: DiagramRepoRef[];
  current_version: number;
  created_at: string;
  updated_at: string;
};

export type DiagramVersionRow = {
  id: string;
  version: number;
  graph: DiagramGraph;
  summary: string | null;
  changes: DiagramChange[];
  created_at: string;
};

// ----- Sanitizing -----------------------------------------------------------

// The model occasionally emits dangling references or stacks two nodes on the
// same cell. Repair rather than reject: drop broken refs, nudge colliding
// nodes down a row. Runs server-side before a graph is stored.
export function sanitizeGraph(graph: DiagramGraph): DiagramGraph {
  const groupIds = new Set(graph.groups.map((g) => g.id));
  const groups = graph.groups.map((g) => ({
    ...g,
    parent: g.parent && groupIds.has(g.parent) && g.parent !== g.id ? g.parent : null,
  }));

  const taken = new Set<string>();
  const nodes = graph.nodes.map((n) => {
    let row = n.row;
    while (taken.has(`${n.col}:${row}`)) row += 1;
    taken.add(`${n.col}:${row}`);
    return {
      ...n,
      row,
      group: n.group && groupIds.has(n.group) ? n.group : null,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seenEdges = new Set<string>();
  const edges = graph.edges.filter((e) => {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) return false;
    const key = `${e.from}→${e.to}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });

  return { nodes, groups, edges };
}

// ----- Version diffing ------------------------------------------------------

export function edgeKey(e: Pick<DiagramEdge, "from" | "to">): string {
  return `${e.from}→${e.to}`;
}

export type GraphDiff = {
  addedNodes: Set<string>;
  removedNodes: Set<string>;
  modifiedNodes: Set<string>; // same id, but label/sublabel/icon/group changed (position moves ignored)
  addedEdges: Set<string>;
  removedEdges: Set<string>;
};

export function diffGraphs(prev: DiagramGraph, next: DiagramGraph): GraphDiff {
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextNodes = new Map(next.nodes.map((n) => [n.id, n]));

  const addedNodes = new Set<string>();
  const removedNodes = new Set<string>();
  const modifiedNodes = new Set<string>();

  for (const id of nextNodes.keys()) if (!prevNodes.has(id)) addedNodes.add(id);
  for (const id of prevNodes.keys()) if (!nextNodes.has(id)) removedNodes.add(id);
  for (const [id, n] of nextNodes) {
    const p = prevNodes.get(id);
    if (!p) continue;
    if (
      p.label !== n.label ||
      (p.sublabel ?? null) !== (n.sublabel ?? null) ||
      p.icon !== n.icon ||
      (p.group ?? null) !== (n.group ?? null)
    ) {
      modifiedNodes.add(id);
    }
  }

  const prevEdges = new Set(prev.edges.map(edgeKey));
  const nextEdges = new Set(next.edges.map(edgeKey));
  const addedEdges = new Set<string>();
  const removedEdges = new Set<string>();
  for (const k of nextEdges) if (!prevEdges.has(k)) addedEdges.add(k);
  for (const k of prevEdges) if (!nextEdges.has(k)) removedEdges.add(k);

  return { addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges };
}
