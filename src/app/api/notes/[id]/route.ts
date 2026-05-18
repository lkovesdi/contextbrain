import { createClient } from "@/lib/supabase/server";
import { embed } from "@/lib/embed";
import { NextResponse } from "next/server";
import { z } from "zod";

const Patch = z.object({
  content: z.string().optional(),
  is_checked: z.boolean().optional(),
  space_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const supabase = await createClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.content !== undefined) update.content = parsed.data.content;
  if (parsed.data.is_checked !== undefined) update.is_checked = parsed.data.is_checked;
  if (parsed.data.space_id !== undefined) update.space_id = parsed.data.space_id;

  const { error } = await supabase.from("notes").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (parsed.data.content !== undefined) {
    embed(parsed.data.content)
      .then((vector) =>
        supabase.from("notes").update({ embedding: vector }).eq("id", id)
      )
      .catch((e) => console.error("note embed failed:", e));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
