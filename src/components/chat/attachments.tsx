"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { Camera, CircleStop, ImagePlus, Video, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import {
  MAX_ATTACHMENTS,
  MAX_RECORDING_SECONDS,
  formatTimestamp,
  type ChatAttachment,
  type VideoAttachment,
} from "@/lib/chat-attachments";
import {
  canCaptureScreen,
  canRecordScreen,
  captureScreenshot,
  normalizeImage,
  startScreenRecording,
  type RecordingHandle,
} from "@/lib/screenshot";
import { extractAudioWav, extractFrames } from "@/lib/video-frames";

export type { ChatAttachment } from "@/lib/chat-attachments";
export { toRequestAttachments } from "@/lib/chat-attachments";

export type RecordingState =
  | { phase: "idle" }
  | { phase: "recording"; startedAt: number; source: "desktop" | "browser" }
  | { phase: "processing"; step: string };

// Composer-side state for attachments. One hook per chat surface; the
// surface owns the textarea and just spreads the handlers onto it (paste) and
// its wrapper (drag-drop), and renders <AttachmentTray> + <AttachControls>.
export function useChatAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingState>({ phase: "idle" });
  const handleRef = useRef<RecordingHandle | null>(null);

  const push = useCallback((fresh: ChatAttachment[]) => {
    setAttachments((prev) => {
      const merged = [...prev, ...fresh];
      if (merged.length > MAX_ATTACHMENTS) {
        setError(`Up to ${MAX_ATTACHMENTS} attachments per message.`);
        return merged.slice(0, MAX_ATTACHMENTS);
      }
      return merged;
    });
  }, []);

  const addBlobs = useCallback(
    async (blobs: Blob[]) => {
      const images = blobs.filter((b) => b.type.startsWith("image/"));
      if (!images.length) return;
      setBusy(true);
      setError(null);
      try {
        const fresh: ChatAttachment[] = [];
        for (const blob of images) {
          const img = await normalizeImage(blob);
          fresh.push({
            kind: "image",
            id: crypto.randomUUID(),
            mediaType: img.mediaType,
            url: img.url,
            data: img.data,
            width: img.width,
            height: img.height,
          });
        }
        push(fresh);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that image.");
      } finally {
        setBusy(false);
      }
    },
    [push]
  );

  const capture = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await captureScreenshot();
      if (blob) await addBlobs([blob]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Screenshot failed.");
    } finally {
      setBusy(false);
    }
  }, [addBlobs]);

  // Record → (user stops) → frames + narration transcript → one video
  // attachment. Transcription failing is not fatal: the frames still carry
  // the recording.
  const startRecording = useCallback(async () => {
    if (handleRef.current) return;
    setError(null);
    try {
      const handle = await startScreenRecording();
      handleRef.current = handle;
      setRecording({ phase: "recording", startedAt: Date.now(), source: handle.source });
      const blob = await handle.done;
      handleRef.current = null;
      if (!blob) return;

      setRecording({ phase: "processing", step: "Picking frames…" });
      const { frames, duration } = await extractFrames(blob);
      if (!frames.length) throw new Error("Couldn't read that recording.");

      let transcript: string | null = null;
      const wav = await extractAudioWav(blob).catch(() => null);
      if (wav) {
        setRecording({ phase: "processing", step: "Transcribing narration…" });
        try {
          const res = await fetch("/api/chat/transcribe", {
            method: "POST",
            headers: { "Content-Type": "audio/wav" },
            body: wav,
          });
          if (res.ok) {
            const json = (await res.json()) as { transcript?: string };
            transcript = json.transcript?.trim() || null;
          }
        } catch {
          transcript = null;
        }
      }

      const video: VideoAttachment = {
        kind: "video",
        id: crypto.randomUUID(),
        duration,
        transcript,
        frames: frames.map((f) => ({
          mediaType: f.image.mediaType,
          url: f.image.url,
          data: f.image.data,
          t: f.t,
        })),
      };
      push([video]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed.");
    } finally {
      handleRef.current = null;
      setRecording({ phase: "idle" });
    }
  }, [push]);

  const stopRecording = useCallback(() => {
    handleRef.current?.stop();
  }, []);

  const remove = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => {
    setAttachments([]);
    setError(null);
  }, []);

  // ⌘V with an image on the clipboard (⌘⇧⌃4 on macOS, Snipping Tool on
  // Windows) — the zero-install path that works in every browser.
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!files.length) return;
      e.preventDefault();
      void addBlobs(files);
    },
    [addBlobs]
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!files.length) return;
      e.preventDefault();
      void addBlobs(files);
    },
    [addBlobs]
  );

  const onDragOver = useCallback((e: DragEvent) => {
    if (Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === "file")) {
      e.preventDefault();
    }
  }, []);

  return {
    attachments,
    busy: busy || recording.phase === "processing",
    error,
    recording,
    capture,
    startRecording,
    stopRecording,
    addBlobs,
    remove,
    clear,
    onPaste,
    onDrop,
    onDragOver,
  };
}

const noopSubscribe = () => () => {};

// Screenshot / record / add-image buttons. Capture buttons are hidden where
// neither the desktop command nor getDisplayMedia exists (paste still works).
export function AttachControls({
  onCapture,
  onFiles,
  onRecord,
  onStopRecording,
  recording,
  busy,
  disabled,
  className = "",
}: {
  onCapture: () => void;
  onFiles: (files: File[]) => void;
  onRecord?: () => void;
  onStopRecording?: () => void;
  recording?: RecordingState;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Capture support is a client-only fact (Tauri bridge / getDisplayMedia);
  // render "no" on the server so hydration matches, then resolve on mount.
  const showCapture = useSyncExternalStore(noopSubscribe, canCaptureScreen, () => false);
  const showRecord =
    useSyncExternalStore(noopSubscribe, canRecordScreen, () => false) && !!onRecord;
  const phase = recording?.phase ?? "idle";

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) onFiles(files);
  }

  return (
    <>
      {showCapture && (
        <Button
          type="button"
          variant="icon"
          size="md"
          onClick={onCapture}
          disabled={disabled || busy || phase !== "idle"}
          title="Screenshot — pick a region or window"
          aria-label="Take a screenshot"
          className={cn("flex-shrink-0", className)}
        >
          <Camera size={14} strokeWidth={1.6} />
        </Button>
      )}
      {showRecord &&
        (phase === "recording" ? (
          <Button
            type="button"
            variant="icon"
            size="md"
            onClick={onStopRecording}
            title="Stop recording"
            aria-label="Stop recording"
            className={cn("flex-shrink-0 !border-pulse !text-pulse", className)}
          >
            <CircleStop size={14} strokeWidth={1.8} />
          </Button>
        ) : (
          <Button
            type="button"
            variant="icon"
            size="md"
            onClick={onRecord}
            disabled={disabled || busy || phase !== "idle"}
            title={`Record your screen (up to ${MAX_RECORDING_SECONDS}s) — narrate what you're showing`}
            aria-label="Record your screen"
            className={cn("flex-shrink-0", className)}
          >
            <Video size={14} strokeWidth={1.6} />
          </Button>
        ))}
      <Button
        type="button"
        variant="icon"
        size="md"
        onClick={() => fileRef.current?.click()}
        disabled={disabled || busy || phase !== "idle"}
        title="Add image (or paste / drop one)"
        aria-label="Add image"
        className={cn("flex-shrink-0", className)}
      >
        <ImagePlus size={14} strokeWidth={1.6} />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPick}
      />
    </>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return <>{formatTimestamp((now - since) / 1000)}</>;
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      title="Remove"
      className="absolute right-[3px] top-[3px] grid h-[18px] w-[18px] cursor-pointer place-content-center rounded-full bg-ink text-paper transition-opacity hover:opacity-85"
    >
      <X size={11} strokeWidth={2.2} />
    </button>
  );
}

// A recording, as a filmstrip of its first frames + duration/frame count.
function VideoCard({
  video,
  onRemove,
  onOpen,
  compact,
}: {
  video: VideoAttachment;
  onRemove?: () => void;
  onOpen?: () => void;
  compact?: boolean;
}) {
  const thumbs = video.frames.slice(0, compact ? 3 : 4);
  const size = compact ? "h-[56px] w-[56px]" : "h-[96px] w-[128px]";
  const body = (
    <>
      <div className="flex">
        {thumbs.map((f, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={f.url}
            alt=""
            draggable={false}
            className={cn(size, "object-cover border-r border-mist last:border-r-0")}
          />
        ))}
      </div>
      <div className="flex items-center gap-[6px] border-t border-mist bg-bone-2 px-[8px] py-[4px] font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
        <Video size={11} strokeWidth={1.7} />
        {formatTimestamp(video.duration)} · {video.frames.length} frame
        {video.frames.length === 1 ? "" : "s"}
        {video.transcript ? " · narrated" : ""}
      </div>
    </>
  );
  return (
    <div
      className={cn(
        "relative flex-shrink-0 overflow-hidden rounded-[8px] border border-mist bg-paper-2",
        onOpen && "cursor-pointer transition-colors hover:border-mist-2"
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          title="View frames and transcript"
          className="block cursor-pointer text-left"
        >
          {body}
        </button>
      ) : (
        body
      )}
      {onRemove && <RemoveButton onClick={onRemove} />}
    </div>
  );
}

// Pending attachments above the textarea, plus recording/processing status.
export function AttachmentTray({
  attachments,
  onRemove,
  busy,
  error,
  recording,
  className = "",
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
  busy?: boolean;
  error?: string | null;
  recording?: RecordingState;
  className?: string;
}) {
  const phase = recording?.phase ?? "idle";
  if (!attachments.length && !busy && !error && phase === "idle") return null;
  return (
    <div className={cn("flex flex-col gap-[6px]", className)}>
      {(attachments.length > 0 || busy || phase !== "idle") && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {attachments.map((a) =>
            a.kind === "video" ? (
              <VideoCard key={a.id} video={a} compact onRemove={() => onRemove(a.id)} />
            ) : (
              <div
                key={a.id}
                className="relative h-[56px] w-[56px] flex-shrink-0 overflow-hidden rounded-[8px] border border-mist bg-paper-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                <RemoveButton onClick={() => onRemove(a.id)} />
              </div>
            )
          )}
          {recording?.phase === "recording" && (
            <span className="inline-flex items-center gap-[7px] rounded-full border border-pulse bg-pulse-tint px-[10px] py-[5px] font-mono text-[10px] uppercase tracking-[0.08em] text-pulse-ink">
              <span className="h-[6px] w-[6px] rounded-full bg-pulse [animation:mb-pulse_1.4s_infinite]" />
              Recording <Elapsed since={recording.startedAt} />
              <span className="normal-case tracking-normal text-slate-2">
                {recording.source === "desktop"
                  ? "— drag an area to start; stop with ■ in the menu bar (or here). Esc cancels."
                  : "— press ■ when done"}
              </span>
            </span>
          )}
          {recording?.phase === "processing" && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
              {recording.step}
            </span>
          )}
          {busy && phase === "idle" && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
              Adding…
            </span>
          )}
        </div>
      )}
      {error && (
        <p className="m-0 rounded-[6px] border border-pulse bg-pulse-tint px-3 py-[6px] text-[12px] text-pulse-ink">
          {error}
        </p>
      )}
    </div>
  );
}

// Attachments on a sent user message. Click opens the full-size view.
export function MessageAttachments({
  attachments,
}: {
  attachments?: ChatAttachment[];
}) {
  const [open, setOpen] = useState<ChatAttachment | null>(null);
  if (!attachments?.length) return null;
  return (
    <>
      <div className="mb-[6px] flex flex-wrap gap-[8px]">
        {attachments.map((a) =>
          a.kind === "video" ? (
            <VideoCard key={a.id} video={a} onOpen={() => setOpen(a)} />
          ) : (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(a)}
              title="View full size"
              className="cursor-pointer overflow-hidden rounded-[10px] border border-mist bg-paper-2 transition-colors hover:border-mist-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt="Attached screenshot"
                className="block max-h-[180px] max-w-[280px] object-contain"
                draggable={false}
              />
            </button>
          )
        )}
      </div>
      <Modal open={open !== null} onClose={() => setOpen(null)} size="xl">
        {open?.kind === "image" && (
          <div className="p-[10px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={open.url}
              alt="Attached screenshot"
              className="mx-auto block max-h-[85vh] w-auto max-w-full rounded-[8px]"
            />
          </div>
        )}
        {open?.kind === "video" && (
          <div className="flex max-h-[85vh] flex-col gap-[12px] overflow-y-auto p-[16px]">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
              Screen recording · {formatTimestamp(open.duration)} ·{" "}
              {open.frames.length} frame{open.frames.length === 1 ? "" : "s"}
            </div>
            {open.transcript && (
              <p className="m-0 rounded-[8px] border border-mist bg-bone-2 px-[12px] py-[9px] text-[13px] leading-[1.55] text-ink-2">
                {open.transcript}
              </p>
            )}
            <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2">
              {open.frames.map((f, i) => (
                <figure key={i} className="m-0 flex flex-col gap-[4px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={`Frame at ${formatTimestamp(f.t)}`}
                    className="block w-full rounded-[8px] border border-mist"
                  />
                  <figcaption className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2">
                    {formatTimestamp(f.t)}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
