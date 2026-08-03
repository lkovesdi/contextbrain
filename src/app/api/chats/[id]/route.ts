import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ChatSelectionSchema, getChatMeetingIds, setChatMeetings } from "@/lib/chats";

const Patch = z.object({
  title: z.string().min(1).nullable().optional(),
  selection: ChatSelectionSchema.optional(),
  enabled_tools: z.array(z.string()).optional(),
  meeting_ids: z.array(z.string().uuid()).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: chat, error } = await supabase
    .from("chats")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const meeting_ids = await getChatMeetingIds(supabase, id);
  return NextResponse.json({ ...chat, meeting_ids });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 }
    );
  }
  const { meeting_ids, ...fields } = parsed.data;

  // Always bump updated_at so the chat list re-sorts on any edit.
  const { error } = await supabase
    .from("chats")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let attached: string[] | undefined;
  if (meeting_ids !== undefined) {
    attached = await setChatMeetings(supabase, user.id, id, meeting_ids);
  }
  return NextResponse.json({
    ok: true,
    ...(attached !== undefined ? { meeting_ids: attached } : {}),
  });
}

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

  const { error } = await supabase.from("chats").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
