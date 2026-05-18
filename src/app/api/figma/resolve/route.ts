import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findActiveConnection } from "@/lib/composio";
import { resolveFigmaUrl } from "@/lib/figma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "figma"))) {
    return NextResponse.json({ error: "Figma not connected" }, { status: 412 });
  }
  const url = (new URL(req.url).searchParams.get("url") ?? "").trim();
  if (!url) return NextResponse.json({ files: [] });
  if (!/figma\.com/i.test(url)) {
    // Don't waste a Composio call on something that obviously isn't a URL —
    // the picker pings us on every keystroke until the paste is complete.
    return NextResponse.json({ files: [] });
  }
  try {
    const file = await resolveFigmaUrl(user.id, url);
    return NextResponse.json({ files: file ? [file] : [] });
  } catch (e) {
    console.error("/api/figma/resolve failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Figma call failed" },
      { status: 502 }
    );
  }
}
