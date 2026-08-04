"use client";

import { useEffect, useRef } from "react";

// Tiny level meter driven by the live mic signal. `levelRef` carries the most
// recent chunk peak (0..1); each frame we smooth it (fast attack / slow
// release, like a VU meter) and drive a small equalizer: center bars run
// taller and a per-bar time wobble keeps it shimmering while someone speaks.
const MINI_BARS = 5;
const MINI_MAX_PX = 14;
const MINI_BASE_PX = 2;

export function MiniWaveform({
  active,
  levelRef,
  barClassName = "bg-on-accent",
}: {
  active: boolean;
  levelRef: { current: number };
  barClassName?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const displayRef = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const tick = () => {
      // Perceptual curve so quiet speech is still visible; sqrt ≈ loudness.
      const target = active
        ? Math.min(1, Math.sqrt(Math.max(0, levelRef.current)) * 1.4)
        : 0;
      const d = displayRef.current;
      const k = target > d ? 0.5 : 0.14;
      displayRef.current = d + (target - d) * k;

      const lvl = displayRef.current;
      const t = performance.now() / 140;
      const mid = (MINI_BARS - 1) / 2;
      const bars = node.children;
      for (let i = 0; i < bars.length; i++) {
        const center = 1 - Math.abs(i - mid) / mid; // 1 at center, 0 at edges
        const wobble = 0.6 + 0.4 * Math.sin(t + i * 1.7);
        const h =
          MINI_BASE_PX +
          lvl * (MINI_MAX_PX - MINI_BASE_PX) * (0.45 + 0.55 * center) * wobble;
        (bars[i] as HTMLElement).style.height = `${h}px`;
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active, levelRef]);

  return (
    <span
      ref={ref}
      aria-hidden
      className="inline-flex h-[14px] items-center gap-[2px]"
    >
      {Array.from({ length: MINI_BARS }).map((_, i) => (
        <span
          key={i}
          className={`w-[2px] rounded-[1px] ${barClassName}`}
          style={{ height: `${MINI_BASE_PX}px` }}
        />
      ))}
    </span>
  );
}
