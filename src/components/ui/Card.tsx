import * as React from "react";

type CardVariant = "light" | "dark";

const CARD_VARIANT: Record<CardVariant, string> = {
  light: "bg-bone-2 border border-mist",
  dark: "bg-white/[0.03] border border-white/10",
};

export function Card({
  className = "",
  variant = "light",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return (
    <div
      className={[CARD_VARIANT[variant], "rounded-[10px]", className].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ListCard({
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "bg-bone-2 border border-mist rounded-[10px] overflow-hidden",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
