import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { NextResponse } from "next/server";

// Standalone page for OAuth windows that hold no ContextBrain session (e.g.
// desktop users authorize in their default browser). No redirect target would
// work there — the app itself detects completion by polling GET
// /api/integrations/[provider], so all this window needs to say is "go back".
function closeWindowPage(ok: boolean): string {
  const title = ok ? "Connected" : "Connection didn’t complete";
  const body = ok
    ? "You can close this window — ContextBrain will update in a moment."
    : "You can close this window and try again from ContextBrain’s Integrations page.";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — ContextBrain</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-content: center; text-align: center; font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; margin: 0; opacity: 0.7; }
</style>
</head>
<body>
<div>
<h1>${ok ? "✓ " : ""}${title}</h1>
<p>${body}</p>
</div>
</body>
</html>`;
}

// Composio drives the OAuth dance and redirects users back to us with
// ?status=success (or ?status=failed). We include ?provider=<provider> in
// the callbackUrl we hand Composio, so we know which integrations row to flip.
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) {
    return new NextResponse(closeWindowPage(searchParams.get("status") === "success"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const provider = searchParams.get("provider");
  const status = searchParams.get("status");

  if (provider && status === "success") {
    await supabase
      .from("integrations")
      .update({ metadata: { status: "connected" } })
      .eq("user_id", user.id)
      .eq("provider", provider);
    return NextResponse.redirect(`${origin}/integrations?connected=${provider}`);
  }

  if (provider && status === "failed") {
    await supabase
      .from("integrations")
      .delete()
      .eq("user_id", user.id)
      .eq("provider", provider);
    return NextResponse.redirect(`${origin}/integrations?failed=${provider}`);
  }

  return NextResponse.redirect(`${origin}/integrations`);
}
