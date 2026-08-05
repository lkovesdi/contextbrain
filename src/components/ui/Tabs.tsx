"use client";

import type { ReactNode } from "react";

export type TabOption = { value: string; label: ReactNode };

// Small segmented tab switcher (the design-system counterpart of a native
// tab bar): bordered pill container, active tab lifted onto a bone surface.
export function Tabs({
  tabs,
  value,
  onChange,
  className = "",
  "aria-label": ariaLabel,
}: {
  tabs: TabOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={[
        "inline-flex items-center gap-[2px] rounded-[8px] border border-mist bg-paper-2 p-[3px]",
        className,
      ].join(" ")}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={[
              "cursor-pointer rounded-[6px] px-[12px] py-[5px] text-[12.5px] font-medium",
              "transition-colors duration-[120ms] ease-[var(--ease-out)]",
              active
                ? "bg-bone-2 text-ink shadow-[var(--shadow-1)]"
                : "text-slate hover:text-ink",
            ].join(" ")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
