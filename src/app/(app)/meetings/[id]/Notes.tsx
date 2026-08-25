"use client";

import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import TrashIcon from "@/components/icons/TrashIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { Input } from "@/components/ui/Input";

export type Note = {
  id: string;
  content: string;
  is_checked: boolean;
  created_at: string;
};

// Granola-style inline note capture, rendered at the tail of the stream where
// the saved note will land. Enter saves and stays open for rapid capture,
// Escape (or blurring while empty) closes.
export function NoteComposer({
  onAdd,
  onClose,
}: {
  onAdd: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    wrapRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  async function submit() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await onAdd(content);
    // The new row lands above the composer — keep the composer in view.
    wrapRef.current?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div ref={wrapRef}>
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setDraft("");
            onClose();
          }
        }}
        onBlur={() => {
          if (!draft.trim()) onClose();
        }}
        placeholder="Add a note… (Enter to save, Esc to close)"
      />
    </div>
  );
}

export function NoteRow({
  note,
  onToggle,
  onEdit,
  onDelete,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  note: Note;
  onToggle: () => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
  /** True while this row is the one being dragged — dims it in place. */
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [hover, setHover] = useState(false);
  // The row is only draggable while the pointer is on the grip, so text
  // selection and click-to-edit on the content keep working.
  const [canDrag, setCanDrag] = useState(false);
  const iconRef = useRef<AnimatedIconHandle | null>(null);

  return (
    <li
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", note.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragEnd={() => {
        setCanDrag(false);
        onDragEnd?.();
      }}
      onMouseEnter={() => {
        setHover(true);
        iconRef.current?.startAnimation();
      }}
      onMouseLeave={() => {
        setHover(false);
        iconRef.current?.stopAnimation();
      }}
      className={[
        "flex items-center gap-[10px] px-3 py-[9px]",
        "bg-bone-2 border border-mist rounded-[6px]",
        note.is_checked ? "opacity-[0.72]" : "",
        dragging ? "opacity-40" : "",
      ].join(" ")}
    >
      <span
        onMouseEnter={() => setCanDrag(true)}
        onMouseLeave={() => setCanDrag(false)}
        title="Drag to reorder"
        aria-hidden
        className={[
          "-ml-[6px] grid w-[14px] flex-shrink-0 cursor-grab place-content-center text-slate-3 transition-opacity active:cursor-grabbing",
          hover ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        <GripVertical size={13} strokeWidth={1.6} />
      </span>
      <span
        onClick={onToggle}
        className={[
          "w-[15px] h-[15px] rounded-[4px] flex-shrink-0 grid place-content-center cursor-pointer",
          "border-[1.4px]",
          note.is_checked
            ? "border-cortex bg-cortex"
            : "border-mist-2 bg-paper",
        ].join(" ")}
      >
        {note.is_checked && (
          <span
            className="block border-l-[1.5px] border-b-[1.5px] border-on-accent"
            style={{
              width: 7,
              height: 4,
              transform: "rotate(-45deg) translate(1px,-1px)",
            }}
          />
        )}
      </span>
      <div className="flex-1 min-w-0">
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft.trim() && draft !== note.content) onEdit(draft.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            rows={Math.max(1, draft.split("\n").length)}
            className="w-full resize-none rounded-[6px] border border-mist bg-bone-2 px-2 py-1 text-[13.5px] text-ink outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className={[
              "w-full text-left text-[13.5px] leading-[1.5] whitespace-pre-wrap bg-transparent border-0 p-0 cursor-text",
              note.is_checked ? "text-slate-2 line-through" : "text-ink",
            ].join(" ")}
          >
            {note.content}
          </button>
        )}
      </div>
      <button
        onClick={onDelete}
        aria-label="Delete note"
        className={[
          "w-[22px] h-[22px] grid place-content-center rounded-[4px] bg-transparent border-0 cursor-pointer",
          "transition-all duration-[120ms] ease-[var(--ease-out)]",
          hover ? "text-pulse opacity-100" : "text-slate-3 opacity-60",
        ].join(" ")}
      >
        <TrashIcon ref={iconRef} size={12} strokeWidth={1.6} />
      </button>
    </li>
  );
}
