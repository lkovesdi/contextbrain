"use client";

import * as React from "react";

type Props = {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  dim?: boolean;
};

export function Checkbox({ checked, onChange, children, dim = false }: Props) {
  return (
    <label
      className={[
        "flex items-center gap-[9px] cursor-pointer text-[13.5px]",
        dim ? "text-slate" : "text-ink-2",
      ].join(" ")}
    >
      <span
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={[
          "w-[15px] h-[15px] rounded-[4px] flex-shrink-0 grid place-content-center",
          "border-[1.4px] transition-all duration-[120ms] ease-[var(--ease-out)]",
          checked
            ? "border-cortex bg-cortex"
            : "border-mist-2 bg-bone-2",
        ].join(" ")}
      >
        {checked && (
          <span
            className="block"
            style={{
              width: 7,
              height: 4,
              borderLeft: "1.5px solid #fff",
              borderBottom: "1.5px solid #fff",
              transform: "rotate(-45deg) translate(1px,-1px)",
            }}
          />
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onChange(!checked)}
        className="hidden"
      />
      <span>{children}</span>
    </label>
  );
}
