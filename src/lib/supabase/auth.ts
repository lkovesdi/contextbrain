import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthUser = {
  id: string;
  email: string | null;
  isAnonymous: boolean;
};

// Resolves the authenticated user from the session JWT via getClaims(), which
// verifies the signature locally (cached JWKS) instead of round-tripping to
// the Supabase Auth server the way getUser() does on every call. proxy.ts
// owns session refresh; route handlers and pages should use this.
//
// Trade-off: local verification accepts a valid, unexpired JWT even if the
// user was banned/deleted since it was minted — revocation lands at token
// expiry rather than instantly. Fine for read/CRUD paths behind RLS; routes
// that spend money or mint credentials use getAuthUserVerified() below.
export async function getAuthUser(
  supabase: SupabaseClient
): Promise<AuthUser | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    return {
      id: claims.sub,
      email: (claims.email as string | undefined) ?? null,
      isAnonymous: (claims.is_anonymous as boolean | undefined) ?? false,
    };
  } catch {
    // Malformed/corrupt token — treat as signed out, never throw into the
    // route handler.
    return null;
  }
}

// Network-verified variant: round-trips to the Auth server so a revoked,
// banned, or deleted account fails immediately instead of at JWT expiry.
// Reserve for spend-sensitive paths (credential minting, checkout, model
// calls) — everything else should take getAuthUser()'s local fast path.
export async function getAuthUserVerified(
  supabase: SupabaseClient
): Promise<AuthUser | null> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;
    return {
      id: user.id,
      email: user.email ?? null,
      isAnonymous: (user as { is_anonymous?: boolean }).is_anonymous ?? false,
    };
  } catch {
    return null;
  }
}
