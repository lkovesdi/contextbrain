import { createClient } from "@/lib/supabase/server";
import {
  findActiveConnection,
  initiateConnection,
  type Provider,
} from "@/lib/composio";
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  provider: z.enum(["github", "jira", "figma", "linear"]),
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
  const provider = parsed.data.provider as Provider;

  // Reconcile: if Composio already holds an ACTIVE connection for this user
  // (e.g. OAuth completed before our callback was wired), flip our row to
  // connected and skip OAuth entirely.
  const existing = await findActiveConnection(user.id, provider);
  if (existing) {
    const { error: upsertErr } = await supabase.from("integrations").upsert(
      {
        user_id: user.id,
        provider,
        composio_connection_id: existing.id,
        metadata: { status: "connected" },
      },
      { onConflict: "user_id,provider" }
    );
    if (upsertErr) {
      console.error("integrations upsert failed:", upsertErr);
      return NextResponse.json(
        {
          error: `Found an active Composio connection but could not persist it: ${upsertErr.message}. Have you run the Supabase schema?`,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ already_connected: true });
  }

  const { origin } = new URL(req.url);
  const callbackUrl = `${origin}/api/integrations/callback?provider=${provider}`;

  try {
    const { redirectUrl, connectionId } = await initiateConnection(
      user.id,
      provider,
      callbackUrl
    );
    await supabase.from("integrations").upsert(
      {
        user_id: user.id,
        provider,
        composio_connection_id: connectionId,
        metadata: { status: "pending" },
      },
      { onConflict: "user_id,provider" }
    );
    return NextResponse.json({ redirect_url: redirectUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Composio initiate failed" },
      { status: 500 }
    );
  }
}
