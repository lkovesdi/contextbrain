import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Eyebrow } from "@/components/ui/typography";
import { ListCard } from "@/components/ui/Card";
import { SpaceHeader } from "./SpaceHeader";
import { NewMeetingInSpaceButton } from "./NewMeetingInSpaceButton";

export const dynamic = "force-dynamic";

type Meeting = {
  id: string;
  title: string;
  summary_title: string | null;
  started_at: string | null;
  ended_at: string | null;
};

type Note = {
  id: string;
  content: string;
  is_checked: boolean;
  created_at: string;
  meeting_id: string | null;
  meeting: { title: string; summary_title: string | null } | null;
};

export default async function SpaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: space }, { data: meetings }, { data: notes }, { data: presets }] =
    await Promise.all([
      supabase
        .from("spaces")
        .select("id,name,icon,description,default_preset_id")
        .eq("id", id)
        .single(),
      supabase
        .from("meetings")
        .select("id,title,summary_title,started_at,ended_at")
        .eq("space_id", id)
        .order("started_at", { ascending: false }),
      supabase
        .from("notes")
        .select(
          "id,content,is_checked,created_at,meeting_id,meeting:meetings(title,summary_title)"
        )
        .eq("space_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("context_presets").select("id,name").order("name"),
    ]);

  if (!space) notFound();
  const list = (meetings ?? []) as Meeting[];
  const noteList = (notes ?? []) as unknown as Note[];

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <Link
        href="/spaces"
        className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.07em] text-slate hover:text-ink mb-[18px]"
      >
        <ChevronLeft size={12} strokeWidth={1.6} />
        Spaces
      </Link>

      <SpaceHeader space={space} presets={presets ?? []} />

      <div className="mt-9 mb-[10px] flex items-center justify-between">
        <Eyebrow>{`Meetings · ${list.length}`}</Eyebrow>
        <NewMeetingInSpaceButton spaceId={space.id} spaceName={space.name} />
      </div>

      {list.length > 0 ? (
        <ListCard>
          {list.map((m, i) => {
            const live = !m.ended_at;
            const display = m.summary_title?.trim() || m.title;
            return (
              <Link
                key={m.id}
                href={`/meetings/${m.id}`}
                className={[
                  "flex items-center gap-[14px] px-[18px] py-[14px]",
                  "transition-colors duration-[120ms] ease-[var(--ease-out)] hover:bg-paper-2",
                  i < list.length - 1 ? "border-b border-mist" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "w-[7px] h-[7px] rounded-full flex-shrink-0",
                    live ? "bg-pulse [animation:mb-pulse_1.4s_infinite]" : "bg-slate-3",
                  ].join(" ")}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-ink tracking-[-0.005em] truncate">
                    {display}
                  </div>
                  <div className="font-mono text-[11px] text-slate mt-[3px] truncate">
                    {m.started_at ? new Date(m.started_at).toLocaleString() : "—"}
                  </div>
                </div>
                <span className="font-mono text-[11px] text-slate-3 whitespace-nowrap">
                  Open →
                </span>
              </Link>
            );
          })}
        </ListCard>
      ) : (
        <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-12 text-center">
          <p className="text-[13px] text-slate">No meetings filed here yet.</p>
          <p className="mt-1 text-[12px] text-slate-2">
            Open any meeting and use <span className="font-medium text-ink-2">Move to space</span> in the header.
          </p>
        </div>
      )}

      {noteList.length > 0 && (
        <div className="mt-10">
          <Eyebrow className="mb-[10px]">{`Notes · ${noteList.length}`}</Eyebrow>
          <ListCard>
            {noteList.map((n, i) => {
              const meetingTitle =
                n.meeting?.summary_title?.trim() || n.meeting?.title || null;
              return (
                <div
                  key={n.id}
                  className={[
                    "px-[18px] py-[12px]",
                    i < noteList.length - 1 ? "border-b border-mist" : "",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "text-[13px] text-ink leading-[1.5] whitespace-pre-wrap",
                      n.is_checked ? "line-through text-slate-3" : "",
                    ].join(" ")}
                  >
                    {n.content}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate-3 mt-[6px] flex items-center gap-[10px]">
                    <span>{new Date(n.created_at).toLocaleString()}</span>
                    {n.meeting_id && meetingTitle && (
                      <>
                        <span>·</span>
                        <Link
                          href={`/meetings/${n.meeting_id}`}
                          className="hover:text-ink transition-colors truncate normal-case tracking-normal"
                        >
                          {meetingTitle}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </ListCard>
        </div>
      )}
    </div>
  );
}
