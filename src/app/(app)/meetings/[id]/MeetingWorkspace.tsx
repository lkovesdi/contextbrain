"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronUp, Mic, Plus, Square, Zap } from "lucide-react";
import {
  ContextSelector,
  type Selection,
} from "@/components/context/ContextSelector";
import { AssistantMarkdown } from "@/components/chat/AssistantMarkdown";
import type { Provider } from "@/lib/composio";
import type { ChipData } from "@/components/context/ContextChip";
import type { Tag } from "@/lib/tags";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Popover } from "@/components/ui/Popover";
import { Eyebrow } from "@/components/ui/typography";
import { MiniWaveform } from "@/components/recording/MiniWaveform";
import {
  useRecording,
  type StoredLine,
} from "@/components/recording/RecordingProvider";
import { apiErrorText } from "@/lib/utils";
import SendIcon from "@/components/icons/SendIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { TranscriptTicker } from "./TranscriptTicker";
import { NoteComposer, NoteRow, type Note } from "./Notes";
import { MeetingTags } from "./MeetingTags";

type Msg = { role: "user" | "assistant"; content: string };

type PresetSources = {
  external_context_ids?: string[];
  note_ids?: string[];
  space_id?: string | null;
  recent_summary_count?: number;
  integrations?: Partial<Record<Provider, unknown>>;
} | null;

function defaultSelection(
  chips: ChipData[],
  integrations: string[],
  preset: PresetSources,
  tagIds: string[]
): Selection {
  if (!preset) {
    return {
      include_notes: false,
      external_context_ids: [],
      note_ids: [],
      space_id: null,
      tag_ids: tagIds,
      recent_summary_count: 3,
      integrations: [],
    };
  }
  const validExternal = new Set(chips.map((c) => c.id));
  const validIntegrations = new Set(integrations);
  return {
    include_notes: false,
    external_context_ids: (preset.external_context_ids ?? []).filter((id) =>
      validExternal.has(id)
    ),
    note_ids: preset.note_ids ?? [],
    space_id: preset.space_id ?? null,
    tag_ids: tagIds,
    recent_summary_count: preset.recent_summary_count ?? 3,
    integrations: Object.keys(preset.integrations ?? {})
      .filter((p): p is Provider => validIntegrations.has(p))
      .map((provider) => ({ provider })),
  };
}

export type PinnedImage = {
  url: string;
  alt: string | null;
  label: string | null;
};

// The condensed active-meeting view: one column where the live transcript
// runs in a fading strip across the top (~15%), the chat owns the rest, notes
// land Granola-style above the message stream, and the recorder collapses to
// a pill next to the "Ask anything" bar at the bottom.
export function MeetingWorkspace({
  meetingId,
  title,
  mode = "standard",
  initialSummaryStatus = null,
  initialLines,
  initialSpeakerNames = {},
  initialNotes,
  chips,
  integrations,
  githubConnected,
  presetSources,
  presetName,
  tags = [],
  initialPinnedImages = [],
  summarySlot = null,
}: {
  meetingId: string;
  title: string;
  // 'prd' meetings run the scout + PRD pipeline on stop — longer, different copy.
  mode?: string;
  // meetings.summary_status at render time — 'generating' means a server-side
  // run is already in flight (e.g. the user left mid-generation and came back).
  initialSummaryStatus?: string | null;
  initialLines: StoredLine[];
  initialSpeakerNames?: Record<string, string>;
  initialNotes: Note[];
  chips: ChipData[];
  integrations: string[];
  githubConnected: boolean;
  presetSources: PresetSources;
  presetName?: string | null;
  tags?: Tag[];
  initialPinnedImages?: PinnedImage[];
  // Server-rendered summary/PRD sections, shown at the top of the stream when
  // the meeting already has them.
  summarySlot?: React.ReactNode;
}) {
  const { session, error: micError, levelRef, start, stop } = useRecording();
  const recording = session?.meetingId === meetingId;
  const recordingElsewhere = !!session && session.meetingId !== meetingId;
  const router = useRouter();

  // ── Recorder controls ────────────────────────────────────────────────────
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

  // ── Notes ────────────────────────────────────────────────────────────────
  // Notes interleave with the chat in the order things happened: each note
  // remembers how many chat messages existed when it was created (its
  // "anchor") and renders right after that many messages. Notes from before
  // this session (no anchor entry) group at the top of the stream.
  const [noteInputOpen, setNoteInputOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [noteAnchors, setNoteAnchors] = useState<Record<string, number>>({});
  const messagesLenRef = useRef(0);

  async function addNote(content: string) {
    const anchor = messagesLenRef.current;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, meeting_id: meetingId }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as Note;
    setNotes((prev) => [...prev, created]);
    setNoteAnchors((prev) => ({ ...prev, [created.id]: anchor }));
  }

  async function toggleCheck(n: Note) {
    setNotes((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, is_checked: !x.is_checked } : x))
    );
    await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_checked: !n.is_checked }),
    });
  }

  async function editNote(n: Note, content: string) {
    setNotes((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, content } : x))
    );
    await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }

  async function deleteNote(n: Note) {
    setNotes((prev) => prev.filter((x) => x.id !== n.id));
    await fetch(`/api/notes/${n.id}`, { method: "DELETE" });
  }

  // Drag-to-reorder: while a note is grabbed, drop slots appear between notes
  // and at every message boundary. Dropping re-anchors the note and reorders
  // the array (array order is the within-group order).
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);

  function moveNote(noteId: string, anchor: number, pos: number) {
    const clampedAnchorOf = (id: string) =>
      Math.min(noteAnchors[id] ?? 0, messages.length);
    setNotes((prev) => {
      const dragged = prev.find((n) => n.id === noteId);
      if (!dragged) return prev;
      // `pos` was measured against the rendered group, which still includes
      // the dragged note when moving within its own group — shift it down.
      const prevGroup = prev.filter((n) => clampedAnchorOf(n.id) === anchor);
      const oldPos = prevGroup.findIndex((n) => n.id === noteId);
      const effPos = oldPos !== -1 && pos > oldPos ? pos - 1 : pos;
      const rest = prev.filter((n) => n.id !== noteId);
      const members = rest.filter((n) => clampedAnchorOf(n.id) === anchor);
      const insertAt =
        effPos >= members.length
          ? members.length > 0
            ? rest.indexOf(members[members.length - 1]) + 1
            : rest.length
          : rest.indexOf(members[effPos]);
      const next = [...rest];
      next.splice(insertAt, 0, dragged);
      return next;
    });
    setNoteAnchors((prev) => ({ ...prev, [noteId]: anchor }));
  }

  // ── Chat ─────────────────────────────────────────────────────────────────
  const [selection, setSelection] = useState<Selection>(() =>
    defaultSelection(chips, integrations, presetSources, tags.map((t) => t.id))
  );
  const [pinnedUrls, setPinnedUrls] = useState<Set<string>>(
    () => new Set(initialPinnedImages.map((p) => p.url))
  );

  // Toggle a pin optimistically; rollback on server error.
  async function togglePin(url: string, alt: string, label: string) {
    const wasPinned = pinnedUrls.has(url);
    setPinnedUrls((prev) => {
      const next = new Set(prev);
      if (wasPinned) next.delete(url);
      else next.add(url);
      return next;
    });
    try {
      const res = await fetch(`/api/meetings/${meetingId}/pin-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, alt, label, action: "toggle" }),
      });
      if (!res.ok) throw new Error(`pin failed (${res.status})`);
    } catch (e) {
      console.error("pin-image failed, rolling back:", e);
      setPinnedUrls((prev) => {
        const next = new Set(prev);
        if (wasPinned) next.add(url);
        else next.delete(url);
        return next;
      });
    }
  }

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sendIconRef = useRef<AnimatedIconHandle | null>(null);

  // Cmd+K focuses the chat input (PRD §12 polish)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    messagesLenRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  // Read a text stream into the trailing (empty) assistant message.
  async function consume(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: acc };
        return copy;
      });
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    setInput("");
    setChatError(null);
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setStreaming(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          selection,
          meeting_id: meetingId,
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        setChatError(apiErrorText(res.status, errText, "Chat failed"));
        setMessages((m) => m.slice(0, -1));
        return;
      }
      await consume(res);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Chat failed");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  // Quick recap: 4–5 catch-up bullets for the whole meeting, then a one-paragraph
  // recap of the last ~5 minutes. Grounded in the live transcript server-side.
  async function catchUp() {
    if (streaming) return;
    setChatError(null);
    setMessages((m) => [
      ...m,
      { role: "user", content: "Catch me up" },
      { role: "assistant", content: "" },
    ]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/meetings/${meetingId}/catch-up`, {
        method: "POST",
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        setChatError(apiErrorText(res.status, errText, "Catch-up failed"));
        setMessages((m) => m.slice(0, -1));
        return;
      }
      await consume(res);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Catch-up failed");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  // Input-device picker shared by the idle and recording recorder clusters.
  const devicePicker = (
    <Popover
      align="start"
      side="top"
      width={300}
      trigger={
        <button
          type="button"
          aria-label="Choose input device"
          title="Input device"
          className="grid h-[26px] w-[22px] cursor-pointer place-content-center rounded-[6px] border-0 bg-transparent text-slate-2 transition-colors hover:text-ink"
        >
          <ChevronUp size={14} strokeWidth={1.7} />
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <Eyebrow className="text-[10px]">Input device</Eyebrow>
        <Select
          size="sm"
          aria-label="Input device"
          fullWidth
          className="font-mono text-[11px]"
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
        {recording && (
          <p className="m-0 text-[11px] leading-[1.4] text-slate-2">
            Stop recording to switch inputs.
          </p>
        )}
      </div>
    </Popover>
  );

  return (
    <>
      {/* Tags row — context + add-note live on its right edge */}
      <div className="flex items-center gap-[10px] border-b border-mist bg-bone-2 px-[22px] py-[8px]">
        <Eyebrow className="flex-shrink-0">Tags</Eyebrow>
        <div className="min-w-0 flex-1">
          <MeetingTags meetingId={meetingId} initialTags={tags} />
        </div>
        <ContextSelector
          compact
          align="end"
          selection={selection}
          setSelection={setSelection}
          chips={chips}
          integrations={integrations}
          githubConnected={githubConnected}
          presetName={presetName ?? null}
          tags={tags}
        />
        <Button
          variant="icon"
          size="sm"
          aria-label="Add note"
          title="Add note"
          onClick={() => setNoteInputOpen(true)}
        >
          <Plus size={16} strokeWidth={1.7} />
        </Button>
      </div>

      {/* Live transcript strip (~15%), older lines fading toward the top */}
      <div className="flex-[0_0_15%] min-h-[104px] border-b border-mist bg-bone-2">
        <TranscriptTicker
          meetingId={meetingId}
          initialLines={initialLines}
          initialSpeakerNames={initialSpeakerNames}
        />
      </div>

      {/* The stream: summary/PRD (when present) → notes + chat interleaved in
          the order they happened. A note's anchor can exceed the message count
          after an error rollback — the clamp folds those to the end. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
        <div className="mx-auto flex max-w-[820px] flex-col gap-[18px]">
          {summarySlot}
          {(() => {
            const groups = new Map<number, Note[]>();
            for (const n of notes) {
              const idx = Math.min(noteAnchors[n.id] ?? 0, messages.length);
              const arr = groups.get(idx);
              if (arr) arr.push(n);
              else groups.set(idx, [n]);
            }
            const notesAt = (idx: number) => {
              const group = groups.get(idx);
              if (!group) {
                // Boundary with no notes — still a valid drop target while
                // dragging, so a note can move between any two messages.
                return draggingNoteId ? (
                  <DropZone
                    onDropNote={() => moveNote(draggingNoteId, idx, 0)}
                  />
                ) : null;
              }
              return (
                <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
                  {group.map((n, k) => (
                    <Fragment key={n.id}>
                      {draggingNoteId && (
                        <li className="contents">
                          <DropZone
                            inGroup
                            onDropNote={() => moveNote(draggingNoteId, idx, k)}
                          />
                        </li>
                      )}
                      <NoteRow
                        note={n}
                        onToggle={() => toggleCheck(n)}
                        onEdit={(content) => editNote(n, content)}
                        onDelete={() => deleteNote(n)}
                        dragging={draggingNoteId === n.id}
                        onDragStart={() => setDraggingNoteId(n.id)}
                        onDragEnd={() => setDraggingNoteId(null)}
                      />
                    </Fragment>
                  ))}
                  {draggingNoteId && (
                    <li className="contents">
                      <DropZone
                        inGroup
                        onDropNote={() =>
                          moveNote(draggingNoteId, idx, group.length)
                        }
                      />
                    </li>
                  )}
                </ul>
              );
            };
            return (
              <>
                {notesAt(0)}
                {messages.length === 0 && (
                  <p className="m-0 text-[13px] text-slate">
                    Ask anything about this meeting, your notes, or the selected
                    sources.
                  </p>
                )}
                {messages.map((m, i) => (
                  <Fragment key={i}>
                    <ChatMsg
                      msg={m}
                      streaming={streaming && i === messages.length - 1}
                      pinnedUrls={pinnedUrls}
                      onTogglePin={togglePin}
                    />
                    {notesAt(i + 1)}
                  </Fragment>
                ))}
              </>
            );
          })()}
          {noteInputOpen && (
            <NoteComposer
              onAdd={addNote}
              onClose={() => setNoteInputOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Status banners, kept just above the composer */}
      {(micError || chatError || summaryState !== "idle") && (
        <div className="flex flex-col gap-2 px-[22px] pt-[10px]">
          <div className="mx-auto flex w-full max-w-[820px] flex-col gap-2">
            {micError && (
              <p className="m-0 rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
                {micError}
              </p>
            )}
            {summaryState === "generating" && (
              <p className="m-0 flex items-center gap-2 rounded-[6px] border border-mist bg-bone-2 px-3 py-2 text-[12.5px] text-slate-2">
                <span className="h-[6px] w-[6px] rounded-full bg-cortex [animation:mb-pulse_1.4s_infinite]" />
                {mode === "prd"
                  ? "Writing the PRD — scouting your repos and drafting both renditions. Usually 2-3 minutes; you can leave, it finishes on its own."
                  : "Generating summary with Claude Opus — this can take 30-60 seconds. You can leave; it finishes on its own."}
              </p>
            )}
            {summaryState === "error" && (
              <p className="m-0 rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12.5px] text-pulse-ink">
                {summaryErrorMsg ||
                  "Summary failed. You can retry later from this page."}
              </p>
            )}
            {chatError && (
              <p className="m-0 rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12px] text-pulse-ink">
                {chatError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Composer bar: recorder pill · Ask anything · catch up · send */}
      <div className="flex items-center gap-[10px] px-[22px] py-[12px]">
        <div className="mx-auto flex w-full max-w-[820px] items-center gap-[10px]">
          {recording ? (
            <div className="flex flex-shrink-0 items-center gap-[6px] rounded-full border border-mist bg-bone-2 py-[5px] pl-[14px] pr-[6px]">
              <MiniWaveform active levelRef={levelRef} barClassName="bg-cortex" />
              {devicePicker}
              <Button
                variant="danger"
                size="sm"
                aria-label="Stop recording"
                title="Stop recording"
                onClick={handleStop}
                className="rounded-full !px-[8px]"
              >
                <Square size={11} strokeWidth={0} fill="currentColor" />
              </Button>
            </div>
          ) : recordingElsewhere ? (
            <p className="m-0 flex flex-shrink-0 items-center gap-2 rounded-full border border-mist bg-bone-2 px-3 py-[7px] text-[12px] text-slate-2">
              <span className="h-[6px] w-[6px] rounded-full bg-pulse [animation:mb-pulse_1.4s_infinite]" />
              <Link
                href={`/meetings/${session!.meetingId}`}
                className="cursor-pointer text-cortex-ink underline underline-offset-2"
              >
                Recording another meeting
              </Link>
            </p>
          ) : (
            <div className="flex flex-shrink-0 items-center gap-[2px]">
              <Button
                variant="ink"
                size="md"
                onClick={handleStart}
                aria-label="Start recording"
                title="Start recording"
                leftIcon={<Mic size={14} strokeWidth={1.6} />}
                className="rounded-full"
              >
                Record
              </Button>
              {devicePicker}
            </div>
          )}

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask anything… (⌘K)"
            className="min-w-0 flex-1 resize-none rounded-[18px] border border-mist bg-bone-2 px-[16px] py-[9px] text-[13.5px] leading-[1.5] text-ink outline-none transition-colors focus:border-mist-2"
          />
          <Button
            variant="secondary"
            size="md"
            onClick={catchUp}
            disabled={streaming}
            title="Catch me up"
            aria-label="Catch me up"
            className="flex-shrink-0 rounded-full"
            leftIcon={<Zap size={13} strokeWidth={1.7} />}
          >
            <span className="hidden sm:inline">Catch me up</span>
          </Button>
          <Button
            variant="primary"
            onClick={send}
            disabled={streaming || !input.trim()}
            className="flex-shrink-0 rounded-full"
            onMouseEnter={() => sendIconRef.current?.startAnimation()}
            onMouseLeave={() => sendIconRef.current?.stopAnimation()}
            rightIcon={<SendIcon ref={sendIconRef} size={14} strokeWidth={1.6} />}
          >
            {streaming ? "…" : "Send"}
          </Button>
        </div>
      </div>
    </>
  );
}

// A drop slot rendered only while a note is being dragged. Sized so its box
// plus the flex gaps it introduces net out to zero — mounting the zones
// doesn't shift the stream. Shows an accent line while hovered with a drag.
function DropZone({
  inGroup = false,
  onDropNote,
}: {
  /** Inside a note group (6px gaps) vs. between stream items (18px gaps). */
  inGroup?: boolean;
  onDropNote: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropNote();
      }}
      className={[
        "relative z-10 flex items-center",
        inGroup ? "h-[14px] my-[-10px]" : "h-[22px] my-[-20px]",
      ].join(" ")}
    >
      {/* Every slot shows a dashed guide while a note is in flight; the one
          under the cursor swaps to a solid accent line with an end dot. */}
      <div className="flex w-full items-center gap-[4px]">
        <span
          className={[
            "flex-shrink-0 rounded-full transition-all",
            over ? "h-[7px] w-[7px] bg-cortex" : "h-[5px] w-[5px] bg-mist-2",
          ].join(" ")}
        />
        {over ? (
          <span className="h-[3px] flex-1 rounded-full bg-cortex" />
        ) : (
          <span className="h-0 flex-1 border-t-[2px] border-dashed border-mist-2" />
        )}
      </div>
    </div>
  );
}

function ChatMsg({
  msg,
  streaming,
  pinnedUrls,
  onTogglePin,
}: {
  msg: Msg;
  streaming: boolean;
  pinnedUrls: Set<string>;
  onTogglePin: (url: string, alt: string, label: string) => void;
}) {
  const isUser = msg.role === "user";
  const role = isUser ? "You" : "ContextBrain";
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
        <span
          className={[
            "w-[14px] h-[14px] rounded-full grid place-content-center text-[9px]",
            isUser ? "bg-paper-2 text-ink" : "bg-cortex text-on-accent",
          ].join(" ")}
        >
          {isUser ? "Y" : "●"}
        </span>
        {role}
      </div>
      <div className="text-[14px] leading-[1.6] text-ink">
        {isUser ? (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        ) : (
          <AssistantMarkdown
            content={msg.content}
            pinnedUrls={pinnedUrls}
            onTogglePin={onTogglePin}
          />
        )}
        {!msg.content && streaming && "…"}
        {streaming && msg.content && (
          <span className="ml-[3px] inline-block h-[14px] w-[7px] bg-cortex align-[-3px] [animation:mb-blink_1s_steps(2)_infinite]" />
        )}
      </div>
    </div>
  );
}
