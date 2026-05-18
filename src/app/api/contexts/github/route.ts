import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { findActiveConnection } from "@/lib/composio";
import { triggerIndexing } from "@/lib/contexts/trigger";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["repo", "path", "file"]),
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().optional(),
  path: z.string().optional(),
});

function chipName(input: z.infer<typeof Body>) {
  const base = `${input.owner}/${input.repo}`;
  if (input.kind === "repo" || !input.path) return base;
  return `${base} · ${input.path}`;
}

function sourceType(kind: "repo" | "path" | "file") {
  return kind === "file" ? "github_file" : kind === "path" ? "github_path" : "github_repo";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
        ref: input.ref ?? null,
        path: input.path ?? "",
      },
    })
    .select("id,name,status,source_type,chunks_total,chunks_done,metadata,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  triggerIndexing(req, ctx.id);
  return NextResponse.json({ context: ctx });
}
