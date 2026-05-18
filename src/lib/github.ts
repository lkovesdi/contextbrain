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
