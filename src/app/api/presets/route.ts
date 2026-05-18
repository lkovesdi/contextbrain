import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { z } from "zod";

// zod v4's `z.record(z.enum([...]), ...)` treats every enum key as required —
// so `integrations: {}` is rejected with three "expected record, received
// undefined" errors. Use an explicit object with optional keys instead.
const IntegrationConfig = z.record(z.string(), z.any());
const SourcesSchema = z.object({
  external_context_ids: z.array(z.string().uuid()).optional(),
  // Specific notes hand-picked by the user. Retrieved as full content alongside
  // any embedding-search hits.
  note_ids: z.array(z.string().uuid()).optional(),
  // When set, chat pulls recent meeting summaries from this space so recurring
  // meetings can carry continuity automatically.
  space_id: z.string().uuid().nullable().optional(),
  recent_summary_count: z.number().int().min(1).max(20).optional(),
  integrations: z
    .object({
      github: IntegrationConfig.optional(),
      jira: IntegrationConfig.optional(),
      figma: IntegrationConfig.optional(),
    })
    .optional(),
});

const Create = z.object({
  name: z.string().min(1),
  sources: SourcesSchema,
});

const Update = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  sources: SourcesSchema.optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rawBody = await req.json().catch(() => ({}));
  const parsed = Create.safeParse(rawBody);
  if (!parsed.success) {
    console.error("[presets POST] zod rejection", {
      issues: parsed.error.issues,
      body: rawBody,
    });
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const { data, error } = await supabase
    .from("context_presets")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      sources: parsed.data.sources,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const rawBody = await req.json().catch(() => ({}));
  const parsed = Update.safeParse(rawBody);
  if (!parsed.success) {
    console.error("[presets PATCH] zod rejection", {
      issues: parsed.error.issues,
      body: rawBody,
    });
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const { id, ...patch } = parsed.data;
  const { error } = await supabase.from("context_presets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const { error } = await supabase.from("context_presets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
