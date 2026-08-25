"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { Input } from "@/components/ui/Input";
import { LocalTime } from "@/components/ui/LocalTime";
import {
  useRecording,
  type StoredLine,
} from "@/components/recording/RecordingProvider";

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

// The live transcript strip at the top of the condensed meeting view. Pinned
// to the newest lines; older ones fade out toward the top edge (and remain
// reachable by scrolling up).
export function TranscriptTicker({
  meetingId,
  initialLines,
  initialSpeakerNames = {},
}: {
  meetingId: string;
  initialLines: StoredLine[];
  initialSpeakerNames?: SpeakerNames;
}) {
  const { subscribeLines } = useRecording();
  const [stored, setStored] = useState<StoredLine[]>(initialLines);
  // Per-meeting overrides mapping a raw diarization label ("Speaker 0",
  // "Unknown") to a name the user attached. Applied at display time so the
  // raw labels stay intact and new live lines pick up the name automatically.
  const [speakerNames, setSpeakerNames] = useState<SpeakerNames>(initialSpeakerNames);
  const wellRef = useRef<HTMLDivElement | null>(null);

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

  // Live lines land in the provider (which owns the Deepgram connection and
  // keeps recording across navigation); this strip just renders the ones for
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

  return (
    <div
      ref={wellRef}
      className="h-full overflow-y-auto px-[22px] py-[10px] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,black_44px)] [mask-image:linear-gradient(to_bottom,transparent_0px,black_44px)]"
    >
      <div className="mx-auto flex max-w-[820px] flex-col gap-[7px]">
        {stored.length === 0 ? (
          <p className="m-0 pt-[24px] text-[12.5px] text-slate">
            Transcript will appear here once recording starts.
          </p>
        ) : (
          stored.map((l) => {
            const idx = speakerIndex(l.speaker);
            return (
              <div
                key={l.id}
                className="grid items-baseline gap-[12px]"
                style={{ gridTemplateColumns: "74px 1fr" }}
              >
                <div className="flex justify-end pt-[2px]">
                  <SpeakerLabel
                    rawKey={l.speaker || "Unknown"}
                    displayName={displaySpeaker(l.speaker)}
                    colorClass={SPEAKER_COLOR[idx]}
                    onSave={saveSpeakerName}
                  />
                </div>
                <div className="text-[13px] leading-[1.5] text-ink-2">
                  <LocalTime
                    className="mr-2 font-mono text-[10px] text-slate-3"
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
          })
        )}
      </div>
    </div>
  );
}
