import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NewMeetingButton } from "./NewMeetingButton";
import { DeleteMeetingButton } from "./DeleteMeetingButton";
import { Eyebrow, PageHeading, PageSubhead } from "@/components/ui/typography";
import { ListCard } from "@/components/ui/Card";
import { SpacePicker } from "./meetings/[id]/SpacePicker";

export const dynamic = "force-dynamic";

type Meeting = {
  id: string;
  title: string;
  summary_title: string | null;
  started_at: string | null;
  ended_at: string | null;
  space_id: string | null;
};

type Space = { id: string; name: string; icon: string | null };

export default async function DashboardPage() {
  const supabase = await createClient();
  const [{ data: meetings }, { data: presets }, { data: spaces }] = await Promise.all([
    supabase
      .from("meetings")
      .select("id,title,summary_title,started_at,ended_at,space_id")
      .order("started_at", { ascending: false }),
    supabase.from("context_presets").select("id,name").order("created_at", { ascending: false }),
    supabase.from("spaces").select("id,name,icon").order("name"),
  ]);

  const list = (meetings ?? []) as Meeting[];
  const spaceList = (spaces ?? []) as Space[];

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-9 flex items-start justify-between gap-4">
        <div>
          <PageHeading>Meetings</PageHeading>
          <PageSubhead>Capture, structure, and chat with your meetings.</PageSubhead>
        </div>
        <NewMeetingButton presets={presets ?? []} />
      </header>

      <Eyebrow className="mb-[10px]">{`Recent · ${list.length}`}</Eyebrow>

      {list.length > 0 ? (
        <ListCard>
          {list.map((m, i) => {
            const live = !m.ended_at;
            return (
              <div
                key={m.id}
                className={[
                  "group flex items-center gap-[14px] px-[18px] py-[14px]",
                  "transition-colors duration-[120ms] ease-[var(--ease-out)] hover:bg-paper-2",
                  i < list.length - 1 ? "border-b border-mist" : "",
                ].join(" ")}
              >
                <Link
                  href={`/meetings/${m.id}`}
                  className="flex items-center gap-[14px] flex-1 min-w-0"
                >
                  <span
                    className={[
                      "w-[7px] h-[7px] rounded-full flex-shrink-0",
                      live
                        ? "bg-pulse [animation:mb-pulse_1.4s_infinite]"
                        : "bg-slate-3",
                    ].join(" ")}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-ink tracking-[-0.005em] truncate">
                      {displayTitle(m)}
                    </div>
                    <div className="font-mono text-[11px] text-slate mt-[3px] flex gap-[14px] truncate">
                      <span>
                        {m.started_at
                          ? new Date(m.started_at).toLocaleString()
                          : "—"}
                      </span>
                      <span>
                        ·{" "}
                        {live ? "in progress" : durationLabel(m.started_at, m.ended_at)}
                      </span>
                    </div>
                  </div>
                </Link>
                <SpacePicker
                  meetingId={m.id}
                  spaces={spaceList}
                  initialSpaceId={m.space_id}
                  variant="compact"
                />
                <Link
                  href={`/meetings/${m.id}`}
                  className="font-mono text-[11px] text-slate-3 whitespace-nowrap hidden md:inline opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Open →
                </Link>
                <DeleteMeetingButton meetingId={m.id} title={displayTitle(m)} />
              </div>
            );
          })}
        </ListCard>
      ) : (
        <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-12 text-center">
          <p className="text-[13px] text-slate">No meetings yet.</p>
          <p className="mt-1 text-[12px] text-slate-2">
            Click <span className="font-medium text-ink-2">New meeting</span> to start one.
          </p>
        </div>
      )}
    </div>
  );
}

function displayTitle(m: Meeting) {
  const userEdited = m.title && m.title.trim() && m.title !== "Untitled meeting";
  if (userEdited) return m.title;
  return m.summary_title?.trim() || m.title;
}

function durationLabel(start: string | null, end: string | null) {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}
