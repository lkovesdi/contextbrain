import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAndStoreSummary } from "@/lib/summary";

// Generation is deliberately fire-and-forget: POST validates, marks the
// meeting summary_status='generating', schedules the real work with after(),
// and returns 202 immediately — so stopping a recording never pins the user
// to the page, and navigating away can't orphan the run. Clients observe
// progress by polling GET.
export const maxDuration = 120;

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

  const [{ data: meeting }, { data: transcriptProbe }, { data: noteProbe }] =
    await Promise.all([
      supabase.from("meetings").select("id").eq("id", meetingId).single(),
      supabase.from("transcripts").select("id").eq("meeting_id", meetingId).limit(1),
      supabase.from("notes").select("id").eq("meeting_id", meetingId).limit(1),
    ]);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }
  if ((transcriptProbe ?? []).length === 0 && (noteProbe ?? []).length === 0) {
    return NextResponse.json(
      { error: "Nothing to summarize — no transcript or notes." },
      { status: 400 }
    );
  }

  await supabase
    .from("meetings")
    .update({ summary_status: "generating", summary_error: null })
    .eq("id", meetingId);

  after(async () => {
    try {
      await generateAndStoreSummary(supabase, user.id, meetingId);
    } catch (e) {
      console.error("[summary] generation failed", e);
      await supabase
        .from("meetings")
        .update({
          summary_status: "error",
          summary_error: e instanceof Error ? e.message : "Summary generation failed",
        })
        .eq("id", meetingId);
    }
  });

  return NextResponse.json({ started: true }, { status: 202 });
}

// Poll target for the Recorder / SummarySection: reports where generation
// stands and, once done, carries the fresh summary so callers can update
// in place without a full refetch.
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
    .select("summary_status,summary_error,summary_title,summary,summary_extras")
    .eq("id", meetingId)
    .single();
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: meeting.summary_status ?? null,
    error: meeting.summary_error ?? null,
    hasSummary: !!meeting.summary,
    title: meeting.summary_title ?? null,
    summary: meeting.summary ?? null,
    extras: meeting.summary_extras ?? {},
  });
}
