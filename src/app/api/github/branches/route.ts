import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findActiveConnection } from "@/lib/composio";
import { listBranches } from "@/lib/github";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "github"))) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 412 });
  }
  const params = new URL(req.url).searchParams;
  const owner = (params.get("owner") ?? "").trim();
  const repo = (params.get("repo") ?? "").trim();
  const q = (params.get("q") ?? "").trim();
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo are required" }, { status: 400 });
  }
  try {
    const branches = await listBranches(user.id, owner, repo, q);
    return NextResponse.json({ branches });
  } catch (e) {
    console.error("/api/github/branches failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "GitHub call failed" },
      { status: 502 }
    );
  }
}
