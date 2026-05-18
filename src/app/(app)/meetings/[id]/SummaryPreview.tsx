import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/typography";
import { SummarySection } from "./SummarySection";

// Calm read-mode for ended meetings: shows the summary front-and-center, with
// a "Continue meeting" escape hatch in the header that flips the same URL
// into workspace mode via ?continue=1.
export function SummaryPreview({
  meetingId,
  title,
  summaryTitle,
  summary,
  startedAt,
  endedAt,
  noteCount,
  presetName,
}: {
  meetingId: string;
  title: string;
  summaryTitle: string | null;
  summary: string;
  startedAt: string | null;
  endedAt: string | null;
  noteCount: number;
  presetName: string | null;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper">
      <header className="flex items-center justify-between gap-[14px] px-[22px] py-[14px] border-b border-mist bg-bone-2">
        <div className="flex items-center gap-[14px] min-w-0 overflow-hidden">
          <Link
            href="/"
            className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.07em] text-slate hover:text-ink transition-colors flex-shrink-0"
          >
            <ChevronLeft size={12} strokeWidth={1.6} />
            Meetings
          </Link>
          <span className="text-mist-2 flex-shrink-0">/</span>
          <span className="text-[14px] font-medium text-ink truncate">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {presetName && (
            <span className="font-sans text-[11px] font-medium text-cortex-ink bg-cortex-tint px-2 py-[2px] rounded-full">
              {presetName}
            </span>
          )}
          <Link href={`/meetings/${meetingId}?continue=1`}>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Pencil size={12} strokeWidth={1.6} />}
            >
              Continue meeting
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-10 py-12">
          {/* Calm metadata strip — date, duration, note count */}
          <Eyebrow className="mb-[10px]">{metaLine(startedAt, endedAt, noteCount)}</Eyebrow>

          {summaryTitle && (
            <h1 className="font-display text-[44px] font-normal leading-[1.05] tracking-[-0.018em] text-ink m-0 mb-[24px]">
              {summaryTitle}
            </h1>
          )}

          <SummarySection
            meetingId={meetingId}
            initialTitle={null /* title rendered above as the display heading */}
            initialSummary={summary}
          />
        </div>
      </main>
    </div>
  );
}

function metaLine(
  startedAt: string | null,
  endedAt: string | null,
  noteCount: number
): string {
  const parts: string[] = [];
  if (startedAt) {
    parts.push(
      new Date(startedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    );
  }
  if (startedAt && endedAt) {
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    if (ms >= 60_000) {
      const m = Math.round(ms / 60_000);
      parts.push(m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`);
    } else if (ms > 0) {
      parts.push(`${Math.round(ms / 1000)}s`);
    }
  }
  if (noteCount > 0) parts.push(`${noteCount} note${noteCount === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Meeting";
}
