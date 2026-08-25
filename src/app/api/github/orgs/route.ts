import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import {
  getAuthenticatedLogin,
  listOrgsFromRepos,
  listUserOrgs,
  type GhOrg,
} from "@/lib/github";

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

  // Two org sources merged: /user/orgs (needs read:org + app approval on the
  // org) and org owners seen in /user/repos (works with the base repo scope).
  // Either alone can be empty for scope/approval reasons the other covers.
  const [login, memberOrgs, repoOrgs] = await Promise.all([
    getAuthenticatedLogin(user.id).catch((e) => {
      console.error("/api/github/orgs login fetch failed", e);
      return null;
    }),
    listUserOrgs(user.id).catch((e) => {
      console.error("/api/github/orgs /user/orgs fetch failed", e);
      return null;
    }),
    listOrgsFromRepos(user.id).catch((e) => {
      console.error("/api/github/orgs /user/repos fetch failed", e);
      return null;
    }),
  ]);

  const byLogin = new Map<string, GhOrg>();
  for (const o of [...(memberOrgs ?? []), ...(repoOrgs ?? [])]) {
    if (!byLogin.has(o.login)) byLogin.set(o.login, o);
  }

  return NextResponse.json({
    login,
    orgs: [...byLogin.values()],
    orgs_unavailable: memberOrgs === null && repoOrgs === null,
  });
}
