import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ChatSelectionSchema, setChatMeetings } from "@/lib/chats";

const Create = z.object({
  title: z.string().min(1).optional(),
  selection: ChatSelectionSchema.optional(),
  enabled_tools: z.array(z.string()).optional(),
  meeting_ids: z.array(z.string().uuid()).optional(),
});

// List the caller's chats, most-recently-updated first. RLS scopes to the owner.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("chats")
    .select("id, title, selection, enabled_tools, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Create.safeParse(await req.json().catch(() => ({})));
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
  const { title, selection, enabled_tools, meeting_ids } = parsed.data;

  const { data: chat, error } = await supabase
    .from("chats")
    .insert({
      user_id: user.id,
      title: title ?? null,
      selection: selection ?? {},
      enabled_tools: enabled_tools ?? [],
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const attached = await setChatMeetings(supabase, user.id, chat.id, meeting_ids ?? []);
  return NextResponse.json({ ...chat, meeting_ids: attached });
}
