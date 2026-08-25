import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { listProjects } from "@/lib/jira";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "jira"))) {
    return NextResponse.json({ error: "Jira not connected" }, { status: 412 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  try {
    const projects = await listProjects(user.id, q);
    return NextResponse.json({ projects });
  } catch (e) {
    console.error("/api/jira/projects failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Jira call failed" },
      { status: 502 }
    );
  }
}
