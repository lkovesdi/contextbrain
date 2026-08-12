"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Square } from "lucide-react";
import { MiniWaveform } from "@/components/recording/MiniWaveform";
import type { RecordingSession } from "@/components/recording/RecordingProvider";

// Content of the desktop floating recording widget — a small always-on-top
// Tauri window created by the shell while a recording runs (Granola-style).
// It has no session data of its own: the main window's RecordingProvider
// broadcasts state over a same-origin BroadcastChannel, and the widget sends
// "stop" / "open" commands back the same way. Tauri IPC is used only to focus
// the main window; if that capability is missing the button still works via
// the broadcast (the main window navigates, it just isn't raised).

function formatElapsed(startedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function tauriInvoke(cmd: string) {
  try {
    const t = (
      window as unknown as {
        __TAURI__?: { core?: { invoke?: (c: string) => Promise<unknown> } };
      }
    ).__TAURI__;
    t?.core?.invoke?.(cmd)?.catch(() => {});
  } catch {
    // not in the desktop shell
  }
}

export default function RecordingWidget() {
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const levelRef = useRef(0);
  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("cb-recording");
    bcRef.current = bc;
    bc.onmessage = (ev: MessageEvent) => {
      const m = ev.data as
        | { type: "state"; session: RecordingSession | null }
        | { type: "level"; level: number }
        | { type: string };
      if (m.type === "state") {
        setSession((m as { session: RecordingSession | null }).session);
      } else if (m.type === "level") {
        levelRef.current = (m as { level: number }).level;
      }
    };
    // Ask the main window for the current state (we may mount mid-recording).
    bc.postMessage({ type: "hello" });
    return () => {
      bcRef.current = null;
      bc.close();
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The shell computes the transparent window's native shadow before the
  // webview has painted; nudge it to recompute once the pill is on screen.
  // Double rAF: the first callback runs before its frame paints.
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => tauriInvoke("widget_ready"));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  return (
    <>
      {/* This window floats transparent over the desktop — the page must not
          paint the app's default background. */}
      <style>{`html, body { background: transparent !important; }`}</style>
      <div
        data-tauri-drag-region
        className="fixed inset-0 flex items-center gap-3 rounded-[16px] border border-float-border bg-float pl-4 pr-2 select-none"
      >
        <span className="pointer-events-none relative flex h-[8px] w-[8px] flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-pulse opacity-60 [animation:mb-pulse_1.4s_infinite]" />
          <span className="relative inline-flex h-[8px] w-[8px] rounded-full bg-pulse" />
        </span>
        {/* flex, not inline: an inline wrapper puts the meter on the text
            baseline inside a full line box, floating it ~2px above center */}
        <span className="pointer-events-none flex">
          <MiniWaveform active={!!session} levelRef={levelRef} barClassName="bg-float-ink" />
        </span>
        <span className="pointer-events-none font-mono text-[12px] tabular-nums text-float-ink-2">
          {session ? formatElapsed(session.startedAt, now) : "–:––"}
        </span>
        <span className="pointer-events-none min-w-0 flex-1 truncate text-[12.5px] text-float-ink">
          {session ? session.title : "Waiting for recording…"}
        </span>
        <button
          type="button"
          aria-label="Open meeting"
          title="Open meeting"
          onClick={() => {
            // Rust command first — it raises the window and works even when
            // the main window is minimized; the broadcast is a web fallback.
            tauriInvoke("focus_main");
            bcRef.current?.postMessage({ type: "open" });
          }}
          className="cursor-pointer flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full border border-float-border bg-float-ink/5 text-float-ink transition-colors duration-[120ms] hover:bg-float-ink/15"
        >
          <ArrowUpRight size={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Stop recording"
          title="Stop recording"
          onClick={() => {
            tauriInvoke("widget_stop");
            bcRef.current?.postMessage({ type: "stop" });
          }}
          className="cursor-pointer flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full bg-pulse/90 text-on-accent transition-colors duration-[120ms] hover:bg-pulse"
        >
          <Square size={10} strokeWidth={0} fill="currentColor" />
        </button>
      </div>
    </>
  );
}
