import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { NextResponse } from "next/server";
import { getSettingsStatus } from "@/lib/settings";

// Masked settings status for the current user (never returns plaintext keys).
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await getSettingsStatus());
}
