import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Quick-start entry point for the desktop "Meeting Detected" popup. The native
// popup can't create a meeting itself (it has no session), so its "Start
// Meeting" button navigates the main window — which holds the logged-in
// session — here. We create a fresh meeting with a generic title and redirect
// straight into it; the user presses Record when they're ready.
//
// GET (not POST) on purpose: a plain window navigation triggers it. The
// trade-off is that re-visiting this URL creates another meeting — acceptable
// for a one-shot launch target that's only reached via the popup.
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in — bounce to login, then on to meetings.
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/meetings", req.url));
  }

  const { data, error } = await supabase
    .from("meetings")
    .insert({ user_id: user.id, title: "New meeting" })
    .select("id")
    .single();

  // On failure, fall back to the meetings list rather than a dead end.
  if (error || !data) {
    return NextResponse.redirect(new URL("/meetings", req.url));
  }

  // `?record=1` tells the Recorder to start capturing immediately on arrival.
  return NextResponse.redirect(new URL(`/meetings/${data.id}?record=1`, req.url));
}
