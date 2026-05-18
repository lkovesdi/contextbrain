"use client";

import * as React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
};

export const Input = React.forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, className = "", id, ...rest },
  ref
) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  return (
    <label htmlFor={inputId} className="flex flex-col gap-[5px]">
      {label && (
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={[
          "w-full rounded-[6px] px-3 py-[9px] text-[13px] text-ink",
          "border outline-none transition-shadow duration-[120ms] ease-[var(--ease-out)]",
          error
            ? "bg-[#FBF3F1] border-pulse"
            : "bg-bone-2 border-mist focus:border-transparent focus:[box-shadow:0_0_0_3px_var(--cortex-tint),inset_0_0_0_1px_var(--cortex)]",
          className,
        ].join(" ")}
        {...rest}
      />
      {(hint || error) && (
        <span
          className={[
            "font-mono text-[10px] uppercase tracking-[0.07em]",
            error ? "text-pulse" : "text-slate-2",
          ].join(" ")}
        >
          {error || hint}
        </span>
      )}
    </label>
  );
});
