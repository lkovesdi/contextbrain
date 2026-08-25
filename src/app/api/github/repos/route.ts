import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { searchUserRepos, searchRepos } from "@/lib/github";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await findActiveConnection(user.id, "github");
  if (!conn) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 412 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  try {
    // First pass: only search the user's own repos (or org repos they belong to).
    const mine = await searchUserRepos(user.id, q, 30);
    if (mine.length >= 5 || q.length === 0) {
      return NextResponse.json({ repos: mine });
    }

    // Pad with global search results when the typeahead is too sparse.
    const remote = await searchRepos(user.id, q);
    const seen = new Set(mine.map((r) => r.full_name));
    const merged = [...mine];
    for (const r of remote) {
      if (seen.has(r.full_name)) continue;
      merged.push(r);
      if (merged.length >= 30) break;
    }
    return NextResponse.json({ repos: merged });
  } catch (e) {
    console.error("/api/github/repos failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "GitHub call failed" },
      { status: 502 }
    );
  }
}
