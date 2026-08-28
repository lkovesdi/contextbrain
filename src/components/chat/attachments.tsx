"use client";

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import {
  MAX_ATTACHMENTS,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { canCaptureScreen, captureScreenshot, normalizeImage } from "@/lib/screenshot";

export type { ChatAttachment } from "@/lib/chat-attachments";
export { toRequestAttachments } from "@/lib/chat-attachments";

// Composer-side state for image attachments. One hook per chat surface; the
// surface owns the textarea and just spreads the handlers onto it (paste) and
// its wrapper (drag-drop), and renders <AttachmentTray> + <AttachControls>.
export function useChatAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addBlobs = useCallback(async (blobs: Blob[]) => {
    const images = blobs.filter((b) => b.type.startsWith("image/"));
    if (!images.length) return;
    setBusy(true);
    setError(null);
    try {
      const fresh: ChatAttachment[] = [];
      for (const blob of images) {
        const img = await normalizeImage(blob);
        fresh.push({
          id: crypto.randomUUID(),
          mediaType: img.mediaType,
          url: img.url,
          data: img.data,
          width: img.width,
          height: img.height,
        });
      }
      setAttachments((prev) => {
        const merged = [...prev, ...fresh];
        if (merged.length > MAX_ATTACHMENTS) {
          setError(`Up to ${MAX_ATTACHMENTS} images per message.`);
          return merged.slice(0, MAX_ATTACHMENTS);
        }
        return merged;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that image.");
    } finally {
      setBusy(false);
    }
  }, []);

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
    busy,
    error,
    capture,
    addBlobs,
    remove,
    clear,
    onPaste,
    onDrop,
    onDragOver,
  };
}

// Screenshot + add-image buttons. Screenshot is hidden where neither the
// desktop command nor getDisplayMedia exists (paste still works there).
export function AttachControls({
  onCapture,
  onFiles,
  busy,
  disabled,
  className = "",
}: {
  onCapture: () => void;
  onFiles: (files: File[]) => void;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Capture support is a client-only fact (Tauri bridge / getDisplayMedia);
  // render "no" on the server so hydration matches, then resolve on mount.
  const showCapture = useSyncExternalStore(
    () => () => {},
    canCaptureScreen,
    () => false
  );

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
          disabled={disabled || busy}
          title="Screenshot — pick a region or window"
          aria-label="Take a screenshot"
          className={cn("flex-shrink-0", className)}
        >
          <Camera size={14} strokeWidth={1.6} />
        </Button>
      )}
      <Button
        type="button"
        variant="icon"
        size="md"
        onClick={() => fileRef.current?.click()}
        disabled={disabled || busy}
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

// Pending images above the textarea, each with a remove ×.
export function AttachmentTray({
  attachments,
  onRemove,
  busy,
  error,
  className = "",
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
  busy?: boolean;
  error?: string | null;
  className?: string;
}) {
  if (!attachments.length && !busy && !error) return null;
  return (
    <div className={cn("flex flex-col gap-[6px]", className)}>
      {(attachments.length > 0 || busy) && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {attachments.map((a) => (
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
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                aria-label="Remove image"
                title="Remove"
                className="absolute right-[3px] top-[3px] grid h-[18px] w-[18px] cursor-pointer place-content-center rounded-full bg-ink text-paper transition-opacity hover:opacity-85"
              >
                <X size={11} strokeWidth={2.2} />
              </button>
            </div>
          ))}
          {busy && (
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

// Images on a sent user message. Click opens the full-size view.
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
        {attachments.map((a) => (
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
        ))}
      </div>
      <Modal open={open !== null} onClose={() => setOpen(null)} size="xl">
        {open && (
          <div className="p-[10px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={open.url}
              alt="Attached screenshot"
              className="mx-auto block max-h-[85vh] w-auto max-w-full rounded-[8px]"
            />
          </div>
        )}
      </Modal>
    </>
  );
}
