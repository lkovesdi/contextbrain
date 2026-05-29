"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
};

type Size = "sm" | "md";

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: Size;
  /** Optional field label rendered above the control (form usage). */
  label?: React.ReactNode;
  /** Stretch the trigger to fill its container (form usage). */
  fullWidth?: boolean;
  /** Extra classes for the trigger button (e.g. width, font overrides). */
  className?: string;
  /** Accessible name when there is no visible `label`. */
  "aria-label"?: string;
  id?: string;
};

const TRIGGER_SIZE: Record<Size, string> = {
  sm: "px-2 py-[5px] text-[12px] rounded-[6px] gap-[6px]",
  md: "px-3 py-[9px] text-[13px] rounded-[6px] gap-2",
};

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  size = "md",
  label,
  fullWidth = false,
  className = "",
  id,
  "aria-label": ariaLabel,
}: Props) {
  const reactId = React.useId();
  const triggerId = id ?? reactId;

  const [open, setOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [highlight, setHighlight] = React.useState(0);

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  // Close on outside pointer-down.
  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Position the menu under the trigger and keep it pinned while scrolling.
  React.useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 160);
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

  // Open the menu with the current selection pre-highlighted.
  function openMenu() {
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
    setOpen(true);
  }

  function commit(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveHighlight(dir: 1 | -1) {
    setHighlight((cur) => {
      let next = cur;
      for (let i = 0; i < options.length; i++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[highlight];
      if (opt) commit(opt);
    }
  }

  const trigger = (
    <button
      ref={triggerRef}
      id={triggerId}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        if (open) setOpen(false);
        else openMenu();
      }}
      onKeyDown={onKeyDown}
      className={[
        "inline-flex items-center justify-between border bg-bone-2 text-ink outline-none",
        "transition-colors duration-[120ms] ease-[var(--ease-out)]",
        "cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        open ? "border-cortex" : "border-mist hover:border-mist-2",
        fullWidth ? "w-full" : "",
        TRIGGER_SIZE[size],
        className,
      ].join(" ")}
    >
      <span
        className={[
          "inline-flex items-center gap-[6px] truncate",
          selected ? "text-ink" : "text-slate-2",
        ].join(" ")}
      >
        {selected?.icon}
        <span className="truncate">{selected ? selected.label : placeholder}</span>
      </span>
      <ChevronDown
        size={size === "sm" ? 13 : 15}
        strokeWidth={1.7}
        className={[
          "flex-shrink-0 text-slate-2 transition-transform duration-[120ms]",
          open ? "rotate-180" : "",
        ].join(" ")}
      />
    </button>
  );

  const menu =
    open && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className="fixed z-50 max-h-[260px] overflow-y-auto rounded-[8px] border border-mist bg-bone-2 py-[5px]"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              boxShadow: "var(--shadow-3)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((o, i) => {
              const isSelected = o.value === value;
              const isHighlighted = i === highlight;
              return (
                <button
                  key={`${o.value}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={o.disabled}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => commit(o)}
                  className={[
                    "w-full flex items-center gap-2 px-3 py-[7px] text-[12.5px] text-left",
                    "cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                    isHighlighted ? "bg-paper-2" : "",
                    isSelected ? "text-cortex-ink" : "text-ink",
                  ].join(" ")}
                >
                  <span className="w-[14px] flex-shrink-0 grid place-content-center">
                    {isSelected && <Check size={12} strokeWidth={2} />}
                  </span>
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )
      : null;

  if (label) {
    return (
      <div className="flex flex-col gap-[5px]">
        <label
          htmlFor={triggerId}
          className="text-[12px] font-medium text-ink-2"
        >
          {label}
        </label>
        {trigger}
        {menu}
      </div>
    );
  }

  return (
    <>
      {trigger}
      {menu}
    </>
  );
}
