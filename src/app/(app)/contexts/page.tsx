import { createClient } from "@/lib/supabase/server";
import { ImportClaude } from "./ImportClaude";
import { ContextLibraryRow } from "./ContextLibraryRow";
import { Eyebrow, PageHeading, PageSubhead } from "@/components/ui/typography";
import { Card, ListCard } from "@/components/ui/Card";
import type { ChipData } from "@/components/context/ContextChip";

export const dynamic = "force-dynamic";

type Row = ChipData & { created_at: string };

export default async function ContextsPage() {
  const supabase = await createClient();
  const { data: contexts } = await supabase
    .from("external_contexts")
    .select(
      "id,name,source_type,status,chunks_total,chunks_done,error_message,created_at"
    )
    .order("created_at", { ascending: false });

  const rows = (contexts ?? []) as Row[];

  return (
    <div className="mx-auto w-full max-w-[880px] px-10 py-12">
      <header className="mb-[30px]">
        <PageHeading>Contexts</PageHeading>
        <PageSubhead>
          External sources you can pull into chat. Chips you add from a meeting
          or preset land here.
        </PageSubhead>
      </header>

      <Card className="p-[22px] mb-8">
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

      <Eyebrow className="mb-[10px]">Saved · {rows.length}</Eyebrow>

      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-10 text-center text-[13px] text-slate">
          No contexts yet. Add one from a meeting or preset.
        </div>
      ) : (
        <ListCard>
          {rows.map((c, i) => (
            <ContextLibraryRow
              key={c.id}
              initial={c}
              isLast={i === rows.length - 1}
            />
          ))}
        </ListCard>
      )}
    </div>
  );
}
