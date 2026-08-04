"use client";

import * as React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
  tone?: "light" | "dark";
};

export const Input = React.forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, className = "", id, tone = "light", ...rest },
  ref
) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  const dark = tone === "dark";
  return (
    <label htmlFor={inputId} className="flex flex-col gap-[5px]">
      {label && (
        <span
          className={[
            "text-[12px] font-medium",
            dark ? "text-float-ink-2" : "text-ink-2",
          ].join(" ")}
        >
          {label}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={[
          "w-full rounded-[6px] px-3 py-[9px] text-[13px]",
          dark ? "text-float-ink placeholder:text-float-ink-3" : "text-ink",
          "border outline-none transition-shadow duration-[120ms] ease-[var(--ease-out)]",
          "focus:border-transparent focus:[box-shadow:0_0_0_3px_var(--cortex-tint),inset_0_0_0_1px_var(--cortex)]",
          error
            ? dark
              ? "bg-float-ink/[0.04] border-pulse"
              : "bg-pulse-tint border-pulse"
            : dark
              ? "bg-float-ink/[0.04] border-float-border"
              : "bg-bone-2 border-mist",
          className,
        ].join(" ")}
        {...rest}
      />
      {(hint || error) && (
        <span
          className={[
            "font-mono text-[10px] uppercase tracking-[0.07em]",
            error ? "text-pulse" : dark ? "text-float-ink-3" : "text-slate-2",
          ].join(" ")}
        >
          {error || hint}
        </span>
      )}
    </label>
  );
});
