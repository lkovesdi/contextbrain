"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Eyebrow } from "@/components/ui/typography";
import { SummaryMarkdown } from "@/components/ui/SummaryMarkdown";
import { Button } from "@/components/ui/Button";

export function SummarySection({
  meetingId,
  initialTitle,
  initialSummary,
}: {
  meetingId: string;
  initialTitle: string | null;
  initialSummary: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Render local state during regeneration so the user sees the new summary
  // immediately, without waiting on the round-trip refresh.
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/summary`, {
        method: "POST",
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? `Regenerate failed (${res.status})`);
        return;
      }
      if (typeof j.title === "string") setTitle(j.title);
      if (typeof j.summary === "string") setSummary(j.summary);
      // Re-fetch server data so any related panels (sidebar, etc.) update too.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regenerate failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-[10px] border border-mist bg-bone-2 p-5">
      <div className="flex items-center justify-between mb-3">
        <Eyebrow>Summary</Eyebrow>
        <Button
          variant="secondary"
          size="sm"
          onClick={regenerate}
          disabled={busy}
          leftIcon={
            <RefreshCw
              size={12}
              strokeWidth={1.6}
              className={busy ? "animate-spin" : ""}
            />
          }
        >
          {busy ? "Regenerating…" : "Regenerate"}
        </Button>
      </div>

      {title && (
        <h2 className="font-display text-[22px] tracking-[-0.012em] text-ink m-0 mb-4 leading-[1.25]">
          {title}
        </h2>
      )}
      <SummaryMarkdown source={summary} />

      {error && (
        <p className="mt-3 rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12px] text-pulse-ink">
          {error}
        </p>
      )}
    </div>
  );
}
