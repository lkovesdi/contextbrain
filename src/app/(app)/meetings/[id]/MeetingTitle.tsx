"use client";

import { useState } from "react";

export function MeetingTitle({
  id,
  initialTitle,
  initialSummaryTitle,
}: {
  id: string;
  initialTitle: string;
  initialSummaryTitle?: string | null;
}) {
  // Once the post-meeting summarizer runs it generates a descriptive headline
  // (`summary_title`) which is preferred over the raw `title` when the user
  // hasn't manually customized it. The user can still edit — that overwrites
  // `title` and we surface that going forward.
  const userEdited =
    initialTitle && initialTitle.trim() && initialTitle !== "Untitled meeting";
  const initial = userEdited ? initialTitle : initialSummaryTitle?.trim() || initialTitle;

  const [title, setTitle] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);

  async function save() {
    setEditing(false);
    const trimmed = draft.trim() || "Untitled meeting";
    if (trimmed === title) return;
    setTitle(trimmed);
    await fetch(`/api/meetings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
        className="rounded-[4px] border border-mist px-2 py-1 text-[14px] font-medium text-ink outline-none bg-bone-2 min-w-[280px]"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(title);
        setEditing(true);
      }}
      className="text-[14px] font-medium text-ink bg-transparent border-0 cursor-text p-0 truncate text-left"
      title={title}
    >
      {title}
    </button>
  );
}
