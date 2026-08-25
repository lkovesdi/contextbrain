import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { resolveKey } from "@/lib/settings";
import { debitTranscription, TRANSCRIPTION_FLOOR_SECONDS } from "@/lib/credits";
import { NextResponse } from "next/server";

// Client-reported transcription metering: the recording provider POSTs the
// elapsed seconds of a finished Deepgram session and we debit the user's
// prepaid credits. BYOK users are never metered. debitTranscription clamps
// the duration server-side, so a hostile client can only over-report up to
// the clamp — and only against its own balance.
export async function POST(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { seconds?: unknown; meetingId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const seconds = body.seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return NextResponse.json(
      { error: "seconds must be a finite positive number" },
      { status: 400 }
    );
  }
  const meetingId = typeof body.meetingId === "string" ? body.meetingId : null;

  const { usingUserKey } = await resolveKey(user.id, "deepgram");
  if (usingUserKey) return NextResponse.json({ metered: false });

  // The first TRANSCRIPTION_FLOOR_SECONDS were already debited when the
  // ephemeral key was minted — only bill the time beyond the floor.
  const billable = Math.max(0, seconds - TRANSCRIPTION_FLOOR_SECONDS);
  if (billable > 0) {
    await debitTranscription(user.id, billable, { meeting_id: meetingId });
  }
  return NextResponse.json({ metered: true });
}
