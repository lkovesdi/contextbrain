import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const Patch = z.object({
  title: z.string().optional(),
  ended_at: z.string().nullable().optional(),
  summary: z.string().optional(),
  summary_title: z.string().nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Cascade space changes to notes that still inherit from this meeting,
  // i.e. notes whose current space_id matches the meeting's old space_id.
  // Notes the user has independently re-filed (different space_id) are
  // left alone.
  let oldSpaceId: string | null | undefined;
  if (parsed.data.space_id !== undefined) {
    const { data: prev } = await supabase
      .from("meetings")
      .select("space_id")
      .eq("id", id)
      .single();
    oldSpaceId = prev?.space_id ?? null;
  }

  const { error } = await supabase
    .from("meetings")
    .update(parsed.data)
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (parsed.data.space_id !== undefined && oldSpaceId !== parsed.data.space_id) {
    const q = supabase
      .from("notes")
      .update({ space_id: parsed.data.space_id })
      .eq("meeting_id", id);
    const { error: noteErr } = await (oldSpaceId === null
      ? q.is("space_id", null)
      : q.eq("space_id", oldSpaceId));
    if (noteErr) {
      console.error("note space cascade failed:", noteErr.message);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase.from("meetings").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
