"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { FolderClosed, Check, FolderPlus } from "lucide-react";

type Space = { id: string; name: string; icon: string | null };

export function SpacePicker({
  meetingId,
  spaces: initialSpaces,
  initialSpaceId,
  variant = "default",
  onMoved,
}: {
  meetingId: string;
  spaces: Space[];
  initialSpaceId: string | null;
  // "default" = full-width trigger for the meeting header.
  // "compact" = small pill suited to inline use in a list row.
  variant?: "default" | "compact";
  onMoved?: (spaceId: string | null) => void;
}) {
  const [spaces, setSpaces] = useState<Space[]>(initialSpaces);
  const [spaceId, setSpaceId] = useState<string | null>(initialSpaceId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      // The menu is rendered in a portal so it isn't inside `ref`. Check both.
      if (
        ref.current &&
        !ref.current.contains(t) &&
        (!menuRef.current || !menuRef.current.contains(t))
      ) {
        setOpen(false);
        setCreating(false);
        setQuery("");
      }
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Position the portalled menu under the trigger. Recomputed on open and
  // whenever the user scrolls/resizes, so a long page scroll doesn't strand
  // the menu somewhere on the viewport.
  useLayoutEffect(() => {
    // No-op while closed — the portal isn't rendered, so stale menuPos is
    // harmless and we avoid the eager null-set that the set-state-in-effect
    // lint rule flags.
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 260;
      const left = Math.min(
        Math.max(8, r.right - width),
        window.innerWidth - width - 8
      );
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

  useEffect(() => {
    if (open && !creating) {
      // Focus the search input on open so typing immediately filters.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, creating]);

  async function move(next: string | null) {
    setSpaceId(next);
    setOpen(false);
    setQuery("");
    await fetch(`/api/meetings/${meetingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ space_id: next }),
    });
    onMoved?.(next);
    // Refresh the route so server-rendered lists (dashboard, space detail)
    // pick up the change without a full reload.
    router.refresh();
  }

  async function createAndMove(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) return;
      const created = (await res.json()) as Space;
      setSpaces((cur) => [{ id: created.id, name: created.name, icon: null }, ...cur]);
      setCreating(false);
      await move(created.id);
    } finally {
      setBusy(false);
    }
  }

  const current = spaces.find((s) => s.id === spaceId);
  const filtered = query.trim()
    ? spaces.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    : spaces;
  const showCreate = !!query.trim() && !filtered.some((s) => s.name.toLowerCase() === query.toLowerCase());

  const compact = variant === "compact";
  const triggerClasses = compact
    ? [
        "inline-flex items-center gap-[5px] px-[8px] py-[3px] rounded-full text-[11px]",
        "border transition-colors",
        current
          ? "border-mist bg-bone-2 text-ink-2 hover:bg-paper-2"
          : "border-mist-2 bg-transparent text-slate-2 hover:text-ink hover:border-mist",
      ].join(" ")
    : [
        "inline-flex items-center gap-[6px] px-[10px] py-[5px] rounded-[6px] text-[11.5px]",
        "border border-mist bg-bone-2 hover:bg-paper-2 transition-colors",
        current ? "text-ink" : "text-slate-2",
      ].join(" ");

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={triggerClasses}
      >
        {current ? (
          <>
            <span className={compact ? "text-[12px] leading-none" : "text-[13px] leading-none"}>
              {current.icon || "📁"}
            </span>
            <span className={compact ? "truncate max-w-[100px]" : "truncate max-w-[140px]"}>
              {current.name}
            </span>
          </>
        ) : (
          <>
            <FolderClosed size={compact ? 11 : 12} strokeWidth={1.6} />
            <span>{compact ? "Unfiled" : "Move to space"}</span>
          </>
        )}
      </button>

      {open && menuPos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 rounded-[8px] border border-mist bg-bone-2 py-[5px]"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            boxShadow: "var(--shadow-3)",
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {creating ? (
            <CreateForm
              busy={busy}
              onCancel={() => {
                setCreating(false);
                setQuery("");
              }}
              onCreate={createAndMove}
              initialName={query}
            />
          ) : (
            <>
              <div className="px-2 pb-[5px]">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-[6px] border border-mist bg-paper-2 px-2 py-[5px] text-[12px] text-ink outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setOpen(false);
                      setQuery("");
                    }
                    if (e.key === "Enter" && showCreate) {
                      createAndMove(query);
                    }
                  }}
                />
              </div>

              <div className="max-h-[260px] overflow-y-auto">
                <button
                  onClick={() => move(null)}
                  className="w-full flex items-center gap-2 px-3 py-[7px] text-[12.5px] text-left text-ink hover:bg-paper-2"
                >
                  <span className="w-[14px] flex-shrink-0">
                    {!spaceId && <Check size={12} strokeWidth={1.8} />}
                  </span>
                  <span className="text-slate-2">Unfiled</span>
                </button>

                {filtered.length === 0 && !showCreate ? (
                  <p className="px-3 py-2 text-[11.5px] text-slate-2">No matches.</p>
                ) : (
                  filtered.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => move(s.id)}
                      className="w-full flex items-center gap-2 px-3 py-[7px] text-[12.5px] text-left text-ink hover:bg-paper-2"
                    >
                      <span className="w-[14px] flex-shrink-0">
                        {s.id === spaceId && <Check size={12} strokeWidth={1.8} />}
                      </span>
                      <span className="text-[13px] leading-none">{s.icon || "📁"}</span>
                      <span className="truncate">{s.name}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="border-t border-mist mt-[3px] pt-[3px]">
                <button
                  onClick={() => setCreating(true)}
                  className="w-full flex items-center gap-2 px-3 py-[8px] text-[12.5px] text-left text-cortex-ink hover:bg-cortex-tint"
                >
                  <FolderPlus size={13} strokeWidth={1.7} />
                  <span>{showCreate ? `Create "${query}"` : "New space"}</span>
                </button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function CreateForm({
  initialName,
  busy,
  onCancel,
  onCreate,
}: {
  initialName: string;
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="px-2 py-1 flex flex-col gap-[6px]">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Space name"
        onKeyDown={(e) => {
          if (e.key === "Enter") onCreate(name);
          if (e.key === "Escape") onCancel();
        }}
        className="w-full rounded-[6px] border border-mist bg-paper-2 px-2 py-[5px] text-[12.5px] text-ink outline-none"
      />
      <div className="flex items-center justify-end gap-[6px]">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-[8px] py-[3px] rounded-[5px] text-[11.5px] text-slate-2 hover:text-ink bg-transparent border-0 cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={() => onCreate(name)}
          disabled={busy || !name.trim()}
          className="px-[10px] py-[3px] rounded-[5px] text-[11.5px] text-white bg-ink hover:opacity-90 border-0 cursor-pointer disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create & file"}
        </button>
      </div>
    </div>
  );
}
