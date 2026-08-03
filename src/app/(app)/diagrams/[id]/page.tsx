import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { DiagramChange, DiagramGraph, DiagramRepoRef } from "@/lib/diagrams";
import { DiagramWorkbench } from "./DiagramWorkbench";

export const dynamic = "force-dynamic";

export default async function DiagramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: diagram }, { data: versions }] = await Promise.all([
    supabase
      .from("diagrams")
      .select("id,title,repos,current_version,created_at,updated_at")
      .eq("id", id)
      .single(),
    supabase
      .from("diagram_versions")
      .select("id,version,graph,summary,changes,created_at")
      .eq("diagram_id", id)
      .order("version", { ascending: true }),
  ]);
  if (!diagram) notFound();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-10 py-10">
      <DiagramWorkbench
        diagram={{
          id: diagram.id,
          title: diagram.title,
          repos: (diagram.repos ?? []) as DiagramRepoRef[],
          current_version: diagram.current_version,
          created_at: diagram.created_at,
          updated_at: diagram.updated_at,
        }}
        versions={(versions ?? []).map((v) => ({
          id: v.id,
          version: v.version,
          graph: v.graph as DiagramGraph,
          summary: v.summary,
          changes: (v.changes ?? []) as DiagramChange[],
          created_at: v.created_at,
        }))}
      />
    </div>
  );
}
