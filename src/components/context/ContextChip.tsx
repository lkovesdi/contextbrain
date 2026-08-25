"use client";

import { useEffect, useRef } from "react";
import { Check, Square, X } from "lucide-react";

export type ChipStatus = "queued" | "indexing" | "ready" | "error";

export type ChipData = {
  id: string;
  name: string;
  source_type: string;
  status: ChipStatus;
  chunks_total: number;
  chunks_done: number;
  error_message?: string | null;
};

type Props = {
  chip: ChipData;
  checked: boolean;
  onToggle: () => void;
  // Removes the chip from the *current* selection (preset/meeting); the chip
  // stays in the user's library so it can be re-checked later. Used when the
  // chip is in a terminal state (`ready` or `error`).
  onRemove?: () => void;
  // Stops the indexing job *and* deletes the chip from the library. Used while
  // the chip is `queued`/`indexing` — the user wants to bail before any work
  // sticks. If omitted, the X falls back to `onRemove` for those states too.
  onCancel?: () => void;
  // Triggers /status polling until status is ready or error.
  poll?: boolean;
  onUpdate?: (next: ChipData) => void;
};

export function ContextChip({
  chip,
  checked,
  onToggle,
  onRemove,
  onCancel,
  poll = true,
  onUpdate,
}: Props) {
  // Poll while indexing. Stop on ready/error. The chip is fully controlled —
  // each tick fans the new snapshot back to the parent via onUpdate. The
  // callback lives in a ref so a parent passing an unstable identity can't
  // retrigger the effect — each retrigger fires an immediate tick, which
  // turned the 1500ms interval into a back-to-back request loop.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });
  useEffect(() => {
    if (!poll) return;
    if (chip.status === "ready" || chip.status === "error") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/contexts/${chip.id}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const next = (await res.json()) as ChipData;
        if (cancelled) return;
        onUpdateRef.current?.(next);
      } catch {
        // network blip — try again next tick.
      }
    };
    const t = setInterval(tick, 1500);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [chip.id, chip.status, poll]);

  const ready = chip.status === "ready";
  const error = chip.status === "error";
  const progress =
    chip.chunks_total > 0 ? chip.chunks_done / chip.chunks_total : 0;

  return (
    <div
      className={[
        "group flex items-center gap-[10px] px-[10px] py-[6px] rounded-full",
        "border transition-colors duration-[120ms] ease-[var(--ease-out)] cursor-pointer select-none",
        checked
          ? "bg-cortex-tint border-cortex-tint-2"
          : "bg-bone-2 border-mist hover:bg-paper-2",
        error ? "border-pulse-tint" : "",
      ].join(" ")}
      onClick={onToggle}
      role="button"
      aria-pressed={checked}
      title={error && chip.error_message ? chip.error_message : chip.name}
    >
      <ProgressRing
        progress={ready ? 1 : progress}
        ready={ready}
        error={error}
        active={chip.status === "indexing"}
      />
      <span
        className={[
          "text-[12.5px] font-medium leading-none truncate max-w-[260px]",
          checked ? "text-cortex-ink" : "text-ink",
        ].join(" ")}
      >
        {chip.name}
      </span>
      <span className="font-mono text-[10px] text-slate-2 leading-none whitespace-nowrap">
        {chipMeta(chip)}
      </span>
      {(onRemove || onCancel) && (() => {
        const indexing = chip.status === "queued" || chip.status === "indexing";
        const handler = indexing && onCancel ? onCancel : onRemove;
        if (!handler) return null;
        const Icon = indexing && onCancel ? Square : X;
        const label = indexing && onCancel ? "Cancel indexing" : "Remove from selection";
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handler();
            }}
            aria-label={label}
            title={label}
            className="ml-1 w-[16px] h-[16px] grid place-content-center rounded-full text-slate-3 hover:text-pulse hover:bg-pulse-tint bg-transparent border-0 cursor-pointer transition-colors"
          >
            <Icon size={indexing ? 9 : 11} strokeWidth={1.6} fill={indexing && onCancel ? "currentColor" : "none"} />
          </button>
        );
      })()}
    </div>
  );
}

function chipMeta(chip: ChipData): string {
  if (chip.status === "queued") return "queued";
  if (chip.status === "error") return "error";
  if (chip.status === "indexing") {
    if (chip.chunks_total > 0) {
      return `${chip.chunks_done.toLocaleString()} / ${chip.chunks_total.toLocaleString()}`;
    }
    return "indexing…";
  }
  return chip.chunks_done > 0
    ? `${chip.chunks_done.toLocaleString()} chunks · ready`
    : "ready";
}

// ----- Circular progress ring ---------------------------------------------

function ProgressRing({
  progress,
  ready,
  error,
  active,
}: {
  progress: number;
  ready: boolean;
  error: boolean;
  active: boolean;
}) {
  const SIZE = 16;
  const STROKE = 2;
  const r = (SIZE - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const safe = Math.max(0, Math.min(1, progress));
  const dash = c * safe;

  const trackColor = error
    ? "var(--pulse-tint)"
    : ready
    ? "var(--cortex-tint)"
    : "var(--mist)";
  const fillColor = error
    ? "var(--pulse)"
    : ready
    ? "var(--cortex)"
    : "var(--cortex)";

  return (
    <span className="relative inline-grid place-content-center" style={{ width: SIZE, height: SIZE }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden
        className={active ? "animate-[spin_4s_linear_infinite]" : ""}
        style={{ transformOrigin: "center" }}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={r}
          fill={ready ? fillColor : "none"}
          stroke={fillColor}
          strokeWidth={STROKE}
          strokeDasharray={`${dash} ${c}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: "stroke-dasharray 240ms var(--ease-out)" }}
        />
      </svg>
      {ready && (
        <span className="absolute inset-0 grid place-content-center text-on-accent">
          <Check size={9} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}
