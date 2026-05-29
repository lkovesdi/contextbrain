import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyWorkEmail, suggestOrgName } from "@/lib/orgs";

// DNS resolution requires the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().min(3).max(320) });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "Enter a valid email address." }, { status: 400 });
  }

  const check = await verifyWorkEmail(parsed.data.email);
  if (!check.ok) {
    return NextResponse.json({ ok: false, domain: check.domain, reason: check.reason });
  }

  // Surface an existing org on this domain so the user can join rather than
  // create a duplicate. find_org_by_domain is SECURITY DEFINER, so this works
  // even for an unauthenticated visitor on the signup screen.
  const supabase = await createClient();
  const { data } = await supabase.rpc("find_org_by_domain", { p_domain: check.domain });
  const existing = Array.isArray(data) ? data[0] : null;

  return NextResponse.json({
    ok: true,
    domain: check.domain,
    suggestedName: suggestOrgName(check.domain),
    existingOrg: existing
      ? { id: existing.id, name: existing.name, memberCount: Number(existing.member_count ?? 0) }
      : null,
  });
}
