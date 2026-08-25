import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listResearch, liveScoutStep } from "@/lib/scout";
import { assertCredits, creditErrorResponse } from "@/lib/credits";
import { resolveKey } from "@/lib/settings";

// Live in-meeting scouting. The workspace polls GET cheaply for the current
// research rows (including in-flight 'running' ones, which render as the
// "scout is looking into…" trace) and POSTs a step every couple of minutes
// while recording. A step reads the transcript so far, extracts asks not yet
// researched, routes them over the repo atlas, and deep-scouts the routed
// ones — several model calls plus GitHub reads, hence the raised budget.
export const maxDuration = 300;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .single();
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  return NextResponse.json({ research: await listResearch(supabase, meetingId) });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .single();
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  // Platform-key users must have credits before any model call is made; a
  // 402 here also tells the workspace to stop scheduling further steps.
  const { usingUserKey } = await resolveKey(user.id, "anthropic");
  if (!usingUserKey) {
    try {
      await assertCredits(user.id);
    } catch (e) {
      const r = creditErrorResponse(e);
      if (r) return r;
      throw e;
    }
  }

  try {
    return NextResponse.json({
      research: await liveScoutStep(supabase, user.id, meetingId),
    });
  } catch (e) {
    const r = creditErrorResponse(e);
    if (r) return r;
    throw e;
  }
}
