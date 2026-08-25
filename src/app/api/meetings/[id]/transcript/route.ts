import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { embed } from "@/lib/embed";
import { NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({
  speaker: z.string().nullable().optional(),
  text: z.string().min(1),
  timestamp_ms: z.number().int().nonnegative().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Dedupe back-to-back identical transcripts. Deepgram occasionally emits the
  // same finalized segment twice, and any client weirdness (Strict Mode double
  // mount, a second tab open on the meeting, Fast Refresh mid-recording) can
  // also POST the same line twice. We swallow re-POSTs that match the most
  // recent row by (meeting, speaker, content) within a 5-second window.
  const DEDUP_WINDOW_MS = 5_000;
  const sinceIso = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
  const speakerVal = parsed.data.speaker ?? null;
  let recentQ = supabase
    .from("transcripts")
    .select("id")
    .eq("meeting_id", meetingId)
    .eq("user_id", user.id)
    .eq("content", parsed.data.text)
    .gte("created_at", sinceIso)
    .limit(1);
  recentQ = speakerVal === null
    ? recentQ.is("speaker", null)
    : recentQ.eq("speaker", speakerVal);
  const { data: recent } = await recentQ;
  if (recent && recent.length > 0) {
    return NextResponse.json({ ok: true, id: recent[0].id, deduped: true });
  }

  const { data, error } = await supabase
    .from("transcripts")
    .insert({
      meeting_id: meetingId,
      user_id: user.id,
      speaker: speakerVal,
      content: parsed.data.text,
      timestamp_ms: parsed.data.timestamp_ms ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire-and-forget embedding so we don't block the live stream.
  embed(parsed.data.text)
    .then((vector) =>
      supabase.from("transcripts").update({ embedding: vector }).eq("id", data.id)
    )
    .catch((e) => console.error("transcript embed failed:", e));

  return NextResponse.json({ ok: true, id: data.id });
}
