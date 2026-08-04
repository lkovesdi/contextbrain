import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Recorder } from "./Recorder";
import { Notes } from "./Notes";
import { ChatPanel } from "./ChatPanel";
import { MeetingTitle } from "./MeetingTitle";
import { SpacePicker } from "./SpacePicker";
import { InviteButton } from "./InviteButton";
import { Eyebrow } from "@/components/ui/typography";
import { SummarySection } from "./SummarySection";
import { SummaryPreview } from "./SummaryPreview";
import { MeetingTags } from "./MeetingTags";
import type { ChipData } from "@/components/context/ContextChip";
import type { Tag } from "@/lib/tags";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ continue?: string }>;
}) {
  const { id } = await params;
  const { continue: continueFlag } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .single();
  if (!meeting) notFound();

  // Preview mode: an ended meeting with a summary opens into the read-only
  // summary view. The "Continue meeting" button adds ?continue=1 to escape
  // back into the full workspace.
  const wantsContinue = continueFlag === "1";
  const showPreview = !!meeting.summary && !!meeting.ended_at && !wantsContinue;

  if (showPreview) {
    const [
      { data: notesForCount },
      presetRow,
      { data: ticketsForPreview },
      { data: previewIntegrations },
      { data: previewTagRows },
    ] = await Promise.all([
      supabase
        .from("notes")
        .select("id", { count: "exact", head: false })
        .eq("meeting_id", id),
      meeting.context_preset_id
        ? supabase
            .from("context_presets")
            .select("name")
            .eq("id", meeting.context_preset_id)
            .single()
        : Promise.resolve({ data: null as { name: string } | null }),
      supabase
        .from("meeting_tickets")
        .select("id,provider,external_key,external_url,title,suggestion_title")
        .eq("meeting_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("integrations").select("provider"),
      supabase
        .from("meeting_tags")
        .select("tag:tags(id,label_key,value)")
        .eq("meeting_id", id)
        .order("created_at", { ascending: true }),
    ]);
    const previewTags = ((previewTagRows ?? []) as unknown as { tag: Tag | null }[])
      .map((r) => r.tag)
      .filter((t): t is Tag => !!t);
    const ticketProviders = ((previewIntegrations ?? []) as { provider: string }[])
      .map((i) => i.provider)
      .filter((p): p is "jira" | "linear" => p === "jira" || p === "linear");
    return (
      <SummaryPreview
        meetingId={meeting.id}
        title={meeting.title}
        summaryTitle={meeting.summary_title ?? null}
        summary={meeting.summary}
        startedAt={meeting.started_at ?? null}
        endedAt={meeting.ended_at ?? null}
        noteCount={(notesForCount ?? []).length}
        presetName={presetRow?.data?.name ?? null}
        summaryExtras={meeting.summary_extras ?? {}}
        createdTickets={ticketsForPreview ?? []}
        ticketProviders={ticketProviders}
        tags={previewTags}
      />
    );
  }

  const [
    { data: transcripts },
    { data: notes },
    { data: contexts },
    { data: integrations },
    { data: spaces },
    presetRow,
    { data: createdTickets },
    { data: tagRows },
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
      <header className="flex items-center justify-between gap-[14px] px-[22px] py-[14px] border-b border-mist bg-bone-2">
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

      <div className="flex items-center gap-[10px] px-[22px] py-[8px] border-b border-mist bg-bone-2">
        <Eyebrow className="flex-shrink-0">Tags</Eyebrow>
        <MeetingTags meetingId={meeting.id} initialTags={meetingTags} />
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1.15fr_1fr_1.2fr]">
        <section className="min-h-0 overflow-y-auto border-b border-mist lg:border-b-0 lg:border-r p-[22px]">
          <Eyebrow className="mb-[14px]">Recorder</Eyebrow>
          <Recorder
            meetingId={meeting.id}
            title={meeting.summary_title ?? meeting.title ?? "Meeting"}
            initialLines={transcripts ?? []}
            initialSpeakerNames={
              (meeting.speaker_names ?? {}) as Record<string, string>
            }
            initialSummaryStatus={meeting.summary_status ?? null}
          />
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
        </section>

        <section className="min-h-0 overflow-y-auto border-b border-mist lg:border-b-0 lg:border-r p-[22px]">
          <Eyebrow className="mb-[14px]">Notes</Eyebrow>
          <Notes meetingId={meeting.id} initialNotes={notes ?? []} />
        </section>

        <section className="min-h-0 overflow-hidden p-[22px] flex flex-col">
          <Eyebrow className="mb-[14px]">Chat</Eyebrow>
          <ChatPanel
            meetingId={meeting.id}
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
          />
        </section>
      </div>
    </div>
  );
}
