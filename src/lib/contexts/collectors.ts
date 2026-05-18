// Per-integration content collectors. Each one returns a list of "files" (path + content)
// — the indexer doesn't care where they came from, it just chunks + embeds.
// Adding a new integration means writing one of these and registering it in
// `collectorFor` below.

import { collectFiles, getFileContent, type WalkedFile } from "@/lib/github";
import { listIssues as listJiraIssues, type JiraIssue } from "@/lib/jira";
import { listIssues as listLinearIssues, type LinearIssue } from "@/lib/linear";
import { getFileContentForIndexing } from "@/lib/figma";

export type CollectOptions = {
  onPlanned?: (totalUnits: number) => Promise<void> | void;
  onProgress?: (unitsDone: number) => Promise<void> | void;
  isCancelled?: () => Promise<boolean> | boolean;
};

export type ChipMetadata = Record<string, unknown>;

// ---------------- GitHub ----------------

async function collectGithub(
  userId: string,
  md: ChipMetadata,
  opts: CollectOptions
): Promise<WalkedFile[]> {
  const owner = String(md.owner ?? "");
  const repo = String(md.repo ?? "");
  const ref = String(md.ref ?? "main");
  const path = String(md.path ?? "");
  const kind = String(md.kind ?? "repo");

  if (kind === "file") {
    await opts.onPlanned?.(1);
    const content = await getFileContent(userId, owner, repo, path, ref);
    await opts.onProgress?.(1);
    return content ? [{ path, content }] : [];
  }
  return collectFiles(userId, owner, repo, path, ref, opts);
}

// ---------------- Jira ----------------

function jiraIssueToFile(issue: JiraIssue): WalkedFile {
  const parts = [
    `# ${issue.key}: ${issue.summary}`,
    issue.status ? `Status: ${issue.status}` : "",
    issue.url ? `URL: ${issue.url}` : "",
    "",
    issue.description ?? "",
  ].filter(Boolean);
  return { path: `jira/${issue.key}.md`, content: parts.join("\n") };
}

async function collectJira(
  userId: string,
  md: ChipMetadata,
  opts: CollectOptions
): Promise<WalkedFile[]> {
  const projectKey = String(md.project_key ?? "");
  const kind = String(md.kind ?? "project");

  if (kind === "issue") {
    // For a single-issue chip we still go through the search endpoint so we
    // pick up the same `summary` / `description` fields the project listing
    // returns. Keeping this DRY rather than wiring a separate "get one" tool.
    const issueKey = String(md.issue_key ?? "");
    await opts.onPlanned?.(1);
    const issues = await listJiraIssues(userId, projectKey, issueKey, 1);
    const match = issues.find((i) => i.key === issueKey) ?? issues[0];
    await opts.onProgress?.(1);
    return match ? [jiraIssueToFile(match)] : [];
  }

  // Whole project: fan out to all (most-recent) issues. Cap at 200 for v1 —
  // Jira's full-list endpoint is paginated; deeper paging can land later.
  const all = await listJiraIssues(userId, projectKey, "", 200);
  await opts.onPlanned?.(all.length);
  const out: WalkedFile[] = [];
  for (let i = 0; i < all.length; i++) {
    if (await opts.isCancelled?.()) return out;
    out.push(jiraIssueToFile(all[i]));
    await opts.onProgress?.(i + 1);
  }
  return out;
}

// ---------------- Linear ----------------

function linearIssueToFile(issue: LinearIssue): WalkedFile {
  const parts = [
    `# ${issue.identifier}: ${issue.title}`,
    issue.state ? `State: ${issue.state}` : "",
    issue.url ? `URL: ${issue.url}` : "",
    "",
    issue.description ?? "",
  ].filter(Boolean);
  return { path: `linear/${issue.identifier}.md`, content: parts.join("\n") };
}

async function collectLinear(
  userId: string,
  md: ChipMetadata,
  opts: CollectOptions
): Promise<WalkedFile[]> {
  const projectId = String(md.project_id ?? "");
  const kind = String(md.kind ?? "project");

  if (kind === "issue") {
    const issueIdentifier = String(md.issue_identifier ?? "");
    await opts.onPlanned?.(1);
    const issues = await listLinearIssues(userId, projectId, issueIdentifier, 1);
    const match =
      issues.find((i) => i.identifier === issueIdentifier) ?? issues[0];
    await opts.onProgress?.(1);
    return match ? [linearIssueToFile(match)] : [];
  }

  const all = await listLinearIssues(userId, projectId, "", 250);
  await opts.onPlanned?.(all.length);
  const out: WalkedFile[] = [];
  for (let i = 0; i < all.length; i++) {
    if (await opts.isCancelled?.()) return out;
    out.push(linearIssueToFile(all[i]));
    await opts.onProgress?.(i + 1);
  }
  return out;
}

// ---------------- Figma ----------------

async function collectFigma(
  userId: string,
  md: ChipMetadata,
  opts: CollectOptions
): Promise<WalkedFile[]> {
  const fileKey = String(md.file_key ?? "");
  const fileName = String(md.file_name ?? fileKey);
  const kind = String(md.kind ?? "file");
  const scopedNodeId = kind === "node" ? String(md.node_id ?? "") : null;

  // The discovery+content fetch is one big API call regardless of how many
  // frames it returns — we set chunks_total once we know the frame count.
  const { frames } = await getFileContentForIndexing(userId, fileKey, scopedNodeId);
  await opts.onPlanned?.(Math.max(1, frames.length));

  if (await opts.isCancelled?.()) return [];

  const out: WalkedFile[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const labelled = `# ${fileName} > ${f.path}\n\n${f.content}`;
    out.push({
      path: `figma/${fileKey}/${f.path.replace(/[^A-Za-z0-9_-]+/g, "_")}.md`,
      content: labelled,
      // Per-frame metadata so each chunk can resolve its own screenshot URL —
      // critical for "whole file" chips where chunks span many frames.
      metadata: {
        file_key: fileKey,
        node_id: f.nodeId,
        node_name: f.nodeName,
      },
    });
    await opts.onProgress?.(i + 1);
  }
  return out;
}

// ---------------- Dispatch ----------------

export type ChipCollector = (
  userId: string,
  md: ChipMetadata,
  opts: CollectOptions
) => Promise<WalkedFile[]>;

export function collectorFor(sourceType: string): ChipCollector | null {
  if (sourceType.startsWith("github_")) return collectGithub;
  if (sourceType.startsWith("jira_")) return collectJira;
  if (sourceType.startsWith("linear_")) return collectLinear;
  if (sourceType.startsWith("figma_")) return collectFigma;
  return null;
}

// Used by the indexer for chunk metadata so retrieval can label sources nicely.
export function repoLabelFor(sourceType: string, md: ChipMetadata): string {
  if (sourceType.startsWith("github_")) return `${md.owner}/${md.repo}`;
  if (sourceType.startsWith("jira_")) return `jira:${md.project_key}`;
  if (sourceType.startsWith("linear_")) return `linear:${md.project_name}`;
  if (sourceType.startsWith("figma_")) return `figma:${md.file_name}`;
  return sourceType;
}
