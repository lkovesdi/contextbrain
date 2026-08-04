"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Eyebrow } from "@/components/ui/typography";
import { SummaryMarkdown } from "@/components/ui/SummaryMarkdown";
import { Button } from "@/components/ui/Button";
import {
  SummaryExtras,
  type CreatedTicket,
  type SummaryExtrasData,
} from "./SummaryExtras";
import type { TicketProvider } from "@/lib/tickets";

export function SummarySection({
  meetingId,
  initialTitle,
  initialSummary,
  initialExtras = {},
  initialCreatedTickets = [],
  integrations = [],
}: {
  meetingId: string;
  initialTitle: string | null;
  initialSummary: string;
  initialExtras?: SummaryExtrasData;
  initialCreatedTickets?: CreatedTicket[];
  integrations?: TicketProvider[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Render local state during regeneration so the user sees the new summary
  // immediately, without waiting on the round-trip refresh.
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary);
  const [extras, setExtras] = useState<SummaryExtrasData>(initialExtras);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/summary`, {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `Regenerate failed (${res.status})`);
        return;
      }
      // 202 — generation runs server-side (it survives leaving this page).
      // Poll until it lands, then adopt the fresh summary in place. The cap
      // only bounds this page's spinner; the run itself keeps going.
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/meetings/${meetingId}/summary`);
        if (!poll.ok) continue;
        const s = await poll.json();
        if (s.status === "error") {
          setError(s.error ?? "Regenerate failed");
          return;
        }
        if (!s.status) {
          if (typeof s.title === "string") setTitle(s.title);
          if (typeof s.summary === "string") setSummary(s.summary);
          if (s.extras && typeof s.extras === "object") setExtras(s.extras);
          // Re-fetch server data so any related panels (sidebar, etc.) update too.
          router.refresh();
          return;
        }
      }
      setError("Still generating — check back in a minute.");
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

      <SummaryExtras
        meetingId={meetingId}
        extras={extras}
        integrations={integrations}
        initialCreatedTickets={initialCreatedTickets}
      />

      {error && (
        <p className="mt-3 rounded-[6px] border border-pulse bg-pulse-tint px-3 py-2 text-[12px] text-pulse-ink">
          {error}
        </p>
      )}
    </div>
  );
}
