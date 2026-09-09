import { z } from "zod";
import { anthropicModel, generateObjectRetrying, MODEL } from "@/lib/llm";
import { InsufficientCreditsError } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";
import { searchUserRepos, listRepoPaths, getFileContent } from "@/lib/github";
import { scrubSecrets } from "@/lib/scrub";

// The repo atlas: a shallow, always-on map of every repo the user's GitHub
// connection can see. One model-written "card" per repo — purpose, stack,
// domains, key paths — cheap enough to build for a whole org, rich enough for
// intent routing ("client wants CSV export" → reporting-service). Deep code
// knowledge is never stored here; the PRD scout fetches it fresh per meeting.

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Sizes are guidance in the prose, not zod constraints — see the note above
// IntentsOut in @/lib/scout. buildCard trims to the stated caps.
export const RepoCardSchema = z.object({
  purpose: z
    .string()
    .describe("1-2 sentences: what this repo is and the role it plays in the org."),
  stack: z.array(z.string()).describe("Main languages/frameworks/services, at most 8."),
  domains: z
    .array(z.string())
    .describe(
      "Business/product domains it touches, at most 10: 'billing', 'reporting', 'auth', 'notifications', …"
    ),
  key_paths: z
    .array(z.object({ path: z.string(), what: z.string() }))
    .describe(
      "At most 10 places a newcomer would look first: API layers, schema, core services."
    ),
  packages: z
    .array(z.string())
    .describe("Top-level apps/packages if this is a monorepo, at most 12; [] otherwise."),
});
export type RepoCard = z.infer<typeof RepoCardSchema>;

export type AtlasRow = {
  id: string;
  owner: string;
  name: string;
  default_branch: string;
  status: string;
  error: string | null;
  card: RepoCard | null;
  updated_at: string;
};

const ROOT_DOC_NAMES = new Set([
  "readme.md", "readme.mdx", "readme.txt", "package.json", "pyproject.toml",
  "go.mod", "cargo.toml", "composer.json", "gemfile", "mix.exs",
  "docker-compose.yml", "docker-compose.yaml", "vercel.json",
]);
const CARD_FILE_CHARS = 5_000;
const CARD_TREE_LINES = 350;

async function buildCard(
  userId: string,
  owner: string,
  name: string,
  branch: string
): Promise<RepoCard> {
  const paths = await listRepoPaths(userId, owner, name, branch);

  // Tree signal: top-level layout with file counts, plus a sample of paths.
  const topLevel = new Map<string, number>();
  for (const p of paths) {
    const seg = p.path.includes("/") ? p.path.split("/")[0] + "/" : p.path;
    topLevel.set(seg, (topLevel.get(seg) ?? 0) + 1);
  }
  const layout = [...topLevel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([seg, count]) => `${seg} (${count})`)
    .join("\n");
  const sample = paths
    .map((p) => p.path)
    .sort()
    .slice(0, CARD_TREE_LINES)
    .join("\n");

  // Root docs/manifests: README + one dependency manifest tell most of the story.
  const rootDocs = paths
    .map((p) => p.path)
    .filter((p) => !p.includes("/") && ROOT_DOC_NAMES.has(p.toLowerCase()))
    .slice(0, 4);
  const docSections: string[] = [];
  for (const p of rootDocs) {
    const content = await getFileContent(userId, owner, name, p, branch).catch(() => null);
    if (content) {
      docSections.push(`--- ${p} ---\n${scrubSecrets(content).slice(0, CARD_FILE_CHARS)}`);
    }
  }

  const object = await generateObjectRetrying({
    model: await anthropicModel(userId, MODEL.sonnet),
    schema: RepoCardSchema,
    label: "repo-card",
    system:
      "You write terse, accurate index cards for code repositories. The card is used to ROUTE feature requests to the right repo, so domains and purpose matter most. Only state what the evidence supports.",
    prompt: `Repo: ${owner}/${name} @ ${branch}\n\n## Top-level layout (entry count per dir)\n${layout}\n\n## Path sample (${paths.length} files total)\n${sample}\n\n## Root docs\n${docSections.join("\n\n") || "(none readable)"}`,
  });
  return {
    purpose: object.purpose,
    stack: object.stack.slice(0, 8),
    domains: object.domains.slice(0, 10),
    key_paths: object.key_paths.slice(0, 10),
    packages: object.packages.slice(0, 12),
  };
}

// One scan step: make sure every visible repo has an atlas row, then build
// cards for a small batch of pending ones. The scan UI calls this repeatedly
// until nothing is pending — keeping each invocation comfortably inside the
// serverless budget instead of trying to do a whole org in one request.
const BATCH_SIZE = 5;
const DISCOVER_LIMIT = 100;

export type ScanResult = {
  total: number;
  ready: number;
  pending: number;
  errored: number;
  built_this_batch: number;
};

export async function scanStep(
  supabase: SupabaseServer,
  userId: string,
  opts: { discover: boolean; rebuild?: boolean; org?: string | null }
): Promise<ScanResult> {
  if (opts.discover) {
    const repos = await searchUserRepos(userId, "", DISCOVER_LIMIT, opts.org);
    if (repos.length > 0) {
      await supabase.from("repo_atlas").upsert(
        repos.map((r) => ({
          user_id: userId,
          owner: r.owner,
          name: r.name,
          default_branch: r.default_branch,
        })),
        { onConflict: "user_id,owner,name", ignoreDuplicates: false }
      );
    }
    if (opts.rebuild) {
      await supabase
        .from("repo_atlas")
        .update({ status: "pending", error: null })
        .eq("user_id", userId);
    }
  }

  const { data: batch } = await supabase
    .from("repo_atlas")
    .select("id,owner,name,default_branch")
    .eq("user_id", userId)
    // 'building' is included so rows orphaned by a crashed invocation get
    // retried; ordering by updated_at keeps untouched rows ahead of retries.
    .in("status", ["pending", "error", "building"])
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE);

  let built = 0;
  for (const row of batch ?? []) {
    await supabase
      .from("repo_atlas")
      .update({ status: "building", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    try {
      const card = await buildCard(userId, row.owner, row.name, row.default_branch);
      await supabase
        .from("repo_atlas")
        .update({
          status: "ready",
          card,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      built += 1;
    } catch (e) {
      // Out of credits is an account condition, not a repo failure — abort the
      // whole step so the route can 402 instead of marking every repo errored.
      // The row stays 'building', which counts as pending and gets retried.
      if (e instanceof InsufficientCreditsError) throw e;
      console.error(`[atlas] card build failed for ${row.owner}/${row.name}:`, e);
      await supabase
        .from("repo_atlas")
        .update({
          status: "error",
          error: e instanceof Error ? e.message.slice(0, 300) : "build failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return { ...(await atlasCounts(supabase, userId)), built_this_batch: built };
}

export async function atlasCounts(
  supabase: SupabaseServer,
  userId: string
): Promise<Omit<ScanResult, "built_this_batch">> {
  const { data } = await supabase
    .from("repo_atlas")
    .select("status")
    .eq("user_id", userId);
  const rows = data ?? [];
  const by = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    ready: by("ready"),
    // "building" counts as pending so a crashed batch's rows get retried.
    pending: by("pending") + by("building"),
    errored: by("error"),
  };
}

export async function loadReadyCards(
  supabase: SupabaseServer,
  userId: string
): Promise<{ owner: string; name: string; default_branch: string; card: RepoCard }[]> {
  const { data } = await supabase
    .from("repo_atlas")
    .select("owner,name,default_branch,card")
    .eq("user_id", userId)
    .eq("status", "ready");
  return (data ?? [])
    .filter((r) => r.card)
    .map((r) => ({
      owner: r.owner,
      name: r.name,
      default_branch: r.default_branch,
      card: r.card as RepoCard,
    }));
}
