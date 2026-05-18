import * as React from "react";

export function Card({
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "bg-bone-2 border border-mist rounded-[10px]",
        className,
      ].join(" ")}
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
