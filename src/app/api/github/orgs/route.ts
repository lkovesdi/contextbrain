import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { getAuthenticatedLogin, listUserOrgs } from "@/lib/github";

export const dynamic = "force-dynamic";

// Accounts the GitHub card's org picker can point the integration at: the
// connected user plus every org GitHub lists for the token. Orgs that haven't
// approved the OAuth app are absent from GitHub's response by design — the
// card surfaces that as a hint rather than us treating it as an error.
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await findActiveConnection(user.id, "github");
  if (!conn) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 412 });
  }

  const [login, orgs] = await Promise.all([
    getAuthenticatedLogin(user.id).catch((e) => {
      console.error("/api/github/orgs login fetch failed", e);
      return null;
    }),
    // The orgs listing needs the `read:org` scope — older connections may
    // predate it, so a failure degrades to "personal account only".
    listUserOrgs(user.id).catch((e) => {
      console.error("/api/github/orgs orgs fetch failed", e);
      return null;
    }),
  ]);

  return NextResponse.json({
    login,
    orgs: orgs ?? [],
    orgs_unavailable: orgs === null,
  });
}
