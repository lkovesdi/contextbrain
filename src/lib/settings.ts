import { createClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";

// Providers whose keys a user can bring. Composio stays app-level (users connect
// via OAuth on the Integrations page), so it is intentionally not here.
export type KeyProvider = "anthropic" | "openai" | "deepgram";

// Platform fallback keys — the deployment's own keys, used when a user hasn't
// supplied (or has disabled) their own. Read lazily so a blank env doesn't crash
// import.
function platformKey(provider: KeyProvider): string {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ?? "";
    case "openai":
      return process.env.OPENAI_API_KEY ?? "";
    case "deepgram":
      return process.env.DEEPGRAM_API_KEY ?? "";
  }
}

type SettingsRow = {
  anthropic_key: string | null;
  openai_key: string | null;
  deepgram_key: string | null;
  deepgram_project_id: string | null;
  anthropic_enabled: boolean;
  openai_enabled: boolean;
  deepgram_enabled: boolean;
};

const ROW_COLS =
  "anthropic_key, openai_key, deepgram_key, deepgram_project_id, anthropic_enabled, openai_enabled, deepgram_enabled";

function pick(
  row: SettingsRow,
  provider: KeyProvider
): { enc: string | null; enabled: boolean } {
  switch (provider) {
    case "anthropic":
      return { enc: row.anthropic_key, enabled: row.anthropic_enabled };
    case "openai":
      return { enc: row.openai_key, enabled: row.openai_enabled };
    case "deepgram":
      return { enc: row.deepgram_key, enabled: row.deepgram_enabled };
  }
}

export type ResolvedKey = {
  apiKey: string;
  usingUserKey: boolean;
  projectId?: string; // Deepgram only
};

// Resolve the key to use for `userId` + `provider`: their own decrypted key when
// present + enabled, else the platform key. Never throws — any failure (missing
// encryption key, decrypt error, DB error) falls back to the platform key so an
// AI route is never taken down by BYOK.
export async function resolveKey(
  userId: string,
  provider: KeyProvider
): Promise<ResolvedKey> {
  const fallbackProject =
    provider === "deepgram" ? process.env.DEEPGRAM_PROJECT_ID || undefined : undefined;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("user_settings")
      .select(ROW_COLS)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) {
      const row = data as SettingsRow;
      const { enc, enabled } = pick(row, provider);
      if (enabled && enc) {
        const key = decryptSecret(enc);
        if (key) {
          return {
            apiKey: key,
            usingUserKey: true,
            projectId:
              provider === "deepgram"
                ? row.deepgram_project_id || fallbackProject
                : undefined,
          };
        }
      }
    }
  } catch (e) {
    console.error(`[settings] resolveKey(${provider}) → platform fallback:`, e);
  }
  return { apiKey: platformKey(provider), usingUserKey: false, projectId: fallbackProject };
}

// ----- Masked status for the Settings UI (never returns plaintext keys) -------

export type ProviderStatus = {
  set: boolean;
  enabled: boolean;
  maskedSuffix: string | null;
  projectId?: string | null;
};

export type SettingsStatus = {
  anthropic: ProviderStatus;
  deepgram: ProviderStatus;
};

function maskFromCiphertext(enc: string | null): string | null {
  if (!enc) return null;
  try {
    const key = decryptSecret(enc);
    return key ? `…${key.slice(-4)}` : null;
  } catch {
    return null; // e.g. encryption key not configured — still report "set"
  }
}

const EMPTY: ProviderStatus = { set: false, enabled: true, maskedSuffix: null };

export async function getSettingsStatus(): Promise<SettingsStatus> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { anthropic: { ...EMPTY }, deepgram: { ...EMPTY, projectId: null } };

  const { data } = await supabase
    .from("user_settings")
    .select(ROW_COLS)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return { anthropic: { ...EMPTY }, deepgram: { ...EMPTY, projectId: null } };

  const row = data as SettingsRow;
  return {
    anthropic: {
      set: !!row.anthropic_key,
      enabled: row.anthropic_enabled,
      maskedSuffix: maskFromCiphertext(row.anthropic_key),
    },
    deepgram: {
      set: !!row.deepgram_key,
      enabled: row.deepgram_enabled,
      maskedSuffix: maskFromCiphertext(row.deepgram_key),
      projectId: row.deepgram_project_id,
    },
  };
}
