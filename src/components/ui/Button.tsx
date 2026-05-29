"use client";

import * as React from "react";

type Variant = "primary" | "ink" | "secondary" | "ghost" | "danger" | "icon";
type Size = "sm" | "md" | "lg";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

const SIZE: Record<Size, string> = {
  sm: "text-[12px] px-[11px] py-[5px] rounded-[4px] gap-[6px]",
  md: "text-[13px] px-[14px] py-[8px] rounded-[6px] gap-[7px]",
  lg: "text-[14px] px-[18px] py-[11px] rounded-[8px] gap-[8px]",
};

// Square padding for the icon-only variant — keeps the hit target balanced
// around a single glyph.
const ICON_SIZE: Record<Size, string> = {
  sm: "p-[6px] rounded-[6px]",
  md: "p-[8px] rounded-[6px]",
  lg: "p-[10px] rounded-[8px]",
};

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-cortex text-white border border-transparent hover:bg-cortex-hover active:bg-cortex-press",
  ink:
    "bg-ink text-paper border border-transparent hover:bg-ink-2",
  secondary:
    "bg-bone-2 text-ink border border-mist hover:bg-paper-2",
  ghost:
    "bg-transparent text-ink border border-transparent hover:bg-paper-2",
  danger:
    "bg-pulse text-white border border-transparent hover:opacity-90",
  icon:
    "bg-bone-2 text-slate border border-mist hover:bg-paper-2 hover:text-ink",
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", leftIcon, rightIcon, className = "", children, disabled, ...rest },
  ref
) {
  const isIcon = variant === "icon";
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={[
        "inline-flex items-center whitespace-nowrap font-medium tracking-[-0.005em]",
        isIcon ? "justify-center" : "",
        "transition-[background-color,box-shadow] duration-[120ms] ease-[var(--ease-out)]",
        "cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed",
        isIcon ? ICON_SIZE[size] : SIZE[size],
        VARIANT[variant],
        className,
      ].join(" ")}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
});
