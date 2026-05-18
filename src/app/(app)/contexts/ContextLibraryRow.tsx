"use client";

import { useState } from "react";
import { ContextChip, type ChipData } from "@/components/context/ContextChip";
import { DeleteContextButton } from "./DeleteContextButton";

export function ContextLibraryRow({
  initial,
  isLast,
}: {
  initial: ChipData & { created_at: string };
  isLast: boolean;
}) {
  const [chip, setChip] = useState<ChipData>(initial);

  return (
    <div
      className={[
        "flex items-center gap-[14px] px-[18px] py-[14px]",
        isLast ? "" : "border-b border-mist",
      ].join(" ")}
    >
      <div className="flex-1 min-w-0">
        <ContextChip
          chip={chip}
          checked={false}
          onToggle={() => {}}
          onUpdate={setChip}
        />
        <div className="font-mono text-[11px] text-slate mt-[8px] flex gap-[12px]">
          <span className="uppercase tracking-[0.06em] px-[6px] py-px bg-paper-2 rounded-[3px]">
            {chip.source_type}
          </span>
          <span>{new Date(initial.created_at).toLocaleDateString()}</span>
          {chip.status === "error" && chip.error_message && (
            <span className="text-pulse-ink truncate">{chip.error_message}</span>
          )}
        </div>
      </div>
      <DeleteContextButton id={chip.id} />
    </div>
  );
}
