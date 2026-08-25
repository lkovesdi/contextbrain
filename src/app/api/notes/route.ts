import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { embed } from "@/lib/embed";
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  content: z.string().min(1),
  meeting_id: z.string().uuid().nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Inherit the meeting's space when the client didn't pin one explicitly,
  // so notes typed during a meeting land in the same folder as the meeting.
  let spaceId: string | null = parsed.data.space_id ?? null;
  if (spaceId === null && parsed.data.meeting_id) {
    const { data: m } = await supabase
      .from("meetings")
      .select("space_id")
      .eq("id", parsed.data.meeting_id)
      .single();
    spaceId = m?.space_id ?? null;
  }

  const { data, error } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      meeting_id: parsed.data.meeting_id ?? null,
      space_id: spaceId,
      content: parsed.data.content,
    })
    .select("id,content,is_checked,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  embed(parsed.data.content)
    .then((vector) =>
      supabase.from("notes").update({ embedding: vector }).eq("id", data.id)
    )
    .catch((e) => console.error("note embed failed:", e));

  return NextResponse.json(data);
}
