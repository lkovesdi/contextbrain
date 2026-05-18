"use client";

import { useEffect, useState } from "react";

type LoadState = "loading" | "loaded" | "errored";

export type ImageLoadController = {
  state: LoadState;
  // Use this src on <img> — appends a cache-busting param when retrying so the
  // browser doesn't serve back any prior 429.
  src: string;
  onLoad: () => void;
  onError: () => void;
  retryNow: () => void;
};

// Tracks an image's loading lifecycle and schedules a single auto-retry after
// `retryAfterMs` on error. The chat/summary use this to gracefully ride out
// Composio's render rate-limit window: the user sees a "rendering…" tile, and
// once the upstream cooldown ends the image fills in without any reload.
export function useImageLoadState(
  url: string,
  retryAfterMs = 90_000
): ImageLoadController {
  const [state, setState] = useState<LoadState>("loading");
  const [retryKey, setRetryKey] = useState(0);

  // Schedule auto-retry after error. Deferred via setTimeout, so the setState
  // is not synchronous-in-effect (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    if (state !== "errored") return;
    const t = setTimeout(() => {
      setState("loading");
      setRetryKey((k) => k + 1);
    }, retryAfterMs);
    return () => clearTimeout(t);
  }, [state, retryAfterMs]);

  // Reset state when the URL changes (e.g. component re-render with new src).
  // Deferred to a microtask so it isn't a synchronous setState in the body
  // (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    queueMicrotask(() => {
      setRetryKey(0);
      setState("loading");
    });
  }, [url]);

  const src =
    retryKey > 0
      ? `${url}${url.includes("?") ? "&" : "?"}_r=${retryKey}`
      : url;

  return {
    state,
    src,
    onLoad: () => setState("loaded"),
    onError: () => setState("errored"),
    retryNow: () => {
      setState("loading");
      setRetryKey((k) => k + 1);
    },
  };
}
