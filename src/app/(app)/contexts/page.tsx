import { createClient } from "@/lib/supabase/server";
import { ImportClaude } from "./ImportClaude";
import { ContextLibrary } from "./ContextLibrary";
import { PageHeading, PageSubhead } from "@/components/ui/typography";
import { Card } from "@/components/ui/Card";
import type { ChipData } from "@/components/context/ContextChip";

export const dynamic = "force-dynamic";

type Row = ChipData & { created_at: string };

export default async function ContextsPage() {
  const supabase = await createClient();
  const [{ data: contexts }, { data: integrations }] = await Promise.all([
    supabase
      .from("external_contexts")
      .select(
        "id,name,source_type,status,chunks_total,chunks_done,error_message,created_at"
      )
      .order("created_at", { ascending: false }),
    supabase.from("integrations").select("provider"),
  ]);

  const rows = (contexts ?? []) as Row[];
  const connectedIntegrations = Array.from(
    new Set((integrations ?? []).map((i) => i.provider))
  );

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-[30px]">
        <PageHeading>Contexts</PageHeading>
        <PageSubhead>
          External sources you can pull into chat. Chips you add from a meeting
          or preset land here.
        </PageSubhead>
      </header>

      <ContextLibrary
        initialRows={rows}
        connectedIntegrations={connectedIntegrations}
      />

      <Card className="p-[22px] mt-8">
        <h2 className="text-[15px] font-semibold m-0 mb-[6px] text-ink">
          Import from Claude.ai
        </h2>
        <p className="text-[12.5px] text-slate m-0 mb-[14px] leading-[1.5]">
          Export your Claude.ai data → upload the{" "}
          <code className="font-mono text-[11.5px] bg-paper-2 px-[6px] py-px rounded-[3px]">
            conversations.json
          </code>{" "}
          file.
        </p>
        <ImportClaude />
      </Card>
    </div>
  );
}
