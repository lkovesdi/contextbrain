import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

const Create = z.object({
  title: z.string().trim().max(80).optional(),
  repos: z
    .array(
      z.object({
        owner: z.string().min(1),
        name: z.string().min(1),
        branch: z.string().min(1),
      })
    )
    .min(1)
    .max(6),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Create.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { title, repos } = parsed.data;

  const { data, error } = await supabase
    .from("diagrams")
    .insert({
      user_id: user.id,
      title: title || repos.map((r) => r.name).join(" + "),
      repos,
    })
    .select("id,title,repos,current_version,created_at,updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
