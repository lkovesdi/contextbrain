import { createClient as createDg } from "@deepgram/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { resolveKey } from "@/lib/settings";
import {
  assertCredits,
  creditErrorResponse,
  debitTranscription,
  TRANSCRIPTION_FLOOR_SECONDS,
} from "@/lib/credits";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user key when set, else the platform Deepgram key (resolveKey handles
  // the fallback). Both key and project are needed to mint an ephemeral key.
  const { apiKey, usingUserKey, projectId } = await resolveKey(user.id, "deepgram");
  if (!apiKey || !projectId) {
    return NextResponse.json(
      { error: "Deepgram isn't configured. Add your key in Settings." },
      { status: 400 }
    );
  }
  // Platform key ⇒ prepaid credits must cover it; BYOK users skip metering.
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
  const { result, error } = await dg.manage.createProjectKey(projectId, {
    // Per-user tag so platform-key usage is attributable in the Deepgram
    // dashboard (and reconcilable against the credit ledger).
    comment: `cb:${user.id}`,
    scopes: ["usage:write"],
    time_to_live_in_seconds: 3600,
  });
  if (error) {
    console.error("[deepgram/token] createProjectKey failed:", error.message);
    // The usual culprit: an API key without key-management rights (Deepgram
    // 403 "does not have the required scope") — minting ephemeral keys needs
    // a key created with the Administrator role.
    return NextResponse.json({ error: `Deepgram: ${error.message}` }, { status: 500 });
  }
  // Floor debit at mint time: the browser streams to Deepgram directly, so a
  // client that never reports usage would otherwise transcribe for free. The
  // usage report (POST /api/deepgram/usage) only bills time beyond the floor.
  if (!usingUserKey) {
    await debitTranscription(user.id, TRANSCRIPTION_FLOOR_SECONDS, { floor: true });
  }
  return NextResponse.json({ key: result.key });
}
