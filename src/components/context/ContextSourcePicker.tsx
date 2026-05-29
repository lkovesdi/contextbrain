"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Folder, FileText, Plus, Search, Ticket } from "lucide-react";
import type { ChipData } from "./ContextChip";
import {
  SOURCE_PROVIDERS,
  type ChildItem,
  type ContainerItem,
  type ProviderId,
  type SourceProviderConfig,
} from "./sources";

type Props = {
  // Which integrations to expose. Tabs are shown only when there's >1.
  // The order here is the order shown in the tab strip.
  providers: ProviderId[];
  onAdded: (chip: ChipData) => void;
  // Optional disabled message — e.g. "Connect <X> first" when *no* providers
  // are connected.
  disabledReason?: string | null;
};

export function ContextSourcePicker({ providers, onAdded, disabledReason }: Props) {
  const enabled = providers.filter((p) => SOURCE_PROVIDERS[p]);
  const [activeProviderId, setActiveProviderId] = useState<ProviderId>(
    enabled[0] ?? "github"
  );
  const provider = SOURCE_PROVIDERS[activeProviderId];

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [containersError, setContainersError] = useState<string | null>(null);
  const [activeContainer, setActiveContainer] = useState<ContainerItem | null>(null);
  const [path, setPath] = useState("");
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(false);
  // Active intermediate mode. "__default" = the existing tree view; anything
  // else swaps in a flat list driven by `provider.intermediateModes.listForMode`.
  const [activeModeKey, setActiveModeKey] = useState<string>("__default");
  const [modeItems, setModeItems] = useState<ChildItem[]>([]);
  const [modeLoading, setModeLoading] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  // Reset all state when the user switches integrations. Deferred to a
  // microtask so the lint rule "no synchronous setState in effect body" is
  // satisfied — the runtime behavior is identical.
  useEffect(() => {
    queueMicrotask(() => {
      setQuery("");
      setActiveContainer(null);
      setPath("");
      setContainers([]);
      setChildren([]);
      setActiveModeKey("__default");
      setModeItems([]);
    });
  }, [activeProviderId]);

  // Reset mode + clear results when the user leaves the container.
  useEffect(() => {
    if (activeContainer) return;
    queueMicrotask(() => {
      setActiveModeKey("__default");
      setModeItems([]);
      setModeError(null);
    });
  }, [activeContainer]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Anchor dropdown under the input.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Container search (debounced, only at the root).
  useEffect(() => {
    if (!open || activeContainer) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setContainersLoading(true);
      setContainersError(null);
      try {
        const items = await provider.searchContainers(query);
        if (cancelled) return;
        setContainers(items);
      } catch (e) {
        if (cancelled) return;
        setContainersError(e instanceof Error ? e.message : "Search failed");
        setContainers([]);
      } finally {
        if (!cancelled) setContainersLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open, activeContainer, provider]);

  // Children load when entering / navigating inside a container. Only active
  // in the default mode — non-default modes use their own list endpoint below.
  useEffect(() => {
    if (!activeContainer || activeModeKey !== "__default") return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setChildrenLoading(true);
      try {
        const items = await provider.listChildren(activeContainer, path);
        if (cancelled) return;
        // Sort: folders first, then files/tickets, alpha within each.
        items.sort((a, b) => {
          if (a.isNavigable !== b.isNavigable) return a.isNavigable ? -1 : 1;
          return a.display.localeCompare(b.display);
        });
        setChildren(items);
      } catch {
        if (!cancelled) setChildren([]);
      } finally {
        if (!cancelled) setChildrenLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeContainer, path, provider, activeModeKey]);

  // Mode list load when the user picks a non-default mode (e.g. Branches, PRs).
  // Debounced like container search so typing in the input refines results.
  useEffect(() => {
    if (!activeContainer || activeModeKey === "__default") return;
    if (!provider.intermediateModes) return;
    const listFor = provider.intermediateModes.listForMode;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setModeLoading(true);
      setModeError(null);
      try {
        const items = await listFor(activeContainer, activeModeKey, query);
        if (cancelled) return;
        setModeItems(items);
      } catch (e) {
        if (cancelled) return;
        setModeError(e instanceof Error ? e.message : "Lookup failed");
        setModeItems([]);
      } finally {
        if (!cancelled) setModeLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeContainer, activeModeKey, query, provider]);

  async function postChip(payload: unknown, key: string) {
    setAdding(key);
    try {
      const res = await fetch(provider.createChipUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? "Failed to add context");
        return;
      }
      onAdded(json.context as ChipData);
      setOpen(false);
      setQuery("");
      setActiveContainer(null);
      setPath("");
      inputRef.current?.blur();
    } finally {
      setAdding(null);
    }
  }

  function leaveContainer() {
    setActiveContainer(null);
    setPath("");
    setChildren([]);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const breadcrumbs = useMemo(() => {
    if (!activeContainer || !provider.childrenAreRecursive) return [];
    const parts = path ? path.split("/") : [];
    return parts.map((part, i) => ({
      label: part,
      path: parts.slice(0, i + 1).join("/"),
    }));
  }, [activeContainer, path, provider.childrenAreRecursive]);

  const disabled = !!disabledReason || enabled.length === 0;
  const noConnections = enabled.length === 0;

  return (
    <div ref={wrapperRef} className="relative flex flex-col gap-1">
      {enabled.length > 1 && (
        <div className="flex gap-1">
          {enabled.map((p) => {
            const cfg = SOURCE_PROVIDERS[p];
            const active = p === activeProviderId;
            return (
              <button
                key={p}
                onClick={() => setActiveProviderId(p)}
                className={[
                  "px-[10px] py-[3px] text-[11px] font-medium rounded-full border transition-colors duration-[120ms]",
                  active
                    ? "bg-cortex-tint border-cortex-tint-2 text-cortex-ink"
                    : "bg-bone-2 border-mist text-slate hover:bg-paper-2 hover:text-ink",
                ].join(" ")}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}

      <div
        className={[
          "flex items-center gap-2 px-3 py-[8px] rounded-[6px] border bg-bone-2 transition-[border-color,box-shadow] duration-[120ms] ease-[var(--ease-out)]",
          disabled
            ? "border-mist opacity-60"
            : "border-mist focus-within:border-cortex focus-within:shadow-[0_0_0_2px_var(--cortex-tint)]",
        ].join(" ")}
      >
        <Search size={14} strokeWidth={1.6} className="text-slate-2 flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => !disabled && setOpen(true)}
          placeholder={
            noConnections
              ? "No integrations connected — visit Integrations to connect one."
              : disabled
              ? (disabledReason as string)
              : activeContainer
              ? `Search inside ${activeContainer.display}…`
              : provider.containerPlaceholder ??
                `Search ${provider.label} ${provider.containerNoun} to add as context…`
          }
          disabled={disabled}
          className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-slate-3 disabled:cursor-not-allowed"
        />
        {activeContainer && (
          <button
            onClick={leaveContainer}
            className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate hover:text-ink bg-transparent border-0 cursor-pointer flex items-center gap-1"
          >
            <ChevronLeft size={11} strokeWidth={1.6} />
            {provider.containerNoun}
          </button>
        )}
      </div>

      {open && !disabled && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          data-floating-layer
          className="max-h-[360px] overflow-y-auto rounded-[10px] bg-bone-2 border border-mist"
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 50,
            boxShadow: "var(--shadow-3)",
          }}
        >
          {!activeContainer ? (
            <ContainerList
              provider={provider}
              containers={containers}
              loading={containersLoading}
              error={containersError}
              adding={adding}
              onPick={(c) => {
                setActiveContainer(c);
                setPath("");
                setQuery("");
                setActiveModeKey("__default");
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              onAddWhole={(c) =>
                postChip(provider.containerToPayload(c), `whole:${c.id}`)
              }
            />
          ) : activeModeKey !== "__default" && provider.intermediateModes ? (
            <ModeView
              container={activeContainer}
              modes={provider.intermediateModes.modes}
              activeModeKey={activeModeKey}
              onModeChange={(k) => {
                setActiveModeKey(k);
                setQuery("");
                setModeItems([]);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              items={modeItems}
              loading={modeLoading}
              error={modeError}
              emptyHint={provider.intermediateModes.emptyHintForMode?.(activeModeKey)}
              adding={adding}
              onAdd={(child) =>
                postChip(
                  provider.intermediateModes!.modeChildToPayload(
                    activeContainer,
                    activeModeKey,
                    child
                  ),
                  `mode:${activeModeKey}:${child.id}`
                )
              }
            />
          ) : (
            <ChildrenView
              provider={provider}
              container={activeContainer}
              breadcrumbs={breadcrumbs}
              items={children}
              loading={childrenLoading}
              query={query}
              path={path}
              modes={provider.intermediateModes?.modes}
              activeModeKey={activeModeKey}
              onModeChange={(k) => {
                setActiveModeKey(k);
                setQuery("");
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              onNavigate={(p) => setPath(p)}
              adding={adding}
              onAddCurrent={() =>
                postChip(
                  provider.childToPayload(activeContainer, null, path),
                  `current:${path}`
                )
              }
              onAddChild={(child) =>
                postChip(
                  provider.childToPayload(activeContainer, child, path),
                  `child:${child.id}`
                )
              }
            />
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ----- Container list -----------------------------------------------------

function ContainerList({
  provider,
  containers,
  loading,
  error,
  adding,
  onPick,
  onAddWhole,
}: {
  provider: SourceProviderConfig;
  containers: ContainerItem[];
  loading: boolean;
  error: string | null;
  adding: string | null;
  onPick: (c: ContainerItem) => void;
  onAddWhole: (c: ContainerItem) => void;
}) {
  if (error) {
    return (
      <div className="px-4 py-3 text-[12.5px] text-pulse-ink font-mono">
        {error}
      </div>
    );
  }
  if (loading && containers.length === 0) {
    return (
      <div className="px-4 py-3 text-[12.5px] text-slate font-mono">
        Searching…
      </div>
    );
  }
  if (containers.length === 0) {
    return (
      <div className="px-4 py-3 text-[12.5px] text-slate font-mono">
        {provider.emptyHint ?? `No ${provider.containerNoun} found.`}
      </div>
    );
  }
  return (
    <ul className="list-none m-0 p-0">
      {containers.map((c) => (
        <li
          key={c.id}
          className="flex items-center gap-3 px-3 py-[10px] border-b border-mist last:border-b-0 hover:bg-paper-2 cursor-pointer group"
          onClick={() => onPick(c)}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-ink truncate">
              {c.display}
              {c.badge && (
                <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-slate-2 align-[1px]">
                  {c.badge}
                </span>
              )}
            </div>
            {c.secondary && (
              <div className="text-[11.5px] text-slate truncate mt-0.5">
                {c.secondary}
              </div>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddWhole(c);
            }}
            disabled={adding !== null}
            className="flex items-center gap-1 px-2 py-[4px] rounded-[4px] text-[11px] font-medium text-ink-2 bg-bone-2 border border-mist hover:bg-paper-2 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
          >
            <Plus size={10} strokeWidth={1.6} />
            {provider.containerActionLabel?.(c) ??
              `Whole ${provider.containerNoun.replace(/s$/, "")}`}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ----- Children view ------------------------------------------------------

function ChildrenView({
  provider,
  container,
  breadcrumbs,
  items,
  loading,
  query,
  path,
  modes,
  activeModeKey,
  onModeChange,
  onNavigate,
  adding,
  onAddCurrent,
  onAddChild,
}: {
  provider: SourceProviderConfig;
  container: ContainerItem;
  breadcrumbs: { label: string; path: string }[];
  items: ChildItem[];
  loading: boolean;
  query: string;
  path: string;
  modes?: Array<{ key: string; label: string }>;
  activeModeKey: string;
  onModeChange: (key: string) => void;
  onNavigate: (path: string) => void;
  adding: string | null;
  onAddCurrent: () => void;
  onAddChild: (child: ChildItem) => void;
}) {
  const filtered = query.trim()
    ? items.filter((e) =>
        e.display.toLowerCase().includes(query.toLowerCase())
      )
    : items;

  return (
    <div>
      {modes && modes.length > 1 && (
        <ModeTabs
          modes={modes}
          activeModeKey={activeModeKey}
          onChange={onModeChange}
        />
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-mist sticky top-0 bg-bone-2 z-10">
        <div className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-slate min-w-0 overflow-hidden">
          <button
            onClick={() => onNavigate("")}
            className="text-ink hover:text-cortex bg-transparent border-0 cursor-pointer p-0 truncate"
          >
            {container.display}
          </button>
          {breadcrumbs.map((b) => (
            <span key={b.path} className="flex items-center gap-1 truncate">
              <span className="text-mist-2">/</span>
              <button
                onClick={() => onNavigate(b.path)}
                className="text-ink hover:text-cortex bg-transparent border-0 cursor-pointer p-0 truncate"
              >
                {b.label}
              </button>
            </span>
          ))}
        </div>
        <button
          onClick={onAddCurrent}
          disabled={adding !== null}
          className="flex items-center gap-1 px-2 py-[4px] rounded-[4px] text-[11px] font-medium text-white bg-cortex hover:bg-cortex-hover cursor-pointer flex-shrink-0 disabled:opacity-50"
        >
          <Plus size={10} strokeWidth={1.6} />
          {provider.childrenAreRecursive && path
            ? "Add this folder"
            : provider.containerActionLabel?.(container) ??
              `Whole ${provider.containerNoun.replace(/s$/, "")}`}
        </button>
      </div>

      {loading ? (
        <div className="px-4 py-3 text-[12.5px] text-slate font-mono">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-3 text-[12.5px] text-slate font-mono">
          {query ? "Nothing matches." : `No ${provider.childNoun} here.`}
        </div>
      ) : (
        <ul className="list-none m-0 p-0">
          {filtered.map((child) => {
            const Icon =
              child.iconKind === "folder"
                ? Folder
                : child.iconKind === "ticket"
                ? Ticket
                : FileText;
            return (
              <li
                key={child.id}
                className={[
                  "flex items-center gap-2 px-3 py-[7px] border-b border-mist last:border-b-0 group",
                  child.isNavigable ? "cursor-pointer hover:bg-paper-2" : "",
                ].join(" ")}
                onClick={() =>
                  child.isNavigable && child.navigatePath !== undefined &&
                  onNavigate(child.navigatePath)
                }
              >
                <Icon
                  size={13}
                  strokeWidth={1.6}
                  className={child.isNavigable ? "text-cortex" : "text-slate"}
                />
                <span className="flex-1 min-w-0 text-[12.5px] text-ink truncate">
                  {child.display}
                </span>
                {child.meta && (
                  <span className="font-mono text-[10px] text-slate-2 whitespace-nowrap">
                    {child.meta}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (child.isNavigable && child.navigatePath !== undefined) {
                      onNavigate(child.navigatePath);
                    } else {
                      onAddChild(child);
                    }
                  }}
                  disabled={adding !== null}
                  className={[
                    "flex items-center gap-1 px-2 py-[3px] rounded-[4px] text-[10.5px] font-medium border",
                    "opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50",
                    child.isNavigable
                      ? "text-ink-2 bg-bone-2 border-mist hover:bg-paper-2"
                      : "text-white bg-cortex border-cortex hover:bg-cortex-hover",
                  ].join(" ")}
                >
                  <Plus size={10} strokeWidth={1.6} />
                  {child.isNavigable ? "Open" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ----- Mode tabs ----------------------------------------------------------

function ModeTabs({
  modes,
  activeModeKey,
  onChange,
}: {
  modes: Array<{ key: string; label: string }>;
  activeModeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 pt-2 pb-1 sticky top-0 bg-bone-2 z-20">
      {modes.map((m) => {
        const active = m.key === activeModeKey;
        return (
          <button
            key={m.key}
            onClick={() => onChange(m.key)}
            className={[
              "px-[10px] py-[3px] text-[11px] font-medium rounded-full border transition-colors duration-[120ms]",
              active
                ? "bg-cortex-tint border-cortex-tint-2 text-cortex-ink"
                : "bg-bone-2 border-mist text-slate hover:bg-paper-2 hover:text-ink",
            ].join(" ")}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ----- Mode view (flat list, e.g. branches / PRs) ------------------------

function ModeView({
  container,
  modes,
  activeModeKey,
  onModeChange,
  items,
  loading,
  error,
  emptyHint,
  adding,
  onAdd,
}: {
  container: ContainerItem;
  modes: Array<{ key: string; label: string }>;
  activeModeKey: string;
  onModeChange: (key: string) => void;
  items: ChildItem[];
  loading: boolean;
  error: string | null;
  emptyHint?: string;
  adding: string | null;
  onAdd: (child: ChildItem) => void;
}) {
  return (
    <div>
      <ModeTabs modes={modes} activeModeKey={activeModeKey} onChange={onModeChange} />
      <div className="px-3 py-2 border-b border-mist sticky top-[36px] bg-bone-2 z-10">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-slate truncate">
          {container.display}
        </div>
      </div>
      {error ? (
        <div className="px-4 py-3 text-[12.5px] text-pulse-ink font-mono">{error}</div>
      ) : loading && items.length === 0 ? (
        <div className="px-4 py-3 text-[12.5px] text-slate font-mono">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-4 py-3 text-[12.5px] text-slate font-mono">
          {emptyHint ?? "Nothing here."}
        </div>
      ) : (
        <ul className="list-none m-0 p-0">
          {items.map((item) => {
            const Icon =
              item.iconKind === "folder"
                ? Folder
                : item.iconKind === "ticket"
                ? Ticket
                : FileText;
            return (
              <li
                key={item.id}
                className="flex items-center gap-2 px-3 py-[7px] border-b border-mist last:border-b-0 group"
              >
                <Icon size={13} strokeWidth={1.6} className="text-slate flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-ink truncate">{item.display}</div>
                  {item.secondary && (
                    <div className="text-[11px] text-slate-2 truncate mt-[1px]">
                      {item.secondary}
                    </div>
                  )}
                </div>
                {item.meta && (
                  <span className="font-mono text-[10px] text-slate-2 whitespace-nowrap">
                    {item.meta}
                  </span>
                )}
                <button
                  onClick={() => onAdd(item)}
                  disabled={adding !== null}
                  className="flex items-center gap-1 px-2 py-[3px] rounded-[4px] text-[10.5px] font-medium border text-white bg-cortex border-cortex hover:bg-cortex-hover opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                >
                  <Plus size={10} strokeWidth={1.6} />
                  Add
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
