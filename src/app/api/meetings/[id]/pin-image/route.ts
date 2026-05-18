import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Body = z.object({
  url: z.string().min(1),
  alt: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  // Default toggle: if the URL is already pinned, remove it; otherwise add.
  // Pass an explicit action when the caller wants idempotent semantics.
  action: z.enum(["toggle", "add", "remove"]).default("toggle"),
});

type PinnedImage = { url: string; alt: string | null; label: string | null };

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

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { url, alt = null, label = null, action } = parsed.data;

  const { data: meeting, error: loadErr } = await supabase
    .from("meetings")
    .select("user_id,pinned_summary_images")
    .eq("id", id)
    .single();
  if (loadErr || !meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if (meeting.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const current = (meeting.pinned_summary_images ?? []) as PinnedImage[];
  const exists = current.some((p) => p.url === url);

  let next: PinnedImage[];
  if (action === "remove" || (action === "toggle" && exists)) {
    next = current.filter((p) => p.url !== url);
  } else if (!exists) {
    next = [...current, { url, alt, label }];
  } else {
    // action === "add" but already pinned — refresh the alt/label fields.
    next = current.map((p) => (p.url === url ? { url, alt, label } : p));
  }

  const { error: updErr } = await supabase
    .from("meetings")
    .update({ pinned_summary_images: next })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ pinned: next, isPinned: next.some((p) => p.url === url) });
}
