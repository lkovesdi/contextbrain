import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { atlasCounts } from "@/lib/atlas";

// Atlas status for the Integrations card: counts plus the repo list (name,
// status, one-line purpose) so the UI can show what the map knows.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [counts, { data: rows }] = await Promise.all([
    atlasCounts(supabase, user.id),
    supabase
      .from("repo_atlas")
      .select("owner,name,status,error,card,updated_at")
      .eq("user_id", user.id)
      .order("owner")
      .order("name"),
  ]);

  return NextResponse.json({
    ...counts,
    repos: (rows ?? []).map((r) => ({
      full_name: `${r.owner}/${r.name}`,
      status: r.status,
      error: r.error,
      purpose: (r.card as { purpose?: string } | null)?.purpose ?? null,
      updated_at: r.updated_at,
    })),
  });
}
