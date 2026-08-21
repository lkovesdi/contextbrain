import { createClient } from "@/lib/supabase/server";
import { findActiveConnection, type Provider } from "@/lib/composio";
import { NextResponse } from "next/server";

// Status probe polled by the integrations page while an OAuth window is open.
// Reconciles against Composio directly, so completion is detected even when
// OAuth finished in a browser holding no ContextBrain session (the desktop
// flow): an ACTIVE connection flips our row to connected right here.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row } = await supabase
    .from("integrations")
    .select("metadata")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .maybeSingle();
  const status = (row?.metadata as { status?: string } | null)?.status ?? null;
  if (row && status !== "pending") return NextResponse.json({ status: "connected" });

  const active = await findActiveConnection(user.id, provider as Provider);
  if (active) {
    const { error } = await supabase.from("integrations").upsert(
      {
        user_id: user.id,
        provider,
        composio_connection_id: active.id,
        metadata: { status: "connected" },
      },
      { onConflict: "user_id,provider" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "connected" });
  }

  return NextResponse.json({ status: row ? "pending" : "none" });
}

// Data derived from a provider goes with the connection: disconnecting also
// purges what we indexed from it, so "disconnect" honestly means "and your
// content leaves our database". external_chunks cascade with their contexts.
const PURGE: Record<string, { contextsPrefix?: string; atlas?: boolean }> = {
  github: { contextsPrefix: "github_", atlas: true },
  figma: { contextsPrefix: "figma_" },
  jira: { contextsPrefix: "jira_" },
  linear: { contextsPrefix: "linear_" },
};

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("integrations")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const purge = PURGE[provider];
  if (purge) {
    if (purge.atlas) {
      const { error: e } = await supabase
        .from("repo_atlas")
        .delete()
        .eq("user_id", user.id);
      if (e) console.error(`[integrations] atlas purge failed for ${provider}:`, e.message);
    }
    if (purge.contextsPrefix) {
      const { error: e } = await supabase
        .from("external_contexts")
        .delete()
        .eq("user_id", user.id)
        .like("source_type", `${purge.contextsPrefix}%`);
      if (e) console.error(`[integrations] context purge failed for ${provider}:`, e.message);
    }
  }

  return NextResponse.json({ ok: true });
}
