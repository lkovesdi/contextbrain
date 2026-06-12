"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Dev-only sign-in used by the button on /login when magic-link can't round-trip
// (e.g. inside the Tauri WebView, where the email link opens in the system
// browser and breaks PKCE). Mirrors /api/dev-login's logic but cookie-bound to
// the current request so the session lands in the same WebView. Hard-404s in
// production via the NODE_ENV check on both the server action AND the calling
// JSX block.
export async function devSignIn() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("devSignIn is disabled in production");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  }

  const email =
    process.env.DEV_LOGIN_EMAIL || "lacikovesdi@gmail.com";

  const admin = createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    throw error ?? new Error("generateLink returned no token");
  }

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyErr) throw verifyErr;

  redirect("/meetings");
}
