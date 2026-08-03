import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Clear a space's chat thread. RLS restricts the delete to the caller's own
// rows, so a foreign space id is a harmless no-op.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("space_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
