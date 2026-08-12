import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Balance + recent ledger activity for the signed-in user. RLS scopes the
// ledger select to the owner, and credit_balance_usd_micros only answers for
// the caller's own id (see 0020_credits.sql).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [balanceRes, entriesRes] = await Promise.all([
    supabase.rpc("credit_balance_usd_micros", { p_user_id: user.id }),
    supabase
      .from("credit_ledger")
      .select("id, delta_usd_micros, reason, meta, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (balanceRes.error) {
    return NextResponse.json({ error: balanceRes.error.message }, { status: 500 });
  }
  if (entriesRes.error) {
    return NextResponse.json({ error: entriesRes.error.message }, { status: 500 });
  }

  // bigint comes back as number for sane magnitudes; coerce defensively.
  const raw = balanceRes.data;
  const balanceUsdMicros = typeof raw === "number" ? raw : Number(raw ?? 0);

  return NextResponse.json({ balanceUsdMicros, entries: entriesRes.data ?? [] });
}
