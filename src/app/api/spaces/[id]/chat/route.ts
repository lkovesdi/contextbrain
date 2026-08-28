import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  ATTACHMENTS_BUCKET,
  storedAttachmentPaths,
} from "@/lib/chat-attachments";

// Clear a space's chat thread. RLS restricts the delete to the caller's own
// rows, so a foreign space id is a harmless no-op.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  // Collect the thread's stored screenshots first — the row delete cascades
  // nothing into storage, so orphans would pile up. Best-effort: a failure
  // here (e.g. migration 0022 not applied yet) must not block the clear.
  const { data: rows } = await supabase
    .from("chat_messages")
    .select("attachments")
    .eq("space_id", id)
    .not("attachments", "eq", "[]");
  const paths = (rows ?? []).flatMap((r) =>
    storedAttachmentPaths((r as { attachments?: unknown }).attachments)
  );

  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("space_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (paths.length) {
    void supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove(paths)
      .then(({ error: e }) => {
        if (e) console.error("[space-chat] attachment cleanup failed:", e.message);
      });
  }
  return NextResponse.json({ ok: true });
}
