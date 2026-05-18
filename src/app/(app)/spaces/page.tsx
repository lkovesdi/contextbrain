import { createClient } from "@/lib/supabase/server";
import { PageHeading, PageSubhead } from "@/components/ui/typography";
import { SpacesManager, type SpaceRow } from "./SpacesManager";

export const dynamic = "force-dynamic";

export default async function SpacesPage() {
  const supabase = await createClient();
  const [{ data: spaces }, { data: presets }, { data: meetingCounts }] = await Promise.all([
    supabase
      .from("spaces")
      .select("id,name,icon,description,default_preset_id,created_at,updated_at")
      .order("created_at", { ascending: false }),
    supabase.from("context_presets").select("id,name").order("name"),
    supabase.from("meetings").select("space_id").not("space_id", "is", null),
  ]);

  // Roll up meeting counts per space so the list can show "12 meetings"
  // without a separate query per row.
  const counts = new Map<string, number>();
  for (const m of meetingCounts ?? []) {
    if (!m.space_id) continue;
    counts.set(m.space_id, (counts.get(m.space_id) ?? 0) + 1);
  }
  const rows: SpaceRow[] = (spaces ?? []).map((s) => ({
    ...s,
    meeting_count: counts.get(s.id) ?? 0,
  }));

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-[30px]">
        <PageHeading>Spaces</PageHeading>
        <PageSubhead>
          Bucket meetings by customer or project so context accumulates over time.
        </PageSubhead>
      </header>

      <SpacesManager spaces={rows} presets={presets ?? []} />
    </div>
  );
}
