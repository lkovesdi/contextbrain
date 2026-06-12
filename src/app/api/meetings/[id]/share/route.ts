import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Host-only: mint (or rotate) the guest share token for a meeting, and return
// the join link. Ownership is enforced by the `.eq("user_id", …)` filter plus
// the meetings RLS update policy.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const { data, error } = await supabase
    .from("meetings")
    .update({ share_token: token })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, share_token")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Meeting not found" },
      { status: 400 }
    );
  }

  const origin = new URL(req.url).origin;
  return NextResponse.json({
    token: data.share_token,
    url: `${origin}/join/${id}?t=${data.share_token}`,
  });
}

// Host-only: revoke the link. Existing guests keep their participant rows (they
// can still view until the meeting ends) but no new joins are possible.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("meetings")
    .update({ share_token: null })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
