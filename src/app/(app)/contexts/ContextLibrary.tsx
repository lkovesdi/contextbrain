"use client";

import { useState } from "react";
import { ContextSourcePicker } from "@/components/context/ContextSourcePicker";
import { SOURCE_PROVIDERS, type ProviderId } from "@/components/context/sources";
import type { ChipData } from "@/components/context/ContextChip";
import { ContextLibraryRow } from "./ContextLibraryRow";
import { Card, ListCard } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/typography";

type Row = ChipData & { created_at: string };

export function ContextLibrary({
  initialRows,
  connectedIntegrations,
}: {
  initialRows: Row[];
  connectedIntegrations: string[];
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);

  const pickerProviders = connectedIntegrations.filter(
    (p): p is ProviderId => p in SOURCE_PROVIDERS
  );

  function onChipAdded(chip: ChipData) {
    // The API returns created_at on the row, but ChipData drops it on cast.
    // Read it back off the raw object if present; otherwise stamp `now` so
    // the row at least sorts to the top.
    const created =
      (chip as unknown as { created_at?: string }).created_at ??
      new Date().toISOString();
    setRows((rs) => [
      { ...chip, created_at: created },
      ...rs.filter((r) => r.id !== chip.id),
    ]);
  }

  return (
    <>
      <Card className="p-[22px] mb-8">
        <h2 className="text-[15px] font-semibold m-0 mb-[6px] text-ink">
          Add from a connected source
        </h2>
        <p className="text-[12.5px] text-slate m-0 mb-[14px] leading-[1.5]">
          Pull in a GitHub repo, Jira project, Linear team, or Figma file. New
          contexts index in the background.
        </p>
        <ContextSourcePicker
          providers={pickerProviders}
          onAdded={onChipAdded}
          disabledReason={
            pickerProviders.length === 0
              ? "Connect GitHub, Jira, Linear, or Figma on the Integrations page to add sources."
              : null
          }
        />
      </Card>

      <Eyebrow className="mb-[10px]">Saved · {rows.length}</Eyebrow>

      {rows.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-10 text-center text-[13px] text-slate">
          No contexts yet. Add one from the picker above, a meeting, or a
          preset.
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
    </>
  );
}
