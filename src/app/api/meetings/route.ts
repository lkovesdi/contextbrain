import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  title: z.string().optional(),
  context_preset_id: z.string().uuid().nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // If the caller specified a space but no preset, fall back to the space's
  // default preset so meetings created from a space inherit its context bundle.
  let contextPresetId = parsed.data.context_preset_id ?? null;
  if (parsed.data.space_id && !contextPresetId) {
    const { data: space } = await supabase
      .from("spaces")
      .select("default_preset_id")
      .eq("id", parsed.data.space_id)
      .single();
    contextPresetId = space?.default_preset_id ?? null;
  }

  const { data, error } = await supabase
    .from("meetings")
    .insert({
      user_id: user.id,
      title: parsed.data.title || "Untitled meeting",
      context_preset_id: contextPresetId,
      space_id: parsed.data.space_id ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id });
}
