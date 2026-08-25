import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import {
  deleteConnections,
  findActiveConnection,
  type Provider,
} from "@/lib/composio";
import { NextResponse } from "next/server";
import { z } from "zod";

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
  const user = await getAuthUser(supabase);
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

// GitHub-only for now: which account the integration reads repos from. null
// means the connected user's personal repos; an org login scopes repo search
// and atlas discovery to that org. Stored on the row's metadata so the whole
// server side (repos route, atlas scan) reads one source of truth.
const PatchBody = z.object({
  org: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/, "Invalid organization name")
    .nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (provider !== "github") {
    return NextResponse.json({ error: "Not supported for this provider" }, { status: 400 });
  }
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("integrations")
    .select("metadata")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "Not connected" }, { status: 404 });
  }

  const metadata = { ...((row.metadata as Record<string, unknown> | null) ?? {}) };
  if (parsed.data.org) metadata.org = parsed.data.org;
  else delete metadata.org;

  const { error } = await supabase
    .from("integrations")
    .update({ metadata })
    .eq("user_id", user.id)
    .eq("provider", provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, org: parsed.data.org });
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
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Tear down Composio's connected account(s) too — a lingering ACTIVE
  // connection makes the next Connect short-circuit ("already connected")
  // instead of re-running OAuth. Best-effort: a Composio blip shouldn't trap
  // the user in a connected state they asked to leave.
  try {
    await deleteConnections(user.id, provider as Provider);
  } catch (e) {
    console.error(`[integrations] composio teardown failed for ${provider}:`, e);
  }

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
