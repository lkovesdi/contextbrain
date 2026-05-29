"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, Sparkles, X, Loader2, Check } from "lucide-react";
import { parseTagInput, tagDisplay, type Tag, type TagSpec } from "@/lib/tags";

function sameSpec(a: TagSpec, b: TagSpec): boolean {
  return (
    (a.label_key ?? null) === (b.label_key ?? null) &&
    a.value.toLowerCase() === b.value.toLowerCase()
  );
}

export function MeetingTags({
  meetingId,
  initialTags,
}: {
  meetingId: string;
  initialTags: Tag[];
}) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [allTags, setAllTags] = useState<Tag[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<TagSpec[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        (!menuRef.current || !menuRef.current.contains(t))
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 280;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setMenuPos({ top: r.bottom + 4, left, width });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Lazy-load the tag library the first time the menu opens.
  useEffect(() => {
    if (!open || allTags !== null) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/tags", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      setAllTags((await res.json()) as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, allTags]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  async function attach(spec: TagSpec) {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      if (!res.ok) return;
      const tag = (await res.json()) as Tag;
      setTags((cur) => (cur.some((t) => t.id === tag.id) ? cur : [...cur, tag]));
      setAllTags((cur) =>
        cur && cur.some((t) => t.id === tag.id) ? cur : [tag, ...(cur ?? [])]
      );
      setSuggestions((cur) => cur?.filter((s) => !sameSpec(s, tag)) ?? cur);
      setQuery("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function detach(tagId: string) {
    setTags((cur) => cur.filter((t) => t.id !== tagId));
    await fetch(`/api/meetings/${meetingId}/tags?tag_id=${encodeURIComponent(tagId)}`, {
      method: "DELETE",
    });
    router.refresh();
  }

  async function suggest() {
    setSuggesting(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/tags/suggest`, {
        method: "POST",
      });
      if (!res.ok) {
        setSuggestions([]);
        return;
      }
      const data = (await res.json()) as { suggestions?: TagSpec[] };
      const applied = new Set(
        tags.map((t) => `${t.label_key ?? ""} ${t.value.toLowerCase()}`)
      );
      setSuggestions(
        (data.suggestions ?? []).filter(
          (s) => !applied.has(`${s.label_key ?? ""} ${s.value.toLowerCase()}`)
        )
      );
    } finally {
      setSuggesting(false);
    }
  }

  const appliedIds = new Set(tags.map((t) => t.id));
  const spec = parseTagInput(query);
  const library = (allTags ?? []).filter((t) => !appliedIds.has(t.id));
  const filtered = query.trim()
    ? library.filter((t) =>
        tagDisplay(t).toLowerCase().includes(query.trim().toLowerCase())
      )
    : library;
  const showCreate =
    !!spec &&
    !filtered.some(
      (t) =>
        (t.label_key ?? null) === spec.label_key &&
        t.value.toLowerCase() === spec.value.toLowerCase()
    );

  return (
    <div ref={ref} className="flex items-center flex-wrap gap-[6px]">
      {tags.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={() => detach(t.id)} />
      ))}

      <button
        ref={triggerRef}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-[4px] px-[8px] py-[3px] rounded-full text-[11px] border border-dashed border-mist-2 text-slate-2 hover:text-ink hover:border-mist bg-transparent transition-colors cursor-pointer"
      >
        <Plus size={11} strokeWidth={1.8} />
        {tags.length === 0 ? "Add tag" : null}
      </button>

      {open && menuPos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 rounded-[8px] border border-mist bg-bone-2 py-[5px]"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              boxShadow: "var(--shadow-3)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-2 pb-[5px]">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tag, or key: value…"
                className="w-full rounded-[6px] border border-mist bg-paper-2 px-2 py-[5px] text-[12px] text-ink outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setOpen(false);
                    setQuery("");
                  }
                  if (e.key === "Enter" && spec && !busy) attach(spec);
                }}
              />
              {spec?.label_key && (
                <p className="mt-[5px] px-[2px] text-[10.5px] text-slate-2">
                  smart label ·{" "}
                  <span className="text-cortex-ink font-medium">{spec.label_key}</span>
                  {" : "}
                  {spec.value}
                </p>
              )}
            </div>

            <div className="max-h-[240px] overflow-y-auto">
              {showCreate && spec && (
                <button
                  onClick={() => attach(spec)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-3 py-[7px] text-[12.5px] text-left text-cortex-ink hover:bg-cortex-tint disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Plus size={12} strokeWidth={1.8} />
                  <span>
                    Create{" "}
                    <span className="font-medium">{tagDisplay(spec)}</span>
                  </span>
                </button>
              )}

              {filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => attach({ label_key: t.label_key, value: t.value })}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-3 py-[7px] text-[12.5px] text-left text-ink hover:bg-paper-2 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  <span className="w-[12px] flex-shrink-0" />
                  <ChipLabel tag={t} />
                </button>
              ))}

              {filtered.length === 0 && !showCreate && (
                <p className="px-3 py-2 text-[11.5px] text-slate-2">
                  {query.trim() ? "No matches." : "No tags yet — type to create one."}
                </p>
              )}
            </div>

            <div className="border-t border-mist mt-[3px] pt-[3px]">
              <button
                onClick={suggest}
                disabled={suggesting}
                className="w-full flex items-center gap-2 px-3 py-[8px] text-[12.5px] text-left text-cortex-ink hover:bg-cortex-tint disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
              >
                {suggesting ? (
                  <Loader2 size={13} strokeWidth={1.7} className="animate-spin" />
                ) : (
                  <Sparkles size={13} strokeWidth={1.7} />
                )}
                <span>{suggesting ? "Reading the meeting…" : "Suggest with AI"}</span>
              </button>

              {suggestions !== null && !suggesting && (
                <div className="px-2 pb-1">
                  {suggestions.length === 0 ? (
                    <p className="px-1 py-[6px] text-[11.5px] text-slate-2">
                      No new suggestions.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-[5px] pt-1">
                      {suggestions.map((s, i) => (
                        <button
                          key={`${s.label_key ?? ""}-${s.value}-${i}`}
                          onClick={() => attach(s)}
                          disabled={busy}
                          className="inline-flex items-center gap-[4px] px-[8px] py-[3px] rounded-full text-[11px] border border-cortex-tint bg-cortex-tint text-cortex-ink hover:opacity-80 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <Check size={10} strokeWidth={2} />
                          <ChipLabel tag={s} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function ChipLabel({ tag }: { tag: TagSpec }) {
  if (tag.label_key) {
    return (
      <span className="truncate">
        <span className="text-cortex-ink font-medium">{tag.label_key}</span>
        <span className="text-slate-2">: </span>
        {tag.value}
      </span>
    );
  }
  return <span className="truncate">{tag.value}</span>;
}

function TagChip({ tag, onRemove }: { tag: Tag; onRemove: () => void }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-[5px] pl-[9px] pr-[5px] py-[3px] rounded-full text-[11px] border",
        tag.label_key
          ? "border-mist bg-paper-2 text-ink-2"
          : "border-mist bg-bone-2 text-ink-2",
      ].join(" ")}
    >
      <ChipLabel tag={tag} />
      <button
        onClick={onRemove}
        aria-label={`Remove ${tagDisplay(tag)}`}
        className="grid place-content-center w-[14px] h-[14px] rounded-full text-slate-2 hover:text-ink hover:bg-mist bg-transparent border-0 cursor-pointer"
      >
        <X size={10} strokeWidth={2} />
      </button>
    </span>
  );
}
