import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { MeetingWorkspace } from "./MeetingWorkspace";
import { MeetingTitle } from "./MeetingTitle";
import { SpacePicker } from "./SpacePicker";
import { InviteButton } from "./InviteButton";
import { SummarySection } from "./SummarySection";
import { PrdSection } from "./PrdSection";
import type { PrdArtifact } from "@/lib/prd";
import type { ResearchRow } from "@/lib/scout";
import type { ChipData } from "@/components/context/ContextChip";
import type { Tag } from "@/lib/tags";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthUser(supabase);
  if (!user) return null;

  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single();
  if (!meeting) notFound();

  const [
    { data: transcripts },
    { data: notes },
    { data: contexts },
    { data: integrations },
    { data: spaces },
    presetRow,
    { data: createdTickets },
    { data: tagRows },
    { data: researchRows },
  ] = await Promise.all([
    supabase
      .from("transcripts")
      .select("id,speaker,content,created_at")
      .eq("meeting_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("notes")
      .select("id,content,is_checked,created_at")
      .eq("meeting_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("external_contexts")
      .select(
        "id,name,source_type,status,chunks_total,chunks_done,error_message"
      )
      .order("created_at", { ascending: false }),
    supabase.from("integrations").select("provider"),
    supabase.from("spaces").select("id,name,icon").order("name"),
    meeting.context_preset_id
      ? supabase
          .from("context_presets")
          .select("name,sources")
          .eq("id", meeting.context_preset_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("meeting_tickets")
      .select("id,provider,external_key,external_url,title,suggestion_title")
      .eq("meeting_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("meeting_tags")
      .select("tag:tags(id,label_key,value)")
      .eq("meeting_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("meeting_research")
      .select("id,topic,status,memo,created_at")
      .eq("meeting_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const presetSources = presetRow?.data?.sources ?? null;
  const presetName = presetRow?.data?.name ?? null;
  const integrationProviders = (integrations ?? []).map((i) => i.provider);
  const ticketProviders = integrationProviders.filter(
    (p): p is "jira" | "linear" => p === "jira" || p === "linear"
  );
  const meetingTags = ((tagRows ?? []) as unknown as { tag: Tag | null }[])
    .map((r) => r.tag)
    .filter((t): t is Tag => !!t);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* pt inset: in the desktop app the top 28px is the native drag strip —
          clicks there never reach the page, so the header must start below it
          (same convention as the Sidebar). */}
      <header className="flex items-center justify-between gap-[14px] px-[22px] py-[14px] pt-[calc(14px+var(--titlebar-inset,0px))] border-b border-mist bg-bone-2">
        <div className="flex items-center gap-[14px] min-w-0 overflow-hidden">
          <Link
            href="/meetings"
            className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.07em] text-slate hover:text-ink transition-colors flex-shrink-0"
          >
            <ChevronLeft size={12} strokeWidth={1.6} />
            Meetings
          </Link>
          <span className="text-mist-2 flex-shrink-0">/</span>
          <MeetingTitle
            id={meeting.id}
            initialTitle={meeting.title}
            initialSummaryTitle={meeting.summary_title ?? null}
          />
        </div>
        <div className="flex items-center gap-3">
          <SpacePicker
            meetingId={meeting.id}
            spaces={(spaces ?? []) as { id: string; name: string; icon: string | null }[]}
            initialSpaceId={meeting.space_id ?? null}
          />
          <InviteButton
            meetingId={meeting.id}
            initialToken={meeting.share_token ?? null}
          />
        </div>
      </header>

      <MeetingWorkspace
        meetingId={meeting.id}
        title={meeting.summary_title ?? meeting.title ?? "Meeting"}
        mode={meeting.mode ?? "standard"}
        initialSummaryStatus={meeting.summary_status ?? null}
        initialLines={transcripts ?? []}
        initialSpeakerNames={
          (meeting.speaker_names ?? {}) as Record<string, string>
        }
        initialNotes={notes ?? []}
        initialResearch={(researchRows ?? []) as ResearchRow[]}
        chips={(contexts ?? []) as ChipData[]}
        integrations={integrationProviders}
        githubConnected={integrationProviders.includes("github")}
        presetSources={presetSources}
        presetName={presetName}
        tags={meetingTags}
        initialPinnedImages={
          (meeting.pinned_summary_images ?? []) as {
            url: string;
            alt: string | null;
            label: string | null;
          }[]
        }
        summarySlot={
          meeting.prd || meeting.summary ? (
            <>
              {meeting.prd && <PrdSection prd={meeting.prd as PrdArtifact} />}
              {meeting.summary && (
                <SummarySection
                  meetingId={meeting.id}
                  initialTitle={meeting.summary_title ?? null}
                  initialSummary={meeting.summary}
                  initialExtras={meeting.summary_extras ?? {}}
                  initialCreatedTickets={createdTickets ?? []}
                  integrations={ticketProviders}
                />
              )}
            </>
          ) : null
        }
      />
    </div>
  );
}
