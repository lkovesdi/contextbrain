import { executeTool } from "./composio";

export type GhRepo = {
  full_name: string; // "owner/repo"
  owner: string;
  name: string;
  default_branch: string;
  description: string | null;
  private: boolean;
};

export type GhTreeEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
  sha: string | null;
};

type ComposioResult = {
  successful?: boolean;
  data?: unknown;
  error?: string | null;
};

// Composio's GitHub content tool returns `{ data: { content: <X> } }` where X
// is an array (directory listing) or an object (single file with base64 body).
// We strip both envelopes so callers see the raw GitHub payload.
function unwrap(res: unknown): unknown {
  const r = res as ComposioResult;
  let v: unknown = r && typeof r === "object" && "data" in r ? r.data : res;
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "content" in (v as Record<string, unknown>) &&
    Object.keys(v as Record<string, unknown>).length === 1
  ) {
    v = (v as { content: unknown }).content;
  }
  return v;
}

// ----- Repos ---------------------------------------------------------------

// Composio's catalog doesn't expose a non-deprecated "list my repos" endpoint,
// so we lean on GitHub's `user:@me` search qualifier — the same query string
// covers both the empty-state browse ("show me my repos") and the typeahead
// ("show me my repos matching 'foo'").
export async function searchUserRepos(
  userId: string,
  query: string,
  perPage = 30
): Promise<GhRepo[]> {
  const trimmed = query.trim();
  const q = trimmed
    ? `${trimmed} user:@me`
    : "user:@me sort:updated";
  return runSearch(userId, q, perPage);
}

export async function searchRepos(userId: string, query: string): Promise<GhRepo[]> {
  if (!query.trim()) return [];
  return runSearch(userId, query, 20);
}

async function runSearch(
  userId: string,
  q: string,
  perPage: number
): Promise<GhRepo[]> {
  const res = await executeTool("GITHUB_SEARCH_REPOSITORIES", {
    userId,
    arguments: { q, per_page: perPage },
  });
  const data = unwrap(res) as { items?: unknown[] } | unknown[];
  const items = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(items)) return [];
  return items.map(toRepo).filter(Boolean) as GhRepo[];
}

function toRepo(raw: unknown): GhRepo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fullName = (r.full_name as string) ?? "";
  const owner =
    (r.owner as { login?: string } | undefined)?.login ??
    fullName.split("/")[0] ??
    "";
  const name = (r.name as string) ?? fullName.split("/")[1] ?? "";
  if (!owner || !name) return null;
  return {
    full_name: `${owner}/${name}`,
    owner,
    name,
    default_branch: (r.default_branch as string) ?? "main",
    description: (r.description as string) ?? null,
    private: !!r.private,
  };
}

// ----- Branches ------------------------------------------------------------

export type GhBranch = {
  name: string;
  // The commit SHA the branch currently points to — handy for indexing so we
  // pin to a specific snapshot rather than tracking the moving tip.
  sha: string;
  protected: boolean;
};

export async function listBranches(
  userId: string,
  owner: string,
  repo: string,
  query: string,
  perPage = 50
): Promise<GhBranch[]> {
  const res = await executeTool("GITHUB_LIST_BRANCHES", {
    userId,
    arguments: { owner, repo, per_page: perPage },
  });
  const data = unwrap(res);
  const items = Array.isArray(data) ? data : [];
  const all = (items as Array<Record<string, unknown>>)
    .map((b) => {
      const name = String(b.name ?? "");
      const sha =
        ((b.commit as { sha?: string } | undefined)?.sha as string) ?? "";
      if (!name) return null;
      return { name, sha, protected: !!b.protected };
    })
    .filter((b): b is GhBranch => !!b);
  if (!query.trim()) return all;
  const needle = query.toLowerCase();
  return all.filter((b) => b.name.toLowerCase().includes(needle));
}

// ----- Pull requests -------------------------------------------------------

export type GhPullRequest = {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  author: string | null;
  base_ref: string | null;
  head_ref: string | null;
  body: string | null;
  url: string | null;
  updated_at: string | null;
};

function toPullRequest(raw: Record<string, unknown>): GhPullRequest | null {
  const number = typeof raw.number === "number" ? raw.number : Number(raw.number);
  if (!Number.isFinite(number)) return null;
  const state = raw.state === "closed" ? "closed" : "open";
  return {
    number,
    title: String(raw.title ?? ""),
    state,
    merged: !!raw.merged_at,
    draft: !!raw.draft,
    author:
      ((raw.user as { login?: string } | undefined)?.login as string) ?? null,
    base_ref: ((raw.base as { ref?: string } | undefined)?.ref as string) ?? null,
    head_ref: ((raw.head as { ref?: string } | undefined)?.ref as string) ?? null,
    body: typeof raw.body === "string" ? (raw.body as string) : null,
    url: typeof raw.html_url === "string" ? (raw.html_url as string) : null,
    updated_at:
      typeof raw.updated_at === "string" ? (raw.updated_at as string) : null,
  };
}

export async function listPullRequests(
  userId: string,
  owner: string,
  repo: string,
  query: string,
  state: "open" | "closed" | "all" = "open",
  perPage = 30
): Promise<GhPullRequest[]> {
  const res = await executeTool("GITHUB_LIST_PULL_REQUESTS", {
    userId,
    arguments: {
      owner,
      repo,
      state,
      sort: "updated",
      direction: "desc",
      per_page: perPage,
    },
  });
  const data = unwrap(res);
  const items = Array.isArray(data) ? data : [];
  const all = (items as Array<Record<string, unknown>>)
    .map(toPullRequest)
    .filter((p): p is GhPullRequest => !!p);
  if (!query.trim()) return all;
  const needle = query.toLowerCase();
  return all.filter(
    (p) =>
      p.title.toLowerCase().includes(needle) ||
      String(p.number).includes(needle) ||
      (p.author ?? "").toLowerCase().includes(needle)
  );
}

export async function getPullRequest(
  userId: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GhPullRequest | null> {
  const res = await executeTool("GITHUB_GET_A_PULL_REQUEST", {
    userId,
    arguments: { owner, repo, pull_number: prNumber },
  });
  const data = unwrap(res) as Record<string, unknown> | null;
  if (!data) return null;
  return toPullRequest(data);
}

export type GhPullComment = {
  author: string | null;
  body: string;
  path: string | null; // null for issue-level comments, set for review comments
  created_at: string | null;
};

// Pulls both issue-style comments (the main conversation thread) AND review
// comments (inline file comments). GitHub exposes them via two different
// endpoints — we merge here so the indexer sees a single flat list.
export async function listPullRequestComments(
  userId: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GhPullComment[]> {
  async function fetch(slug: string, isReview: boolean): Promise<GhPullComment[]> {
    const res = await executeTool(slug, {
      userId,
      arguments: { owner, repo, issue_number: prNumber, pull_number: prNumber, per_page: 100 },
    });
    const data = unwrap(res);
    const items = Array.isArray(data) ? data : [];
    return (items as Array<Record<string, unknown>>).map((c) => ({
      author:
        ((c.user as { login?: string } | undefined)?.login as string) ?? null,
      body: String(c.body ?? ""),
      path: isReview ? ((c.path as string) ?? null) : null,
      created_at:
        typeof c.created_at === "string" ? (c.created_at as string) : null,
    }));
  }
  const [issueComments, reviewComments] = await Promise.all([
    fetch("GITHUB_LIST_ISSUE_COMMENTS", false).catch(() => []),
    fetch("GITHUB_LIST_REVIEW_COMMENTS", true).catch(() => []),
  ]);
  return [...issueComments, ...reviewComments].filter((c) => c.body.trim());
}

export type GhPullFile = {
  filename: string;
  status: string;       // 'added' | 'modified' | 'removed' | 'renamed'
  additions: number;
  deletions: number;
  patch: string | null; // unified diff; large/binary files have no patch
};

export async function listPullRequestFiles(
  userId: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GhPullFile[]> {
  const res = await executeTool("GITHUB_LIST_PULL_REQUESTS_FILES", {
    userId,
    arguments: { owner, repo, pull_number: prNumber, per_page: 100 },
  });
  const data = unwrap(res);
  const items = Array.isArray(data) ? data : [];
  return (items as Array<Record<string, unknown>>).map((f) => ({
    filename: String(f.filename ?? ""),
    status: String(f.status ?? "modified"),
    additions: typeof f.additions === "number" ? f.additions : 0,
    deletions: typeof f.deletions === "number" ? f.deletions : 0,
    patch: typeof f.patch === "string" ? (f.patch as string) : null,
  }));
}

// ----- Repository tree -----------------------------------------------------

export async function listContents(
  userId: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<GhTreeEntry[]> {
  const res = await executeTool("GITHUB_GET_REPOSITORY_CONTENT", {
    userId,
    arguments: { owner, repo, path, ...(ref ? { ref } : {}) },
  });
  const data = unwrap(res);
  const items = Array.isArray(data) ? data : [data];
  return items
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const r = it as Record<string, unknown>;
      const type = r.type === "dir" ? "dir" : r.type === "file" ? "file" : null;
      if (!type || !r.name || !r.path) return null;
      return {
        name: r.name as string,
        path: r.path as string,
        type,
        size: (r.size as number | null) ?? null,
        sha: (r.sha as string | null) ?? null,
      } as GhTreeEntry;
    })
    .filter(Boolean) as GhTreeEntry[];
}

export async function getFileContent(
  userId: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<string | null> {
  const res = await executeTool("GITHUB_GET_REPOSITORY_CONTENT", {
    userId,
    arguments: { owner, repo, path, ...(ref ? { ref } : {}) },
  });
  const data = unwrap(res) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  const encoding = data.encoding as string | undefined;
  const content = data.content as string | undefined;
  if (!content) return null;
  if (encoding === "base64") {
    try {
      return Buffer.from(content, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  return content;
}

// ----- Repo-wide tree walk for indexing -----------------------------------

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "vendor", "target",
  ".venv", "venv", "__pycache__", ".cache", ".turbo", ".yarn", ".parcel-cache",
  ".nuxt", ".svelte-kit", "coverage", ".vercel", ".netlify",
]);

// Lock files / generated dependency manifests / sourcemaps / minified bundles.
// These are noise for retrieval — large, mechanically generated, and rarely
// what someone is asking about in a meeting.
const SKIP_NAMES = new Set([
  // JS / TS package managers
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "npm-shrinkwrap.json", ".pnp.cjs", ".pnp.js", ".pnp.loader.mjs",
  // Other ecosystems
  "Gemfile.lock", "composer.lock", "poetry.lock", "uv.lock", "Pipfile.lock",
  "Cargo.lock", "go.sum", "mix.lock", "Package.resolved", "flake.lock",
  ".terraform.lock.hcl",
]);

function isSkippedFilename(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  if (SKIP_NAMES.has(name)) return true;
  // Minified / bundled / sourcemap output (often huge text with no semantic value)
  if (/\.(min|bundle)\.(js|mjs|cjs|css)$/i.test(name)) return true;
  if (name.endsWith(".map")) return true;
  return false;
}

const TEXT_EXT = new Set([
  "ts","tsx","js","jsx","mjs","cjs","json","md","mdx","txt","yml","yaml",
  "toml","html","css","scss","sass","less","sh","bash","zsh","sql","py",
  "rb","go","rs","java","kt","swift","php","c","h","cpp","hpp","cs","vue",
  "svelte","graphql","gql","prisma","env","gitignore","editorconfig",
]);
const MAX_FILE_BYTES = 250_000;
const FETCH_CONCURRENCY = 8;

function isTextPath(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  if (base.startsWith(".")) {
    // dotfiles like .gitignore, .editorconfig — accept if the slug matches
    // a known text "extension" we cherry-pick by name
    return TEXT_EXT.has(base.slice(1));
  }
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return TEXT_EXT.has(ext.toLowerCase());
}

export type WalkedFile = {
  path: string;
  content: string;
  // Optional per-file metadata propagated onto every chunk by the indexer.
  // Useful for collectors whose units carry source-specific IDs (e.g. Figma
  // frames keep a `node_id` so chat can render a per-frame screenshot).
  metadata?: Record<string, unknown>;
};

type TreeBlob = { path: string; size: number };

// Single recursive call to GitHub's tree API — returns every file path in the
// repo at once (vs. one HTTP call per directory like the old BFS walker).
async function getRepoTreeRecursive(
  userId: string,
  owner: string,
  repo: string,
  ref: string
): Promise<{ blobs: TreeBlob[]; truncated: boolean }> {
  const res = await executeTool("GITHUB_GET_A_TREE", {
    userId,
    arguments: { owner, repo, tree_sha: ref, recursive: true },
  });
  const data = unwrap(res) as
    | { tree?: Array<{ path?: string; type?: string; size?: number }>; truncated?: boolean }
    | null;
  if (!data || !Array.isArray(data.tree)) {
    return { blobs: [], truncated: false };
  }
  const blobs = data.tree
    .filter((t) => t.type === "blob" && typeof t.path === "string")
    .map((t) => ({ path: t.path as string, size: t.size ?? 0 }));
  return { blobs, truncated: !!data.truncated };
}

export type CollectFilesOptions = {
  // Called once after we know how many files survived filtering — the indexer
  // uses this to set chunks_total so the progress ring has something to fill.
  onPlanned?: (totalFiles: number) => Promise<void> | void;
  // Called after each fetched batch — argument is cumulative files fetched.
  onProgress?: (filesFetched: number) => Promise<void> | void;
  // Polled before each fetch batch. Returning true stops the walk early so
  // the user-cancelled X button takes effect quickly even on big repos.
  isCancelled?: () => Promise<boolean> | boolean;
};

export async function collectFiles(
  userId: string,
  owner: string,
  repo: string,
  rootPath: string,
  ref: string,
  options: CollectFilesOptions = {}
): Promise<WalkedFile[]> {
  const { blobs, truncated } = await getRepoTreeRecursive(userId, owner, repo, ref);
  if (truncated) {
    console.warn(
      `[indexer] tree for ${owner}/${repo}@${ref} was truncated by GitHub — some files will be missed.`
    );
  }

  const prefix = rootPath ? `${rootPath.replace(/\/$/, "")}/` : "";
  const candidates = blobs.filter((b) => {
    if (rootPath && !(b.path === rootPath || b.path.startsWith(prefix))) return false;
    if (b.path.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
    if (isSkippedFilename(b.path)) return false;
    if (!isTextPath(b.path)) return false;
    if (b.size > MAX_FILE_BYTES) return false;
    return true;
  });

  await options.onPlanned?.(candidates.length);

  const out: WalkedFile[] = [];
  let fetched = 0;

  for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
    if (await options.isCancelled?.()) {
      console.log(
        `[indexer] cancelled mid-walk at ${fetched}/${candidates.length} files for ${owner}/${repo}.`
      );
      return out;
    }
    const batch = candidates.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map((b) =>
        getFileContent(userId, owner, repo, b.path, ref).catch((e) => {
          console.error(`[indexer] fetch failed for ${b.path}:`, e);
          return null;
        })
      )
    );
    results.forEach((content, j) => {
      if (content) out.push({ path: batch[j].path, content });
    });
    fetched += batch.length;
    await options.onProgress?.(fetched);
  }

  return out;
}
