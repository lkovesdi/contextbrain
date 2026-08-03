"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { SummaryMarkdown } from "@/components/ui/SummaryMarkdown";

type Note = {
  id: string;
  content: string;
  is_checked: boolean;
  created_at: string;
  meeting_id: string | null;
};

// Content that already carries structure (### sections or bullet lines)
// renders through SummaryMarkdown; anything else stays plain text.
function looksLikeMarkdown(content: string) {
  return /(^|\n)(### |- )/.test(content);
}

export function NoteCard({
  note,
  meetingTitle,
  isLast,
}: {
  note: Note;
  meetingTitle: string | null;
  isLast: boolean;
}) {
  const [content, setContent] = useState(note.content);
  const [organizing, setOrganizing] = useState(false);
  const [organized, setOrganized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markdown = looksLikeMarkdown(content);
  const canOrganize = content.length >= 200;

  async function organize() {
    setOrganizing(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${note.id}/organize`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Organize failed");
      setContent(body.content as string);
      setOrganized(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Organize failed");
    } finally {
      setOrganizing(false);
    }
  }

  return (
    <div className={["px-[18px] py-[14px]", isLast ? "" : "border-b border-mist"].join(" ")}>
      <div className="mb-[7px] flex items-center justify-between gap-[12px]">
        <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate-3 flex items-center gap-[10px] min-w-0">
          <span className="whitespace-nowrap">
            {new Date(note.created_at).toLocaleString()}
          </span>
          {note.meeting_id && meetingTitle && (
            <>
              <span>·</span>
              <Link
                href={`/meetings/${note.meeting_id}`}
                className="hover:text-ink transition-colors truncate normal-case tracking-normal"
              >
                {meetingTitle}
              </Link>
            </>
          )}
        </div>
        {canOrganize && (
          <button
            type="button"
            onClick={organize}
            disabled={organizing}
            className="flex items-center gap-[5px] whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.07em] text-slate hover:text-ink bg-transparent border-0 p-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 transition-colors duration-[120ms] ease-[var(--ease-out)]"
          >
            {organizing ? (
              <Loader2 size={11} strokeWidth={1.6} className="animate-spin" />
            ) : (
              <Sparkles size={11} strokeWidth={1.6} />
            )}
            {organizing ? "Organizing…" : "Organize"}
          </button>
        )}
      </div>

      {markdown ? (
        <ExpandableText
          key={content}
          collapsedHeight={140}
          defaultExpanded={organized}
          className={["max-w-[64ch]", note.is_checked ? "opacity-60" : ""].join(" ")}
        >
          <SummaryMarkdown source={content} />
        </ExpandableText>
      ) : (
        <ExpandableText
          key={content}
          text={content}
          lines={3}
          defaultExpanded={organized}
          className={[
            "text-[13px] leading-[1.55] whitespace-pre-wrap max-w-[64ch]",
            note.is_checked ? "line-through text-slate-3" : "text-ink",
          ].join(" ")}
        />
      )}

      {error && <div className="mt-[6px] text-[11px] text-pulse">{error}</div>}
    </div>
  );
}
