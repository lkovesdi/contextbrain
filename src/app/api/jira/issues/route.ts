import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findActiveConnection } from "@/lib/composio";
import { listIssues } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "jira"))) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 412 });
  }
  const url = new URL(req.url);
  const project = url.searchParams.get("project");
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!project) {
    return NextResponse.json({ error: "project is required" }, { status: 400 });
  }
  try {
    const issues = await listIssues(user.id, project, q);
    return NextResponse.json({ issues });
  } catch (e) {
    console.error("/api/jira/issues failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Jira call failed" },
      { status: 502 }
    );
  }
}
