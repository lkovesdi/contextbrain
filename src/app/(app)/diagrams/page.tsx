import { createClient } from "@/lib/supabase/server";
import { PageHeading, PageSubhead } from "@/components/ui/typography";
import type { DiagramRepoRef } from "@/lib/diagrams";
import { DiagramsManager, type DiagramListRow } from "./DiagramsManager";

export const dynamic = "force-dynamic";

export default async function DiagramsPage() {
  const supabase = await createClient();
  const { data: diagrams } = await supabase
    .from("diagrams")
    .select("id,title,repos,current_version,created_at,updated_at")
    .order("updated_at", { ascending: false });

  // One extra query pulls the latest summary per diagram for the card blurbs.
  const ids = (diagrams ?? []).map((d) => d.id);
  const summaries = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: versions } = await supabase
      .from("diagram_versions")
      .select("diagram_id,version,summary")
      .in("diagram_id", ids);
    const currentOf = new Map((diagrams ?? []).map((d) => [d.id, d.current_version]));
    for (const v of versions ?? []) {
      if (v.version === currentOf.get(v.diagram_id)) summaries.set(v.diagram_id, v.summary);
    }
  }

  const rows: DiagramListRow[] = (diagrams ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    repos: (d.repos ?? []) as DiagramRepoRef[],
    current_version: d.current_version,
    created_at: d.created_at,
    updated_at: d.updated_at,
    latest_summary: summaries.get(d.id) ?? null,
  }));

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-[30px]">
        <PageHeading>Diagrams</PageHeading>
        <PageSubhead>
          Living architecture diagrams generated from your repos — regenerate after changes
          and compare versions to see how the system evolved.
        </PageSubhead>
      </header>

      <DiagramsManager diagrams={rows} />
    </div>
  );
}
