"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Popover } from "@/components/ui/Popover";
import { Input } from "@/components/ui/Input";
import { LocalTime } from "@/components/ui/LocalTime";
import { MiniWaveform } from "@/components/recording/MiniWaveform";
import {
  useRecording,
  type StoredLine,
} from "@/components/recording/RecordingProvider";
import { apiErrorText } from "@/lib/utils";

type SpeakerNames = Record<string, string>;

const SPEAKER_COLOR = ["text-cortex-ink", "text-echo-ink", "text-amber-ink"];
function speakerIndex(speaker: string | null): number {
  if (!speaker) return 0;
  const m = speaker.match(/\d+/);
  return m ? parseInt(m[0], 10) % 3 : 0;
}

// A transcript speaker label that opens a rename popover on click. The raw
// diarization label ("Speaker 0", "Unknown") is the stable key; `displayName`
// is the resolved name (or the raw label when no override exists).
function SpeakerLabel({
  rawKey,
  displayName,
  colorClass,
  onSave,
}: {
  rawKey: string;
  displayName: string;
  colorClass: string;
  onSave: (rawKey: string, value: string) => void;
}) {
  const named = displayName !== rawKey;
  return (
    <Popover
      align="start"
      width={224}
      trigger={
        <button
          type="button"
          title="Rename speaker"
          className={[
            "cursor-pointer break-words text-right font-mono text-[11px] uppercase tracking-[0.06em] decoration-dotted underline-offset-2 hover:underline",
            colorClass,
          ].join(" ")}
        >
          {displayName}
        </button>
      }
    >
      {(close) => (
        <RenameSpeakerForm
          rawKey={rawKey}
          initial={named ? displayName : ""}
          onSave={(value) => {
            onSave(rawKey, value);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function RenameSpeakerForm({
  rawKey,
  initial,
  onSave,
}: {
  rawKey: string;
  initial: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2">
        Rename {rawKey}
      </p>
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="e.g. Laszlo"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave(draft.trim());
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onSave(draft.trim())}>
          Save
        </Button>
        {initial && (
          <Button size="sm" variant="ghost" onClick={() => onSave("")}>
            Clear
          </Button>
        )}
      </div>
      <p className="m-0 text-[11px] leading-[1.4] text-slate-2">
        Applies to every “{rawKey}” line in this meeting.
      </p>
    </div>
  );
}

export function Recorder({
  meetingId,
  title,
  initialLines,
  initialSpeakerNames = {},
  initialSummaryStatus = null,
  mode = "standard",
}: {
  meetingId: string;
  title: string;
  initialLines: StoredLine[];
  initialSpeakerNames?: SpeakerNames;
  // meetings.summary_status at render time — 'generating' means a server-side
  // run is already in flight (e.g. the user left mid-generation and came back).
  initialSummaryStatus?: string | null;
  // 'prd' meetings run the scout + PRD pipeline on stop — longer, different copy.
  mode?: string;
}) {
  const { session, error, levelRef, start, stop, subscribeLines } = useRecording();
  const recording = session?.meetingId === meetingId;
  const recordingElsewhere = !!session && session.meetingId !== meetingId;

  const [stored, setStored] = useState<StoredLine[]>(initialLines);
  // Per-meeting overrides mapping a raw diarization label ("Speaker 0",
  // "Unknown") to a name the user attached. Applied at display time so the
  // raw labels stay intact and new live lines pick up the name automatically.
  const [speakerNames, setSpeakerNames] = useState<SpeakerNames>(initialSpeakerNames);

  function displaySpeaker(raw: string | null): string {
    const key = raw || "Unknown";
    return speakerNames[key] ?? key;
  }

  function saveSpeakerName(rawKey: string, value: string) {
    const next = { ...speakerNames };
    if (value) next[rawKey] = value;
    else delete next[rawKey];
    setSpeakerNames(next);
    fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker_names: next }),
    }).catch(() => {});
  }

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [summaryState, setSummaryState] = useState<"idle" | "generating" | "error">(
    initialSummaryStatus === "generating"
      ? "generating"
      : initialSummaryStatus === "error"
        ? "error"
        : "idle"
  );
  const [summaryErrorMsg, setSummaryErrorMsg] = useState<string | null>(null);
  const router = useRouter();
  const wellRef = useRef<HTMLDivElement | null>(null);

  // Live lines land in the provider (which owns the Deepgram connection and
  // keeps recording across navigation); this page just renders the ones for
  // its meeting. The re-check against `prev` mirrors the old in-component
  // belt-and-braces dedup.
  useEffect(() => {
    return subscribeLines((forMeeting, line) => {
      if (forMeeting !== meetingId) return;
      setStored((prev) => {
        if (prev.some((p) => p.id === line.id)) return prev;
        const cutoff = Date.now() - 5_000;
        const recentDup = prev
          .slice(-3)
          .some(
            (p) =>
              p.content === line.content &&
              p.speaker === line.speaker &&
              new Date(p.created_at).getTime() > cutoff
          );
        if (recentDup) return prev;
        return [...prev, line];
      });
    });
  }, [subscribeLines, meetingId]);

  useEffect(() => {
    if (wellRef.current) wellRef.current.scrollTop = wellRef.current.scrollHeight;
  }, [stored]);

  // Resizable transcript well — default fits roughly 4 transcript lines.
  // Drag the handle ABOVE the well to grow/shrink. Persisted per-user.
  const TRANSCRIPT_HEIGHT_KEY = "mb_transcript_well_height";
  const TRANSCRIPT_DEFAULT_HEIGHT = 280;
  const TRANSCRIPT_MIN_HEIGHT = 120;
  const TRANSCRIPT_MAX_HEIGHT = 1400;
  const [transcriptHeight, setTranscriptHeight] = useState<number>(
    TRANSCRIPT_DEFAULT_HEIGHT
  );
  const transcriptHeightRef = useRef(transcriptHeight);
  useEffect(() => {
    transcriptHeightRef.current = transcriptHeight;
  }, [transcriptHeight]);
  useEffect(() => {
    queueMicrotask(() => {
      if (typeof window === "undefined") return;
      const saved = window.localStorage.getItem(TRANSCRIPT_HEIGHT_KEY);
      if (!saved) return;
      const n = parseInt(saved, 10);
      if (
        Number.isFinite(n) &&
        n >= TRANSCRIPT_MIN_HEIGHT &&
        n <= TRANSCRIPT_MAX_HEIGHT
      ) {
        setTranscriptHeight(n);
      }
    });
  }, []);

  function startTranscriptResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = transcriptHeight;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: MouseEvent) {
      // Pull DOWN on the handle (which sits above the well) → grow the well.
      const next = Math.max(
        TRANSCRIPT_MIN_HEIGHT,
        Math.min(TRANSCRIPT_MAX_HEIGHT, startH + (ev.clientY - startY))
      );
      setTranscriptHeight(next);
    }
    function onUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        window.localStorage.setItem(
          TRANSCRIPT_HEIGHT_KEY,
          String(transcriptHeightRef.current)
        );
      } catch {
        // localStorage can throw in private mode — non-fatal.
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Restore last-chosen device + load the device list. Labels are blank until
  // the user has granted mic permission at least once; we re-enumerate after
  // recording starts to pick those up.
  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? localStorage.getItem("mb_audio_input_device") ?? ""
        : "";
    // Hydration-safe: the initial render uses the default empty string so SSR
    // and the first client render agree, then we overwrite once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceId(saved);

    async function refresh() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    }
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  function chooseDevice(id: string) {
    setDeviceId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("mb_audio_input_device", id);
    }
  }

  async function handleStart() {
    try {
      await start({ meetingId, title, deviceId: deviceId || undefined });
      // Permission may have been granted just now — re-enumerate so labels
      // (blank pre-permission) populate the picker.
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.kind === "audioinput")))
        .catch(() => {});
    } catch {
      // start() already surfaced the error via the provider.
    }
  }

  function handleStop() {
    setSummaryState("generating");
    setSummaryErrorMsg(null);
    stop()
      .then(async (res) => {
        // 202 = generation started server-side; the poll effect below picks
        // up the outcome. Anything else is an immediate failure — surface the
        // server's message (notably the 402 out-of-credits one).
        if (res && !res.ok) {
          const body = await res.text().catch(() => "");
          setSummaryErrorMsg(apiErrorText(res.status, body, ""));
          setSummaryState("error");
        }
      })
      .catch(() => setSummaryState("error"));
  }

  // While a server-side generation is in flight, poll for the outcome; when
  // the summary lands, refresh so the page swaps to the summary view.
  useEffect(() => {
    if (summaryState !== "generating") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/summary`);
        if (!res.ok) return;
        const j = await res.json();
        if (j.status === "error") {
          setSummaryState("error");
        } else if (!j.status && j.hasSummary) {
          setSummaryState("idle");
          router.refresh();
        }
      } catch {
        // transient network failure — keep polling
      }
    }, 4000);
    return () => clearInterval(t);
  }, [summaryState, meetingId, router]);

  // Auto-start recording when we arrive from the desktop "Meeting Detected"
  // popup — the quick-start route redirects here with `?record=1`. Runs once,
  // and strips the flag so a refresh doesn't kick off another recording.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("record") !== "1") return;
    autoStartedRef.current = true;
    window.history.replaceState(null, "", `/meetings/${meetingId}`);
    // Defer out of the effect body so the synchronous setState inside start()
    // doesn't trip the cascading-render rule, and the page can paint first.
    queueMicrotask(() => void handleStart());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate">
        {recording ? (
          <Button
            variant="danger"
            size="md"
            onClick={handleStop}
            aria-label="Stop recording"
            title="Stop recording"
            leftIcon={<Square size={12} strokeWidth={0} fill="currentColor" />}
            rightIcon={<MiniWaveform active levelRef={levelRef} />}
          >
            Stop
          </Button>
        ) : recordingElsewhere ? (
          <p className="m-0 flex items-center gap-2 rounded-[6px] border border-mist bg-bone-2 px-3 py-2 text-[12px] text-slate-2">
            <span className="w-[6px] h-[6px] rounded-full bg-pulse [animation:mb-pulse_1.4s_infinite]" />
            Recording another meeting —{" "}
            <Link
              href={`/meetings/${session!.meetingId}?continue=1`}
              className="cursor-pointer text-cortex-ink underline underline-offset-2"
            >
              go to it
            </Link>
          </p>
        ) : (
          <Button
            variant="ink"
            size="md"
            onClick={handleStart}
            aria-label="Start recording"
            title="Start recording"
            leftIcon={<Mic size={14} strokeWidth={1.6} />}
          >
            Record
          </Button>
        )}

        <label className="flex items-center gap-2">
          <span className="uppercase tracking-[0.06em]">Input</span>
          <Select
            size="sm"
            aria-label="Input device"
            className="font-mono text-[11px] max-w-[280px]"
            value={deviceId}
            onChange={chooseDevice}
            disabled={recording}
            options={[
              { value: "", label: "System default" },
              ...devices.map((d, i) => ({
                value: d.deviceId,
                label:
                  d.label || `Microphone ${i + 1} (grant permission to see name)`,
              })),
            ]}
          />
        </label>
      </div>

      {error && (
        <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
          {error}
        </p>
      )}

      {summaryState === "generating" && (
        <p className="rounded-[6px] border border-mist bg-bone-2 px-3 py-2 text-[12.5px] text-slate-2 flex items-center gap-2">
          <span className="w-[6px] h-[6px] rounded-full bg-cortex [animation:mb-pulse_1.4s_infinite]" />
          {mode === "prd"
            ? "Writing the PRD — scouting your repos and drafting both renditions. Usually 2-3 minutes; you can leave, it finishes on its own."
            : "Generating summary with Claude Opus — this can take 30-60 seconds. You can leave; it finishes on its own."}
        </p>
      )}
      {summaryState === "error" && (
        <p className="rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
          {summaryErrorMsg || "Summary failed. You can retry later from this page."}
        </p>
      )}

      <div
        ref={wellRef}
        style={{ height: transcriptHeight }}
        className="bg-bone-2 border border-mist rounded-[10px] px-[18px] py-[14px] flex flex-col gap-3 overflow-y-auto"
      >
        {stored.length === 0 ? (
          <p className="text-[13px] text-slate m-0">
            Transcript will appear here once recording starts.
          </p>
        ) : (
          (() => {
            const VISIBLE = 10;
            const older = stored.length > VISIBLE ? stored.slice(0, -VISIBLE) : [];
            const recent = stored.slice(-VISIBLE);
            const renderLine = (l: StoredLine) => {
              const idx = speakerIndex(l.speaker);
              return (
                <div
                  key={l.id}
                  className="grid items-baseline gap-[14px]"
                  style={{ gridTemplateColumns: "74px 1fr" }}
                >
                  <div className="flex justify-end pt-[3px]">
                    <SpeakerLabel
                      rawKey={l.speaker || "Unknown"}
                      displayName={displaySpeaker(l.speaker)}
                      colorClass={SPEAKER_COLOR[idx]}
                      onSave={saveSpeakerName}
                    />
                  </div>
                  <div className="text-[14px] leading-[1.55] text-ink">
                    <LocalTime
                      className="font-mono text-[10.5px] text-slate-3 mr-2"
                      date={l.created_at}
                      format={(d) =>
                        d.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        })
                      }
                    />
                    {l.content}
                  </div>
                </div>
              );
            };
            return (
              <>
                {older.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer select-none list-none font-mono text-[10.5px] uppercase tracking-[0.07em] text-slate-2 hover:text-ink py-1">
                      <span className="group-open:hidden">
                        Show {older.length} earlier line{older.length === 1 ? "" : "s"} ↓
                      </span>
                      <span className="hidden group-open:inline">
                        Hide earlier lines ↑
                      </span>
                    </summary>
                    <div className="flex flex-col gap-3 pt-2 pb-1 opacity-80">
                      {older.map(renderLine)}
                    </div>
                  </details>
                )}
                {recent.map(renderLine)}
              </>
            );
          })()
        )}
      </div>

      {/* Drag down to grow the transcript, up to shrink. Persists per-user. */}
      <div
        onMouseDown={startTranscriptResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize transcript"
        className="group h-[8px] -mt-[2px] cursor-ns-resize flex items-center justify-center"
      >
        <div className="h-[3px] w-[36px] rounded-full bg-mist-2 group-hover:bg-cortex transition-colors" />
      </div>
    </div>
  );
}
