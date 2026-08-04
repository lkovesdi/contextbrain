"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Square } from "lucide-react";
import { MiniWaveform } from "./MiniWaveform";
import { useRecording } from "./RecordingProvider";

function formatElapsed(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Floating "recording continues" pill, shown on every route except the
// meeting being recorded (that page has its own controls). Clicking the body
// returns to the meeting; Stop ends it from anywhere.
export function RecordingPill() {
  const { session, levelRef, stop } = useRecording();
  const pathname = usePathname();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  if (!session || pathname === `/meetings/${session.meetingId}`) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-full bg-[#16171d] pl-4 pr-2 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] border border-[rgba(255,255,255,0.1)]"
      role="status"
      aria-label="Recording in progress"
    >
      <button
        type="button"
        onClick={() => router.push(`/meetings/${session.meetingId}?continue=1`)}
        title="Back to this meeting"
        className="cursor-pointer flex items-center gap-3 min-w-0"
      >
        <span className="relative flex h-[8px] w-[8px] flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-pulse opacity-60 [animation:mb-pulse_1.4s_infinite]" />
          <span className="relative inline-flex h-[8px] w-[8px] rounded-full bg-pulse" />
        </span>
        <MiniWaveform active levelRef={levelRef} barClassName="bg-white/80" />
        <span className="font-mono text-[11px] tabular-nums text-white/70">
          {formatElapsed(session.startedAt, now)}
        </span>
        <span className="max-w-[180px] truncate text-[12.5px] text-white/90">
          {session.title}
        </span>
      </button>
      <button
        type="button"
        onClick={() => void stop()}
        aria-label="Stop recording"
        title="Stop recording"
        className="cursor-pointer flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full bg-pulse/90 text-white transition-colors duration-[120ms] hover:bg-pulse"
      >
        <Square size={10} strokeWidth={0} fill="currentColor" />
      </button>
    </div>
  );
}
