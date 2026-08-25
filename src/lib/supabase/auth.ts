import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthUser = {
  id: string;
  email: string | null;
  isAnonymous: boolean;
};

// Resolves the authenticated user from the session JWT via getClaims(), which
// verifies the signature locally (cached JWKS) instead of round-tripping to
// the Supabase Auth server the way getUser() does on every call. On legacy
// HS256 projects the library falls back to a server check internally, so this
// is never less safe than getUser() — only faster. proxy.ts owns session
// refresh; route handlers and pages should use this.
export async function getAuthUser(
  supabase: SupabaseClient
): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    isAnonymous: (claims.is_anonymous as boolean | undefined) ?? false,
  };
}
