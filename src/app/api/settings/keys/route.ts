import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { getSettingsStatus } from "@/lib/settings";

// Only providers a user can bring a key for. Composio is app-level (OAuth on the
// Integrations page), OpenAI/embeddings are locked to the platform key in v1.
const Provider = z.enum(["anthropic", "deepgram"]);

const SaveBody = z.object({
  provider: Provider,
  key: z.string().min(1),
  project_id: z.string().optional(), // Deepgram
  enabled: z.boolean().optional(),
});

const ToggleBody = z.object({
  provider: Provider,
  enabled: z.boolean(),
});

async function requireUser() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  return { supabase, user };
}

// Save (or replace) a provider key: validate, encrypt, upsert.
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = SaveBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }
  const { provider, key, project_id, enabled } = parsed.data;

  const trimmed = key.trim();
  if (provider === "anthropic" && !trimmed.startsWith("sk-ant-")) {
    return NextResponse.json(
      { error: "That doesn't look like an Anthropic key (expected sk-ant-…)." },
      { status: 400 }
    );
  }

  let ciphertext: string;
  try {
    ciphertext = encryptSecret(trimmed);
  } catch (e) {
    console.error("[settings/keys] encrypt failed:", e);
    return NextResponse.json(
      { error: "Server encryption key not configured (BYOK_ENCRYPTION_KEY)." },
      { status: 500 }
    );
  }

  const patch: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (provider === "anthropic") {
    patch.anthropic_key = ciphertext;
    patch.anthropic_enabled = enabled ?? true;
  } else {
    patch.deepgram_key = ciphertext;
    patch.deepgram_enabled = enabled ?? true;
    if (project_id !== undefined) patch.deepgram_project_id = project_id.trim() || null;
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert(patch, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(await getSettingsStatus());
}

// Toggle "use my key" without re-entering it.
export async function PATCH(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = ToggleBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { provider, enabled } = parsed.data;
  const col = provider === "anthropic" ? "anthropic_enabled" : "deepgram_enabled";

  const { error } = await supabase
    .from("user_settings")
    .update({ [col]: enabled, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(await getSettingsStatus());
}

// Remove a stored key.
export async function DELETE(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = new URL(req.url).searchParams.get("provider");
  const p = Provider.safeParse(provider);
  if (!p.success) return NextResponse.json({ error: "Missing/invalid provider" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.data === "anthropic") {
    patch.anthropic_key = null;
  } else {
    patch.deepgram_key = null;
    patch.deepgram_project_id = null;
  }

  const { error } = await supabase
    .from("user_settings")
    .update(patch)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(await getSettingsStatus());
}
