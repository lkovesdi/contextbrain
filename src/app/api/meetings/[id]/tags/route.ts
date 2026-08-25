import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Tag } from "@/lib/tags";

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

const Attach = z.object({
  // label_key null/absent = plain tag; set = smart-label namespace.
  label_key: z.string().trim().min(1).max(40).nullable().optional(),
  value: z.string().trim().min(1).max(80),
});

// Applied tags for a meeting, oldest first so the chip order is stable as the
// user adds more.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("meeting_tags")
    .select("tag:tags(id,label_key,value)")
    .eq("meeting_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tags = ((data ?? []) as unknown as { tag: Tag | null }[])
    .map((r) => r.tag)
    .filter((t): t is Tag => !!t);
  return NextResponse.json(tags);
}

// Attach a tag to the meeting, coining the tag first if it doesn't exist yet.
// Accepts a { label_key?, value } spec rather than a tag id so the picker can
// create-and-attach in one round trip.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Attach.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const tag = await resolveTag(supabase, user.id, {
    label_key: parsed.data.label_key ? parsed.data.label_key.toLowerCase() : null,
    value: parsed.data.value,
  });
  if (!tag) {
    return NextResponse.json({ error: "Could not create tag" }, { status: 500 });
  }

  // ignoreDuplicates so re-attaching an already-applied tag is a no-op.
  const { error: linkErr } = await supabase
    .from("meeting_tags")
    .upsert(
      { meeting_id: id, tag_id: tag.id, user_id: user.id },
      { onConflict: "meeting_id,tag_id", ignoreDuplicates: true }
    );
  if (linkErr) {
    return NextResponse.json({ error: linkErr.message }, { status: 500 });
  }
  return NextResponse.json(tag);
}

// Detach a tag from the meeting (the tag itself survives for reuse).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tagId = new URL(req.url).searchParams.get("tag_id");
  if (!tagId) {
    return NextResponse.json({ error: "tag_id required" }, { status: 400 });
  }
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("meeting_tags")
    .delete()
    .eq("meeting_id", id)
    .eq("tag_id", tagId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Find an existing tag matching the spec (case-insensitive on value, exact on
// the already-normalized key) or coin a new one. Comparing in JS keeps the
// functional unique index (migration 0007) authoritative without fighting its
// expression in an onConflict clause; a unique-violation race falls back to a
// re-read.
async function resolveTag(
  supabase: SupabaseLike,
  userId: string,
  spec: { label_key: string | null; value: string }
): Promise<Tag | null> {
  const value = spec.value.trim();
  const key = spec.label_key;

  const find = async (): Promise<Tag | null> => {
    let q = supabase.from("tags").select("id,label_key,value");
    q = key === null ? q.is("label_key", null) : q.eq("label_key", key);
    const { data } = await q;
    return (
      ((data ?? []) as Tag[]).find(
        (t) => t.value.toLowerCase() === value.toLowerCase()
      ) ?? null
    );
  };

  const existing = await find();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("tags")
    .insert({ user_id: userId, label_key: key, value })
    .select("id,label_key,value")
    .single();
  if (created) return created as Tag;
  if (error) return await find(); // likely a unique-violation race
  return null;
}
