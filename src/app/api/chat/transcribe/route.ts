import { createClient as createDg } from "@deepgram/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserVerified } from "@/lib/supabase/auth";
import { resolveKey } from "@/lib/settings";
import {
  assertCredits,
  creditErrorResponse,
  debitTranscription,
} from "@/lib/credits";
import { NextResponse } from "next/server";

export const maxDuration = 60;

// 16 kHz mono 16-bit WAV is 32 KB/s — a 60 s recording is under 2 MB. The
// cap just stops someone posting an hour of audio through this route.
const MAX_BYTES = 12 * 1024 * 1024;
const WAV_BYTES_PER_SECOND = 16_000 * 2;

// Transcribes the narration of a screen recording (client-extracted WAV) so
// the chat can hand the model "what the user said" alongside the frames.
// Same key/credit rules as live transcription: the user's Deepgram key when
// set, else the platform key gated + debited by prepaid credits.
export async function POST(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUserVerified(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/wav")) {
    return NextResponse.json({ error: "Expected audio/wav" }, { status: 415 });
  }
  const audio = Buffer.from(await req.arrayBuffer());
  if (!audio.length) return NextResponse.json({ error: "Empty body" }, { status: 400 });
  if (audio.length > MAX_BYTES) {
    return NextResponse.json({ error: "Recording too long" }, { status: 413 });
  }
  const seconds = Math.max(1, Math.round((audio.length - 44) / WAV_BYTES_PER_SECOND));

  const { apiKey, usingUserKey } = await resolveKey(user.id, "deepgram");
  if (!apiKey) {
    return NextResponse.json(
      { error: "Deepgram isn't configured. Add your key in Settings." },
      { status: 400 }
    );
  }
  if (!usingUserKey) {
    try {
      await assertCredits(user.id);
    } catch (e) {
      const res = creditErrorResponse(e);
      if (res) return res;
      throw e;
    }
  }

  const dg = createDg(apiKey);
  const { result, error } = await dg.listen.prerecorded.transcribeFile(audio, {
    model: "nova-2",
    smart_format: true,
    punctuate: true,
  });
  if (error) {
    console.error("[chat/transcribe] Deepgram failed:", error.message);
    return NextResponse.json({ error: `Deepgram: ${error.message}` }, { status: 502 });
  }
  const transcript =
    result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";

  if (!usingUserKey) {
    await debitTranscription(user.id, seconds, { source: "screen_recording" });
  }
  return NextResponse.json({ transcript, seconds });
}
