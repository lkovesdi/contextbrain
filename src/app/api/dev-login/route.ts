import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// DEV-ONLY auth shortcut for e2e tests. Disabled in production and unless
// DEV_LOGIN_SECRET is set and matches, so it can never mint a session on a
// real deployment. Uses the service key to generate a magic-link token for a
// user, then verifies it on the cookie-bound SSR client — exercising the exact
// same session-cookie path the real /auth/callback uses (no email round-trip).
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const secret = process.env.DEV_LOGIN_SECRET;
  const { searchParams, origin } = new URL(request.url);
  if (!secret || searchParams.get("secret") !== secret) {
    return new NextResponse("Not found", { status: 404 });
  }

  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) {
    return NextResponse.json(
      { error: "Missing SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL" },
      { status: 500 }
    );
  }

  const email =
    searchParams.get("email") ||
    process.env.DEV_LOGIN_EMAIL ||
    "lacikovesdi@gmail.com";
  const next = searchParams.get("next") ?? "/meetings";

  const admin = createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.json(
      { error: error?.message ?? "Could not generate login link" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyErr) {
    return NextResponse.json({ error: verifyErr.message }, { status: 400 });
  }

  return NextResponse.redirect(`${origin}${next}`);
}
