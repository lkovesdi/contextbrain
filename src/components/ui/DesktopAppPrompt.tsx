"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";

// Persisted dismissal key + how long a dismissal sticks. After 30 days, the
// prompt comes back so users who haven't installed yet are nudged again.
const DISMISS_KEY = "contextbrain.desktop-prompt-dismissed-at";
const DISMISS_DAYS = 30;
const DISMISS_EVENT = "contextbrain:desktop-prompt-dismissed";

type Snapshot = { show: boolean };
const HIDDEN: Snapshot = { show: false };
const VISIBLE: Snapshot = { show: true };

// All impure reads (window/navigator/localStorage) live inside the
// useSyncExternalStore callbacks — that's React's blessed escape hatch for
// "this component depends on browser-only state". Returning the same module-
// scoped singletons keeps reference equality so React only re-renders when
// the value actually flips.
function compute(): Snapshot {
  if (typeof window === "undefined") return HIDDEN;
  if (isTauri()) return HIDDEN;
  if (!/Mac/i.test(navigator.userAgent)) return HIDDEN;
  const raw = localStorage.getItem(DISMISS_KEY);
  if (raw) {
    const days = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
    if (days < DISMISS_DAYS) return HIDDEN;
  }
  return VISIBLE;
}

let cached: Snapshot = HIDDEN;

function subscribe(callback: () => void) {
  function handler() {
    const next = compute();
    if (next !== cached) {
      cached = next;
      callback();
    }
  }
  window.addEventListener(DISMISS_EVENT, handler);
  return () => window.removeEventListener(DISMISS_EVENT, handler);
}

function getSnapshot(): Snapshot {
  const next = compute();
  if (next !== cached) cached = next;
  return cached;
}

function getServerSnapshot(): Snapshot {
  return HIDDEN;
}

export function DesktopAppPrompt() {
  const { show } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink/10 bg-ink/[0.04] px-4 py-2.5 text-[13px] text-ink">
      <p className="m-0 flex-1">
        <span className="font-medium">Get ContextBrain for Mac.</span>{" "}
        <span className="text-ink/65">
          Native window, auto-updates as new features ship.
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Link
          href="/download"
          className="cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-paper transition-colors hover:bg-ink/80"
        >
          Download
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="cursor-pointer rounded-md p-1.5 text-ink/55 transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
