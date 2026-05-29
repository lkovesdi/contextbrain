"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2 } from "lucide-react";
import { Eyebrow } from "@/components/ui/typography";
import { ListCard } from "@/components/ui/Card";
import { SpacePicker } from "./meetings/[id]/SpacePicker";
import { MeetingTags } from "./meetings/[id]/MeetingTags";
import { DeleteMeetingButton } from "./DeleteMeetingButton";
import type { MeetingListItem } from "@/lib/meetings";

type Space = { id: string; name: string; icon: string | null };

export function MeetingsBrowser({
  initialItems,
  initialNextCursor,
  spaces,
}: {
  initialItems: MeetingListItem[];
  initialNextCursor: string | null;
  spaces: Space[];
}) {
  const [browseItems, setBrowseItems] = useState<MeetingListItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const [query, setQuery] = useState("");
  const [searchItems, setSearchItems] = useState<MeetingListItem[] | null>(null);
  const [searching, setSearching] = useState(false);

  const isSearch = query.trim().length > 0;
  const items = isSearch ? searchItems ?? [] : browseItems;

  // Immediate UI state lives in the event handler (not the effect) so we don't
  // trip the no-synchronous-setState-in-effect rule. Typing flips into the
  // "searching" state; clearing restores the browse list (kept in state so we
  // don't refetch what we already loaded).
  function onQueryChange(value: string) {
    setQuery(value);
    if (value.trim()) {
      setSearching(true);
    } else {
      setSearching(false);
      setSearchItems(null);
    }
  }

  // Debounced fetch only — the setState calls happen in the async callback, not
  // synchronously in the effect body.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/meetings?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        const data = res.ok ? await res.json() : { items: [] };
        setSearchItems((data.items ?? []) as MeetingListItem[]);
      } catch {
        setSearchItems([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/meetings?cursor=${encodeURIComponent(cursor)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setBrowseItems((cur) => [...cur, ...((data.items ?? []) as MeetingListItem[])]);
        setCursor((data.nextCursor as string | null) ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  // Infinite scroll — only while browsing (search returns a single ranked page).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isSearch || !cursor) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "240px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isSearch, cursor, loadMore]);

  function removeItem(id: string) {
    setBrowseItems((cur) => cur.filter((m) => m.id !== id));
    setSearchItems((cur) => (cur ? cur.filter((m) => m.id !== id) : cur));
  }

  const eyebrow = isSearch
    ? searching
      ? "Searching…"
      : `Results · ${items.length}`
    : `Recent · ${browseItems.length}${cursor ? "+" : ""}`;

  return (
    <>
      <div className="relative mb-[14px]">
        <Search
          size={14}
          strokeWidth={1.6}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-2 pointer-events-none"
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search meetings…"
          className="w-full rounded-[8px] border border-mist bg-bone-2 pl-9 pr-3 py-[9px] text-[13px] text-ink outline-none focus:border-mist-2"
        />
      </div>

      <Eyebrow className="mb-[10px]">{eyebrow}</Eyebrow>

      {items.length > 0 ? (
        <>
          <ListCard>
            {items.map((m, i) => (
              <MeetingRow
                key={m.id}
                item={m}
                spaces={spaces}
                isLast={i === items.length - 1}
                onDeleted={() => removeItem(m.id)}
              />
            ))}
          </ListCard>
          {!isSearch && cursor && (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-5 text-slate-2"
            >
              {loadingMore && <Loader2 size={16} strokeWidth={1.6} className="animate-spin" />}
            </div>
          )}
        </>
      ) : isSearch ? (
        !searching && (
          <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-10 text-center">
            <p className="text-[13px] text-slate m-0">
              No meetings match “{query.trim()}”.
            </p>
          </div>
        )
      ) : (
        <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-12 text-center">
          <p className="text-[13px] text-slate">No meetings yet.</p>
          <p className="mt-1 text-[12px] text-slate-2">
            Click <span className="font-medium text-ink-2">New meeting</span> to start one.
          </p>
        </div>
      )}
    </>
  );
}

function MeetingRow({
  item: m,
  spaces,
  isLast,
  onDeleted,
}: {
  item: MeetingListItem;
  spaces: Space[];
  isLast: boolean;
  onDeleted: () => void;
}) {
  const live = !m.ended_at;
  return (
    <div
      className={[
        "group flex flex-col gap-[8px] px-[18px] py-[14px]",
        "transition-colors duration-[120ms] ease-[var(--ease-out)] hover:bg-paper-2",
        isLast ? "" : "border-b border-mist",
      ].join(" ")}
    >
      <div className="flex items-center gap-[14px]">
        <Link
          href={`/meetings/${m.id}`}
          className="flex items-center gap-[14px] flex-1 min-w-0"
        >
          <span
            className={[
              "w-[7px] h-[7px] rounded-full flex-shrink-0",
              live ? "bg-pulse [animation:mb-pulse_1.4s_infinite]" : "bg-slate-3",
            ].join(" ")}
          />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium text-ink tracking-[-0.005em] truncate">
              {displayTitle(m)}
            </div>
            <div className="font-mono text-[11px] text-slate mt-[3px] flex gap-[14px] truncate">
              <span>{m.started_at ? new Date(m.started_at).toLocaleString() : "—"}</span>
              <span>· {live ? "in progress" : durationLabel(m.started_at, m.ended_at)}</span>
            </div>
          </div>
        </Link>
        <SpacePicker
          meetingId={m.id}
          spaces={spaces}
          initialSpaceId={m.space_id}
          variant="compact"
        />
        <Link
          href={`/meetings/${m.id}`}
          className="font-mono text-[11px] text-slate-3 whitespace-nowrap hidden md:inline opacity-0 group-hover:opacity-100 transition-opacity"
        >
          Open →
        </Link>
        <DeleteMeetingButton meetingId={m.id} title={displayTitle(m)} onDeleted={onDeleted} />
      </div>
      <div className="pl-[21px]">
        <MeetingTags meetingId={m.id} initialTags={m.tags} />
      </div>
    </div>
  );
}

function displayTitle(m: MeetingListItem) {
  const userEdited = m.title && m.title.trim() && m.title !== "Untitled meeting";
  if (userEdited) return m.title;
  return m.summary_title?.trim() || m.title;
}

function durationLabel(start: string | null, end: string | null) {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}
