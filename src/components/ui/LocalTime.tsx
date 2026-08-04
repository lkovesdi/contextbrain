"use client";

import { useSyncExternalStore } from "react";

// Locale/timezone-dependent date formatting differs between the server (UTC)
// and the user's machine, so rendering it during SSR fails hydration — React
// then re-renders the whole root client-side, which is slow and strips
// pre-hydration attributes from <html> (this broke the desktop titlebar
// inset). Render a placeholder on the server and the formatted local string
// only after hydration.
const emptySubscribe = () => () => {};

export function LocalTime({
  date,
  format = (d) => d.toLocaleString(),
  fallback = "—",
  className,
}: {
  date: string | number | Date | null | undefined;
  format?: (d: Date) => string;
  fallback?: string;
  className?: string;
}) {
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  if (!date) return <span className={className}>{fallback}</span>;
  return (
    <span className={className}>{hydrated ? format(new Date(date)) : "\u00A0"}</span>
  );
}
