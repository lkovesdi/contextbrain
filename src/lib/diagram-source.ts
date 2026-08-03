import { listRepoPaths, getFileContent } from "@/lib/github";
import type { DiagramRepoRef } from "@/lib/diagrams";

// Builds the model's view of a repo set: per repo, the filtered file tree plus
// the contents of architecture-significant files (manifests, infra/CI configs,
// schemas, entrypoints). The tree alone carries a lot of signal (api routes,
// service folders); the key files fill in dependencies and deploy topology.

const PER_FILE_CHARS = 7_000;
const PER_REPO_CONTENT_CHARS = 70_000;
const PER_REPO_TREE_LINES = 1_200;
const KEY_FILES_MAX = 26;
const FETCH_CONCURRENCY = 8;

// Basenames that are architecture gold wherever they sit (shallow paths win).
const KEY_BASENAMES = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "go.mod", "cargo.toml",
  "composer.json", "gemfile", "pom.xml", "build.gradle", "mix.exs", "deno.json",
  "dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml",
  "compose.yaml", "vercel.json", "vercel.ts", "netlify.toml", "fly.toml",
  "render.yaml", "serverless.yml", "procfile", ".env.example", ".env.sample",
  "turbo.json", "pnpm-workspace.yaml", "tauri.conf.json",
]);

const KEY_PATTERNS: RegExp[] = [
  /(^|\/)readme\.(md|mdx|txt)$/i,
  /(^|\/)(next|vite|nuxt|svelte|astro|remix|webpack|expo|metro)\.config\.[cm]?[jt]s$/i,
  /(^|\/)app\.(json|config\.[jt]s)$/i,
  /(^|\/)prisma\/schema\.prisma$/i,
  /(^|\/)schema\.(sql|graphql|prisma)$/i,
  /(^|\/)supabase\/config\.toml$/i,
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i,
  /(^|\/)(src\/)?(main|index|app|server)\.(ts|tsx|js|mjs|py|go|rs)$/i,
  /(^|\/)cmd\/[^/]+\/main\.go$/i,
];

const MIGRATION_PATTERN = /(^|\/)migrations?\/[^/]+\.sql$/i;

type Candidate = { path: string; priority: number };

function keyFilePriority(path: string): number | null {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  const depth = path.split("/").length;
  if (KEY_BASENAMES.has(base)) return depth; // root manifests first
  for (const re of KEY_PATTERNS) {
    if (re.test(path)) return 10 + depth;
  }
  return null;
}

async function digestRepo(userId: string, repo: DiagramRepoRef): Promise<string> {
  const paths = await listRepoPaths(userId, repo.owner, repo.name, repo.branch);

  const treeLines = paths.map((p) => p.path).sort();
  const treeBlock =
    treeLines.length > PER_REPO_TREE_LINES
      ? treeLines.slice(0, PER_REPO_TREE_LINES).join("\n") +
        `\n… (${treeLines.length - PER_REPO_TREE_LINES} more files omitted)`
      : treeLines.join("\n");

  const candidates: Candidate[] = [];
  for (const p of paths) {
    const priority = keyFilePriority(p.path);
    if (priority !== null) candidates.push({ path: p.path, priority });
  }
  // Newest couple of SQL migrations hint at the data model without dumping the
  // whole history (migration filenames sort chronologically by convention).
  const migrations = paths
    .map((p) => p.path)
    .filter((p) => MIGRATION_PATTERN.test(p))
    .sort()
    .slice(-2);
  for (const m of migrations) candidates.push({ path: m, priority: 5 });

  const picked = [...new Map(candidates.map((c) => [c.path, c])).values()]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, KEY_FILES_MAX);

  const sections: string[] = [];
  let budget = PER_REPO_CONTENT_CHARS;
  for (let i = 0; i < picked.length && budget > 0; i += FETCH_CONCURRENCY) {
    const batch = picked.slice(i, i + FETCH_CONCURRENCY);
    const contents = await Promise.all(
      batch.map((c) =>
        getFileContent(userId, repo.owner, repo.name, c.path, repo.branch).catch(() => null)
      )
    );
    contents.forEach((content, j) => {
      if (!content || budget <= 0) return;
      const clipped = content.slice(0, Math.min(PER_FILE_CHARS, budget));
      budget -= clipped.length;
      const truncNote =
        clipped.length < content.length ? ` (truncated, ${content.length} chars total)` : "";
      sections.push(`--- ${batch[j].path}${truncNote} ---\n${clipped}`);
    });
  }

  return [
    `### Repo ${repo.owner}/${repo.name} @ ${repo.branch}`,
    `#### File tree (${treeLines.length} files after filtering)`,
    treeBlock,
    `#### Key files`,
    sections.join("\n\n") || "(no key files could be read)",
  ].join("\n\n");
}

export async function buildRepoDigest(
  userId: string,
  repos: DiagramRepoRef[]
): Promise<string> {
  const parts = await Promise.all(
    repos.map((r) =>
      digestRepo(userId, r).catch(
        (e) =>
          `### Repo ${r.owner}/${r.name} @ ${r.branch}\n(could not be read: ${
            e instanceof Error ? e.message : "unknown error"
          })`
      )
    )
  );
  return parts.join("\n\n\n");
}
