import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { findActiveConnection } from "@/lib/composio";
import { listFileNodes } from "@/lib/figma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await findActiveConnection(user.id, "figma"))) {
    return NextResponse.json({ error: "Figma not connected" }, { status: 412 });
  }
  const fileKey = (new URL(req.url).searchParams.get("file") ?? "").trim();
  if (!fileKey) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  try {
    const nodes = await listFileNodes(user.id, fileKey);
    return NextResponse.json({ nodes });
  } catch (e) {
    console.error("/api/figma/nodes failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Figma call failed" },
      { status: 502 }
    );
  }
}
