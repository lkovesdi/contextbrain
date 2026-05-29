import { executeTool } from "./composio";
import type {
  CreateIssueInput,
  CreatedIssue,
  TicketPriority,
} from "./tickets";

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

// ----- Teams ---------------------------------------------------------------

export type LinearTeam = { id: string; key: string; name: string };

export async function listTeams(userId: string): Promise<LinearTeam[]> {
  const res = await executeTool("LINEAR_LIST_LINEAR_TEAMS", {
    userId,
    arguments: {},
  });
  const data = unwrap(res) as { teams?: unknown[] } | unknown[] | null;
  const items = Array.isArray(data) ? data : data?.teams ?? [];
  return (items as Array<Record<string, unknown>>)
    .map((t) => ({
      id: String(t.id ?? ""),
      key: String(t.key ?? ""),
      name: String(t.name ?? ""),
    }))
    .filter((t) => t.id);
}

// ----- Create --------------------------------------------------------------

// Linear's priority is a 0–4 integer (0=none, 1=urgent, 4=low).
const LINEAR_PRIORITY: Record<NonNullable<TicketPriority>, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export async function createIssue(
  userId: string,
  input: CreateIssueInput & { teamId: string; projectId?: string }
): Promise<CreatedIssue> {
  const args: Record<string, unknown> = {
    team_id: input.teamId,
    title: input.title,
    description: input.description,
    priority: LINEAR_PRIORITY[input.priority ?? "medium"],
  };
  if (input.projectId) args.project_id = input.projectId;
  // Linear has no native concept of "Story / Task / Bug / Epic" in the same
  // way Jira does. We tag the issue with a label matching the type, falling
  // back silently if labels aren't supported on the workspace.
  if (input.type) args.labels = [input.type];

  const res = await executeTool("LINEAR_CREATE_LINEAR_ISSUE", {
    userId,
    arguments: args,
  });
  const data = unwrap(res) as Record<string, unknown> | null;
  const issue = (data?.issue ?? data) as Record<string, unknown> | null;
  if (!issue) throw new Error("Linear create returned no issue");
  const identifier = String(issue.identifier ?? issue.id ?? "");
  if (!identifier) throw new Error("Linear create returned no identifier");
  return {
    provider: "linear",
    key: identifier,
    url: typeof issue.url === "string" ? issue.url : null,
  };
}
