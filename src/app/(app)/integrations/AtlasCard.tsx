"use client";

import { useEffect, useState } from "react";
import { Map, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

type Counts = { total: number; ready: number; pending: number; errored: number };

// The repo-atlas cold start: one button that maps every repo the GitHub
// connection can see into model-written index cards. The scan runs as a
// client-driven loop of bounded batches, so it survives being slow and
// resumes cleanly if interrupted — just press the button again.
export function AtlasCard({ githubConnected }: { githubConnected: boolean }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/atlas");
        if (res.ok && !cancelled) setCounts(await res.json());
      } catch {
        // status is cosmetic; the scan button still works
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function scan(rebuild: boolean) {
    setScanning(true);
    setError(null);
    try {
      let res = await fetch("/api/atlas/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discover: true, rebuild }),
      });
      let body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Scan failed");
      setCounts(body);
      // Continue in bounded batches until nothing is pending. The guard is a
      // runaway stop, not a expected limit (60 × 5 repos ≫ the discover cap).
      let guard = 0;
      while (body.pending > 0 && guard++ < 60) {
        res = await fetch("/api/atlas/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Scan failed");
        setCounts(body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  const total = counts?.total ?? 0;
  const ready = counts?.ready ?? 0;
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;

  return (
    <div className="rounded-[14px] border border-mist bg-bone-2 p-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-[14px]">
        <div className="flex min-w-0 gap-[12px]">
          <span className="grid h-[34px] w-[34px] flex-shrink-0 place-items-center rounded-[9px] bg-cortex-tint text-cortex">
            <Map size={16} strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <h3 className="m-0 text-[14px] font-medium text-ink">Repo atlas</h3>
            <p className="m-0 mt-[3px] max-w-[520px] text-[12.5px] leading-snug text-slate">
              A model-written map of every repo your GitHub connection can see.
              PRD-mode meetings use it to route client asks to the right codebase —
              no repo-picking required.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-[8px]">
          {total > 0 && !scanning && (
            <Button variant="ghost" size="sm" onClick={() => void scan(true)}>
              Rebuild all
            </Button>
          )}
          <Button
            variant={total === 0 ? "primary" : "secondary"}
            size="sm"
            disabled={!githubConnected || scanning}
            onClick={() => void scan(false)}
            leftIcon={
              <RefreshCw size={12} strokeWidth={1.8} className={scanning ? "animate-spin" : ""} />
            }
          >
            {scanning
              ? `Building cards… ${ready}/${total || "?"}`
              : total === 0
                ? "Scan my GitHub"
                : "Refresh atlas"}
          </Button>
        </div>
      </div>

      {total > 0 && (
        <div className="mt-[14px]">
          <div className="h-[4px] overflow-hidden rounded-full bg-mist">
            <div
              className="h-full rounded-full bg-cortex transition-[width] duration-[300ms] ease-[var(--ease-out)]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="m-0 mt-[6px] font-mono text-[10.5px] uppercase tracking-[0.06em] text-slate-2">
            {ready} of {total} repos mapped
            {counts && counts.errored > 0 ? ` · ${counts.errored} failed (retried on next scan)` : ""}
          </p>
        </div>
      )}

      {!githubConnected && (
        <p className="m-0 mt-[10px] text-[12px] text-slate-2">
          Connect GitHub above to build the atlas.
        </p>
      )}
      {error && <p className="m-0 mt-[10px] text-[12.5px] text-pulse">{error}</p>}
    </div>
  );
}
