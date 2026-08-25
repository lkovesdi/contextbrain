import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { listTeams } from "@/lib/linear";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "linear"))) {
    return NextResponse.json({ error: "Linear not connected" }, { status: 412 });
  }
  try {
    const teams = await listTeams(user.id);
    return NextResponse.json({ teams });
  } catch (e) {
    console.error("/api/linear/teams failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Linear call failed" },
      { status: 502 }
    );
  }
}
