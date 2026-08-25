import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { triggerIndexing } from "@/lib/contexts/trigger";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["project", "issue"]),
  project_id: z.string().min(1),
  project_name: z.string().min(1),
  issue_id: z.string().optional(),
  issue_identifier: z.string().optional(),
  issue_title: z.string().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "linear"))) {
    return NextResponse.json({ error: "Linear not connected" }, { status: 412 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;
  const name =
    input.kind === "issue"
      ? `${input.issue_identifier ?? "issue"} · ${input.issue_title ?? ""}`.trim()
      : input.project_name;

  const { data: ctx, error } = await supabase
    .from("external_contexts")
    .insert({
      user_id: user.id,
      source_type: input.kind === "issue" ? "linear_issue" : "linear_project",
      name,
      status: "queued",
      chunks_total: 0,
      chunks_done: 0,
      metadata: {
        kind: input.kind,
        project_id: input.project_id,
        project_name: input.project_name,
        issue_id: input.issue_id ?? null,
        issue_identifier: input.issue_identifier ?? null,
        issue_title: input.issue_title ?? null,
      },
    })
    .select(
      "id,name,status,source_type,chunks_total,chunks_done,metadata,created_at"
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  triggerIndexing(req, ctx.id);
  return NextResponse.json({ context: ctx });
}
