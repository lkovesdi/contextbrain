"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Two collapse strategies behind one primitive: plain `text` gets a clean
// -webkit-line-clamp ellipsis; rich `children` (markdown etc.) get a
// max-height crop with a fade-out mask, since line-clamp can't cut across
// nested block elements. The toggle only appears when content actually
// overflows.
export function ExpandableText({
  text,
  children,
  lines = 3,
  collapsedHeight = 120,
  defaultExpanded = false,
  className = "",
}: {
  text?: string;
  children?: ReactNode;
  lines?: number;
  collapsedHeight?: number;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [clamped, setClamped] = useState(false);
  const rich = children !== undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines, collapsedHeight]);

  const collapsedStyle = rich
    ? {
        maxHeight: collapsedHeight,
        overflow: "hidden" as const,
        ...(clamped
          ? {
              WebkitMaskImage:
                "linear-gradient(to bottom, black 55%, transparent 100%)",
              maskImage:
                "linear-gradient(to bottom, black 55%, transparent 100%)",
            }
          : {}),
      }
    : {
        display: "-webkit-box" as const,
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical" as const,
        overflow: "hidden" as const,
      };

  return (
    <div>
      <div
        ref={ref}
        className={className}
        style={expanded ? undefined : collapsedStyle}
      >
        {rich ? children : text}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-[6px] font-mono text-[10.5px] uppercase tracking-[0.07em] text-slate hover:text-ink bg-transparent border-0 p-0 cursor-pointer transition-colors duration-[120ms] ease-[var(--ease-out)]"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
