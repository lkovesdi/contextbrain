import { executeTool } from "./composio";
import type {
  CreateIssueInput,
  CreatedIssue,
  TicketType,
} from "./tickets";

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

// ----- Create --------------------------------------------------------------

// Jira issue types are workflow-defined per project. We map our generic
// vocabulary to the canonical names Atlassian ships in default workflows;
// teams with custom schemes may need to override these later.
const JIRA_ISSUE_TYPE: Record<TicketType, string> = {
  story: "Story",
  task: "Task",
  bug: "Bug",
  epic: "Epic",
};

const JIRA_PRIORITY: Record<NonNullable<CreateIssueInput["priority"]>, string> = {
  urgent: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "Lowest",
};

export async function createIssue(
  userId: string,
  input: CreateIssueInput & { projectKey: string }
): Promise<CreatedIssue> {
  const fields: Record<string, unknown> = {
    project: { key: input.projectKey },
    summary: input.title,
    description: input.description,
    issuetype: { name: JIRA_ISSUE_TYPE[input.type] },
  };
  if (input.priority && input.priority !== "none") {
    fields.priority = { name: JIRA_PRIORITY[input.priority] };
  }
  const res = await executeTool("JIRA_CREATE_ISSUE", {
    userId,
    arguments: { fields },
  });
  const data = unwrap(res) as Record<string, unknown> | null;
  if (!data) throw new Error("Jira create returned no data");
  const key = String(data.key ?? "");
  if (!key) throw new Error("Jira create returned no issue key");
  // Atlassian's REST response is `{id, key, self}`. `self` is the API URL;
  // the browser URL is `https://<site>/browse/<KEY>`. The site host isn't
  // in the response, so we leave url null when we can't infer it.
  const self = typeof data.self === "string" ? data.self : null;
  const browseUrl = self?.match(/^(https?:\/\/[^/]+)/)?.[1]
    ? `${self.match(/^(https?:\/\/[^/]+)/)?.[1]}/browse/${key}`
    : null;
  return { provider: "jira", key, url: browseUrl };
}
