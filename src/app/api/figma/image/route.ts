import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { getNodeImageUrl } from "@/lib/figma";

export const dynamic = "force-dynamic";

// 302-redirect to a freshly-rendered Figma image. The chat/summary embeds
// stable `/api/figma/image?file=…&node=…` URLs that resolve here on every
// browser fetch; we cache the underlying S3 URL server-side (see
// `getNodeImageUrl`) and instruct the browser to cache this redirect for an
// hour so a rendered summary page can scroll/reload without hammering
// Composio's rate-limited render endpoint.
export async function GET(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "figma"))) {
    return NextResponse.json({ error: "Figma not connected" }, { status: 412 });
  }
  const url = new URL(req.url);
  const fileKey = url.searchParams.get("file");
  const nodeId = url.searchParams.get("node");
  if (!fileKey || !nodeId) {
    return NextResponse.json(
      { error: "file and node are required" },
      { status: 400 }
    );
  }
  try {
    const result = await getNodeImageUrl(user.id, fileKey, nodeId);
    if (result.status === "rate_limited") {
      return NextResponse.json(
        { error: "Figma render rate limit hit — try again shortly." },
        { status: 429, headers: { "Retry-After": "30" } }
      );
    }
    if (result.status === "none") {
      return NextResponse.json({ error: "No image returned" }, { status: 502 });
    }
    return NextResponse.redirect(result.url, {
      status: 302,
      headers: {
        // Browser caches the redirect for 1h; the underlying S3 URL is
        // valid for ~30 days, so a stale-cache fetch will still resolve.
        // Marked `private` since results vary per user (per-file ACL).
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("/api/figma/image failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Render failed" },
      { status: 502 }
    );
  }
}
