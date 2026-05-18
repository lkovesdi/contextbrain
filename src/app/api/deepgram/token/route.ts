import { createClient as createDg } from "@deepgram/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dg = createDg(process.env.DEEPGRAM_API_KEY!);
  const { result, error } = await dg.manage.createProjectKey(
    process.env.DEEPGRAM_PROJECT_ID!,
    {
      comment: "Ephemeral browser key",
      scopes: ["usage:write"],
      time_to_live_in_seconds: 3600,
    }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ key: result.key });
}
