import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Composio drives the OAuth dance and redirects users back to us with
// ?status=success (or ?status=failed). We include ?provider=<provider> in
// the callbackUrl we hand Composio, so we know which integrations row to flip.
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

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
