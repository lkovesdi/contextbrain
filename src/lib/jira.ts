import { executeTool } from "./composio";

export type JiraProject = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

export type JiraIssue = {
  id: string;
  key: string;
  summary: string;
  description: string | null;
  status: string | null;
  url: string | null;
  // Used by the indexer to compute size/skip; populated on detail fetch.
  comments?: { author: string | null; body: string }[];
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
): Promise<JiraProject[]> {
  const res = await executeTool("JIRA_GET_ALL_PROJECTS", {
    userId,
    arguments: query.trim() ? { query: query.trim() } : {},
  });
  const data = unwrap(res);
  const items = Array.isArray(data)
    ? data
    : (data as { values?: unknown[] })?.values ?? [];
  return (items as Array<Record<string, unknown>>)
    .map((p) => ({
      id: String(p.id ?? ""),
      key: String(p.key ?? ""),
      name: String(p.name ?? ""),
      description: (p.description as string) ?? null,
    }))
    .filter((p) => p.id && p.key);
}

// ----- Issues --------------------------------------------------------------

export async function listIssues(
  userId: string,
  projectKey: string,
  query: string,
  perPage = 30
): Promise<JiraIssue[]> {
  const escaped = query.replace(/"/g, "");
  const jql = escaped
    ? `project = "${projectKey}" AND text ~ "${escaped}" ORDER BY updated DESC`
    : `project = "${projectKey}" ORDER BY updated DESC`;
  const res = await executeTool("JIRA_SEARCH_ISSUES", {
    userId,
    arguments: { jql, maxResults: perPage },
  });
  const data = unwrap(res) as { issues?: unknown[] } | unknown[] | null;
  const issues = Array.isArray(data) ? data : data?.issues ?? [];
  return (issues as Array<Record<string, unknown>>)
    .map(toIssue)
    .filter((i): i is JiraIssue => !!i);
}

function toIssue(raw: Record<string, unknown>): JiraIssue | null {
  const fields = (raw.fields ?? {}) as Record<string, unknown>;
  const id = String(raw.id ?? "");
  const key = String(raw.key ?? "");
  if (!id || !key) return null;
  return {
    id,
    key,
    summary: String(fields.summary ?? key),
    description: typeof fields.description === "string" ? fields.description : null,
    status:
      ((fields.status as { name?: string } | undefined)?.name as string) ?? null,
    url: typeof raw.self === "string" ? (raw.self as string) : null,
  };
}
