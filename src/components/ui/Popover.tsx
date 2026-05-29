"use client";

import * as React from "react";
import { createPortal } from "react-dom";

type Align = "start" | "end";

type Props = {
  /** The clickable element that toggles the popover (e.g. an icon Button). */
  trigger: React.ReactNode;
  /** Panel content. Pass a function to receive a `close()` callback — handy for
   *  forms that should dismiss the popover after saving. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  /** Anchor the panel to the trigger's left ("start") or right ("end") edge. */
  align?: Align;
  /** Fixed panel width in px. Required for `align="end"` to line up the edge. */
  width?: number;
  /** Extra classes for the floating panel. */
  className?: string;
};

export function Popover({
  trigger,
  children,
  align = "start",
  width,
  className = "",
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      // Nested floating layers (e.g. a portaled search dropdown) render outside
      // this panel's DOM subtree. Treat clicks inside them as "inside" so they
      // don't dismiss the popover mid-interaction.
      if (t instanceof Element && t.closest("[data-floating-layer]")) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const w = width ?? 220;
      let left = align === "end" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setPos({ top: r.bottom + 6, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, align, width]);

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onClick={() => setOpen((o) => !o)}
    >
      {trigger}
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            // Stop clicks inside the panel from bubbling back to the anchor's
            // toggle handler (React portals propagate through the React tree).
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={[
              "fixed z-50 rounded-[10px] border border-mist bg-bone-2 p-[12px]",
              "animate-[mb-fade-in_120ms_ease-out]",
              className,
            ].join(" ")}
            style={{
              top: pos.top,
              left: pos.left,
              width,
              boxShadow: "var(--shadow-3)",
            }}
          >
            {typeof children === "function"
              ? children(() => setOpen(false))
              : children}
          </div>,
          document.body
        )}
    </span>
  );
}
