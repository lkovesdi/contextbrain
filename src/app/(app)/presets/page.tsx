import { createClient } from "@/lib/supabase/server";
import { PresetsManager, type ExistingPreset } from "./PresetsManager";
import { PageHeading, PageSubhead } from "@/components/ui/typography";
import type { ChipData } from "@/components/context/ContextChip";

export const dynamic = "force-dynamic";

export default async function PresetsPage() {
  const supabase = await createClient();
  const [
    { data: presets },
    { data: contexts },
    { data: integrations },
    { data: spaces },
    { data: notes },
  ] = await Promise.all([
    supabase
      .from("context_presets")
      .select("id,name,sources,created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("external_contexts")
      .select(
        "id,name,source_type,status,chunks_total,chunks_done,error_message"
      )
      .order("created_at", { ascending: false }),
    supabase.from("integrations").select("provider"),
    supabase.from("spaces").select("id,name,icon").order("name"),
    // Pull the user's recent notes for the picker, joined with the meeting
    // title so the user can recognize where each note came from. The cap is
    // intentionally generous — the in-component search filters further.
    supabase
      .from("notes")
      .select("id,content,meeting_id,created_at,meetings(title)")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const providerSet = new Set((integrations ?? []).map((i) => i.provider));

  type NoteRow = {
    id: string;
    content: string;
    meeting_id: string | null;
    created_at: string;
    meetings: { title: string } | { title: string }[] | null;
  };
  const noteOptions = ((notes ?? []) as NoteRow[]).map((n) => {
    // Supabase typings sometimes give back the relation as an array even
    // when it's a many-to-one. Normalize so we always read a single title.
    const rel = Array.isArray(n.meetings) ? n.meetings[0] : n.meetings;
    return {
      id: n.id,
      content: n.content,
      meeting_id: n.meeting_id,
      meeting_title: rel?.title ?? null,
      created_at: n.created_at,
    };
  });

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-[30px]">
        <PageHeading>Presets</PageHeading>
        <PageSubhead>
          Bundle the right context together so chat is primed the moment your meeting starts.
        </PageSubhead>
      </header>

      <PresetsManager
        presets={(presets ?? []) as ExistingPreset[]}
        chips={(contexts ?? []) as ChipData[]}
        connectedIntegrations={Array.from(providerSet)}
        spaces={(spaces ?? []) as { id: string; name: string; icon: string | null }[]}
        notes={noteOptions}
      />
    </div>
  );
}
