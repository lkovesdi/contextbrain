import * as React from "react";

export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "font-mono text-[11px] uppercase tracking-[0.08em] text-slate-2",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function Mono({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={["font-mono text-[11px] text-slate", className].join(" ")}>
      {children}
    </span>
  );
}

export function PageHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={[
        "font-display text-[44px] font-normal leading-[1.05] tracking-[-0.018em] text-ink m-0",
        className,
      ].join(" ")}
    >
      {children}
    </h1>
  );
}

export function PageSubhead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={[
        "text-[14px] text-slate mt-2 max-w-[480px]",
        className,
      ].join(" ")}
    >
      {children}
    </p>
  );
}
