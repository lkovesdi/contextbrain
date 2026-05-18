"use client";

import { useRef, useState } from "react";
import TrashIcon from "@/components/icons/TrashIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Note = {
  id: string;
  content: string;
  is_checked: boolean;
  created_at: string;
};

export function Notes({
  meetingId,
  initialNotes,
}: {
  meetingId: string;
  initialNotes: Note[];
}) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [draft, setDraft] = useState("");

  async function addNote() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, meeting_id: meetingId }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as Note;
    setNotes((prev) => [...prev, created]);
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addNote();
              }
            }}
            placeholder="Add a note…"
          />
        </div>
        <Button variant="ink" onClick={addNote}>
          Add
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-[22px] text-center text-[13px] text-slate">
          No notes yet.
        </div>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-[6px]">
          {notes.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              onToggle={() => toggleCheck(n)}
              onEdit={(content) => editNote(n, content)}
              onDelete={() => deleteNote(n)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({
  note,
  onToggle,
  onEdit,
  onDelete,
}: {
  note: Note;
  onToggle: () => void;
  onEdit: (content: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [hover, setHover] = useState(false);
  const iconRef = useRef<AnimatedIconHandle | null>(null);

  return (
    <li
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
      ].join(" ")}
    >
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
            className="block"
            style={{
              width: 7,
              height: 4,
              borderLeft: "1.5px solid #fff",
              borderBottom: "1.5px solid #fff",
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
