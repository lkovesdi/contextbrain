"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";

type ThemePref = "system" | "light" | "dark";

// The root layout's pre-paint script owns theme application (it stamps
// html[data-theme] from localStorage cb_theme and guards it with a
// MutationObserver); this control just writes the preference and asks the
// script to re-resolve. Hydration-safe: renders "system" until mounted.
export function ThemeSelect() {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cb_theme");
      if (saved === "light" || saved === "dark") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPref(saved);
      }
    } catch {
      // localStorage can throw in private mode — keep "system".
    }
  }, []);

  function choose(value: string) {
    const next = (value === "light" || value === "dark" ? value : "system") as ThemePref;
    setPref(next);
    try {
      if (next === "system") localStorage.removeItem("cb_theme");
      else localStorage.setItem("cb_theme", next);
    } catch {}
    (window as unknown as { __cbApplyTheme?: () => void }).__cbApplyTheme?.();
  }

  return (
    <Select
      size="sm"
      aria-label="Theme"
      value={pref}
      onChange={choose}
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}
