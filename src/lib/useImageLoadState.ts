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

// Tracks an image's loading lifecycle and schedules an auto-retry after
// `retryAfterMs` on error. The chat/summary use this to gracefully ride out
// Composio's render rate-limit window: the user sees a "rendering…" tile, and
// once the upstream cooldown ends the image fills in without any reload.
//
// `loadTimeoutMs` is a watchdog for the *loading* state: a stalled request (a
// hung upstream render, a crashed route, a dropped connection) would otherwise
// leave the tile spinning forever, since neither `onLoad` nor `onError` ever
// fires. When loading overruns the watchdog we treat it as an error so the
// retry path kicks in — successful renders are cached server-side, so the
// retry resolves quickly.
export function useImageLoadState(
  url: string,
  retryAfterMs = 10_000,
  loadTimeoutMs = 20_000
): ImageLoadController {
  const [state, setState] = useState<LoadState>("loading");
  const [retryKey, setRetryKey] = useState(0);

  // Cap automatic retries so a persistent failure (e.g. an unauthenticated 401,
  // a permanently unrenderable node) doesn't hammer the endpoint forever. Past
  // the cap we settle on the error state and leave the manual "Retry" button.
  const MAX_AUTO_RETRIES = 4;

  // Schedule auto-retry after error. Deferred via setTimeout, so the setState
  // is not synchronous-in-effect (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    if (state !== "errored" || retryKey >= MAX_AUTO_RETRIES) return;
    const t = setTimeout(() => {
      setState("loading");
      setRetryKey((k) => k + 1);
    }, retryAfterMs);
    return () => clearTimeout(t);
  }, [state, retryKey, retryAfterMs]);

  // Watchdog: if a load stalls past `loadTimeoutMs`, force an error so the
  // retry logic above takes over instead of spinning indefinitely.
  useEffect(() => {
    if (state !== "loading") return;
    const t = setTimeout(() => setState("errored"), loadTimeoutMs);
    return () => clearTimeout(t);
  }, [state, retryKey, loadTimeoutMs]);

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
