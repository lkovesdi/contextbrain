import { executeTool } from "./composio";

export type LinearProject = {
  id: string;
  name: string;
  description: string | null;
};

export type LinearIssue = {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  description: string | null;
  state: string | null;
  url: string | null;
};

type ComposioResult = { data?: unknown };
function unwrap(res: unknown): unknown {
  const r = res as ComposioResult;
  return r && typeof r === "object" && "data" in r ? r.data : res;
}

// ----- Projects ------------------------------------------------------------

export async function listProjects(
  userId: string,
  query: string
): Promise<LinearProject[]> {
  const res = await executeTool("LINEAR_LIST_LINEAR_PROJECTS", {
    userId,
    arguments: {},
  });
  const data = unwrap(res) as { projects?: unknown[] } | unknown[] | null;
  const items = Array.isArray(data) ? data : data?.projects ?? [];
  const all = (items as Array<Record<string, unknown>>)
    .map((p) => ({
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      description: (p.description as string) ?? null,
    }))
    .filter((p) => p.id && p.name);

  if (!query.trim()) return all;
  const needle = query.trim().toLowerCase();
  return all.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      (p.description ?? "").toLowerCase().includes(needle)
  );
}

// ----- Issues --------------------------------------------------------------

export async function listIssues(
  userId: string,
  projectId: string,
  query: string,
  perPage = 30
): Promise<LinearIssue[]> {
  const res = await executeTool("LINEAR_LIST_LINEAR_ISSUES", {
    userId,
    arguments: { project_id: projectId, first: perPage },
  });
  const data = unwrap(res) as { issues?: unknown[] } | unknown[] | null;
  const items = Array.isArray(data) ? data : data?.issues ?? [];
  const mapped = (items as Array<Record<string, unknown>>)
    .map(toIssue)
    .filter((i): i is LinearIssue => !!i);

  if (!query.trim()) return mapped;
  const needle = query.trim().toLowerCase();
  return mapped.filter(
    (i) =>
      i.title.toLowerCase().includes(needle) ||
      i.identifier.toLowerCase().includes(needle) ||
      (i.description ?? "").toLowerCase().includes(needle)
  );
}

function toIssue(raw: Record<string, unknown>): LinearIssue | null {
  const id = String(raw.id ?? "");
  if (!id) return null;
  return {
    id,
    identifier: String(raw.identifier ?? raw.number ?? id),
    title: String(raw.title ?? "Untitled"),
    description:
      typeof raw.description === "string" ? (raw.description as string) : null,
    state:
      ((raw.state as { name?: string } | undefined)?.name as string) ?? null,
    url: typeof raw.url === "string" ? (raw.url as string) : null,
  };
}
