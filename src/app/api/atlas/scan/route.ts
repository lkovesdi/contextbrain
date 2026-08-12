import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { creditErrorResponse } from "@/lib/credits";
import { findActiveConnection } from "@/lib/composio";
import { scanStep } from "@/lib/atlas";

// One bounded scan step (~5 repo cards). The Integrations card calls this in
// a loop until `pending` hits 0 — client-driven continuation keeps every
// invocation inside the serverless budget, and an interrupted scan resumes
// exactly where it stopped.
export const maxDuration = 300;

const Body = z.object({
  // First call of a scan passes discover:true to sync the repo list from
  // GitHub; continuation calls skip it. rebuild:true re-cards everything.
  discover: z.boolean().default(false),
  rebuild: z.boolean().default(false),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await findActiveConnection(user.id, "github");
  if (!conn) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 412 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await scanStep(supabase, user.id, {
      discover: parsed.data.discover,
      rebuild: parsed.data.rebuild,
    });
    return NextResponse.json(result);
  } catch (e) {
    const credit = creditErrorResponse(e);
    if (credit) return credit;
    console.error("[atlas] scan step failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Scan failed" },
      { status: 502 }
    );
  }
}
