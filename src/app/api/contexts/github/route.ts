import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { triggerIndexing } from "@/lib/contexts/trigger";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["repo", "path", "file", "branch", "pr"]),
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().optional(),
  path: z.string().optional(),
  // Branch chip: store the branch name + the SHA it pointed to when the chip
  // was created, so retrieval is reproducible even if the tip moves later.
  branch: z.string().optional(),
  branch_sha: z.string().optional(),
  // PR chip: the PR number. Title is captured for the chip display name.
  pr_number: z.number().int().positive().optional(),
  pr_title: z.string().optional(),
});

function chipName(input: z.infer<typeof Body>) {
  const base = `${input.owner}/${input.repo}`;
  if (input.kind === "pr" && input.pr_number) {
    return `${base} · PR #${input.pr_number}`;
  }
  if (input.kind === "branch" && input.branch) {
    return `${base} · ${input.branch}`;
  }
  if (input.kind === "repo" || !input.path) return base;
  return `${base} · ${input.path}`;
}

function sourceType(kind: z.infer<typeof Body>["kind"]) {
  if (kind === "file") return "github_file";
  if (kind === "path") return "github_path";
  if (kind === "branch") return "github_branch";
  if (kind === "pr") return "github_pr";
  return "github_repo";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await findActiveConnection(user.id, "github");
  if (!conn) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 412 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  const { data: ctx, error } = await supabase
    .from("external_contexts")
    .insert({
      user_id: user.id,
      source_type: sourceType(input.kind),
      name: chipName(input),
      status: "queued",
      chunks_total: 0,
      chunks_done: 0,
      metadata: {
        kind: input.kind,
        owner: input.owner,
        repo: input.repo,
        // For branch chips, ref stores the branch name so the existing
        // file-tree indexer pins to that ref without any other changes.
        ref:
          input.kind === "branch"
            ? input.branch ?? input.ref ?? null
            : input.ref ?? null,
        path: input.path ?? "",
        ...(input.kind === "branch"
          ? {
              branch: input.branch ?? null,
              branch_sha: input.branch_sha ?? null,
            }
          : {}),
        ...(input.kind === "pr"
          ? {
              pr_number: input.pr_number ?? null,
              pr_title: input.pr_title ?? null,
            }
          : {}),
      },
    })
    .select("id,name,status,source_type,chunks_total,chunks_done,metadata,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  triggerIndexing(req, ctx.id);
  return NextResponse.json({ context: ctx });
}
