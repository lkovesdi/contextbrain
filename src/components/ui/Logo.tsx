import * as React from "react";

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="11" fill="var(--ink)" />
      <path
        d="M14 31 C10 18 24 11 33 16 C39 21 38 28 34 32"
        stroke="var(--paper)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity=".62"
      />
      <path
        d="M9 35 C5 11 26 4 39 11"
        stroke="var(--paper)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity=".35"
      />
      <path
        d="M27 21 C30 22 30 27 25 27 C20 27 18 21 24 19 C32 16 35 25 30 30"
        stroke="var(--paper)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="25" cy="24" r="1.6" fill="var(--cortex)" />
    </svg>
  );
}

// SANCTIONED brand art: the light mark sits on the constant-dark marketing /
// auth hero in BOTH themes, so its palette is literal — theme vars would flip
// it dark-on-dark in dark mode.
export function LogoMarkLight({ size = 22 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="11" fill="#F2F1ED" />
      <path
        d="M14 31 C10 18 24 11 33 16 C39 21 38 28 34 32"
        stroke="#14151A"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity=".55"
      />
      <path
        d="M9 35 C5 11 26 4 39 11"
        stroke="#14151A"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity=".30"
      />
      <path
        d="M27 21 C30 22 30 27 25 27 C20 27 18 21 24 19 C32 16 35 25 30 30"
        stroke="#14151A"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="25" cy="24" r="1.6" fill="#4B49E6" />
    </svg>
  );
}
