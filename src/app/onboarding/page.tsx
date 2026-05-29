import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyWorkEmail, suggestOrgName } from "@/lib/orgs";
import { OnboardingFlow } from "./OnboardingFlow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Already in an org → nothing to set up.
  const { data: membership } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership) redirect("/meetings");

  const email = user.email ?? "";
  const check = await verifyWorkEmail(email);

  if (!check.ok) {
    // Personal / unverifiable email — orgs are optional, so let them in solo.
    return <OnboardingFlow mode="solo" email={email} reason={check.reason} />;
  }

  const { data } = await supabase.rpc("find_org_by_domain", { p_domain: check.domain });
  const existing = Array.isArray(data) ? data[0] : null;

  if (existing) {
    return (
      <OnboardingFlow
        mode="join"
        email={email}
        domain={check.domain}
        existingOrg={{
          id: existing.id,
          name: existing.name,
          memberCount: Number(existing.member_count ?? 0),
        }}
      />
    );
  }

  return (
    <OnboardingFlow
      mode="create"
      email={email}
      domain={check.domain}
      suggestedName={suggestOrgName(check.domain)}
    />
  );
}
