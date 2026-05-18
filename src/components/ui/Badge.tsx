import * as React from "react";

type Tone = "live" | "ok" | "pend" | "idle" | "info";

const TONE: Record<Tone, { bg: string; fg: string; dot: string; border?: string }> = {
  live: { bg: "bg-pulse-tint", fg: "text-pulse-ink", dot: "bg-pulse" },
  ok:   { bg: "bg-echo-tint",  fg: "text-echo-ink",  dot: "bg-echo" },
  pend: { bg: "bg-amber-tint", fg: "text-amber-ink", dot: "bg-amber" },
  idle: { bg: "bg-paper-2",    fg: "text-slate",     dot: "bg-slate-3", border: "border border-mist" },
  info: { bg: "bg-cortex-tint",fg: "text-cortex-ink",dot: "bg-cortex" },
};

export function Badge({
  tone = "idle",
  pulse = false,
  children,
}: {
  tone?: Tone;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      className={[
        "inline-flex items-center gap-[6px] px-[10px] py-[3px] rounded-full",
        "text-[11.5px] font-medium",
        t.bg, t.fg, t.border ?? "",
      ].join(" ")}
    >
      <span
        className={[
          "w-[6px] h-[6px] rounded-full",
          t.dot,
          pulse ? "[animation:mb-pulse_1.4s_infinite]" : "",
        ].join(" ")}
      />
      {children}
    </span>
  );
}
