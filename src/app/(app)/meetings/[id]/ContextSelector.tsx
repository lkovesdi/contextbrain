"use client";

import { useState } from "react";
import type { Provider } from "@/lib/composio";
import { Checkbox } from "@/components/ui/Checkbox";
import { Eyebrow } from "@/components/ui/typography";
import { ContextChip, type ChipData } from "@/components/context/ContextChip";
import { ContextSourcePicker } from "@/components/context/ContextSourcePicker";
import { SOURCE_PROVIDERS, type ProviderId } from "@/components/context/sources";

export type Selection = {
  // `include_notes` is the only ambient toggle left — opt-in cross-meeting
  // notes search. Current meeting transcripts are always included implicitly
  // and don't appear on this type.
  include_notes: boolean;
  external_context_ids: string[];
  note_ids: string[];
  space_id: string | null;
  recent_summary_count: number;
  integrations: { provider: Provider }[];
};

export type ExternalContext = { id: string; name: string; source_type: string };

export function ContextSelector({
  selection,
  setSelection,
  chips: initialChips,
  integrations,
  githubConnected: _githubConnected,
  presetName,
}: {
  selection: Selection;
  setSelection: (s: Selection) => void;
  chips: ChipData[];
  integrations: string[];
  /** Currently unused — kept on the prop signature for the upcoming
   *  GitHub-specific UI gate. Underscored to silence lint until wired. */
  githubConnected: boolean;
  presetName?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [chips, setChips] = useState<ChipData[]>(initialChips);

  function setChipChecked(id: string, checked: boolean) {
    setSelection({
      ...selection,
      external_context_ids: checked
        ? Array.from(new Set([...selection.external_context_ids, id]))
        : selection.external_context_ids.filter((x) => x !== id),
    });
  }

  function toggleIntegration(provider: Provider) {
    const has = selection.integrations.some((i) => i.provider === provider);
    setSelection({
      ...selection,
      integrations: has
        ? selection.integrations.filter((i) => i.provider !== provider)
        : [...selection.integrations, { provider }],
    });
  }

  function onChipAdded(chip: ChipData) {
    setChips((cs) => [chip, ...cs.filter((c) => c.id !== chip.id)]);
    setChipChecked(chip.id, true);
  }

  function patchChip(updated: ChipData) {
    setChips((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
  }

  // X click on a `ready`/`error` chip — keep it in the library, just stop
  // referencing it from this meeting.
  function unselectChip(id: string) {
    setChipChecked(id, false);
  }

  // X click on a `queued`/`indexing` chip — wipe the chip entirely. The
  // indexer notices its row is gone between batches and bails out.
  async function cancelChip(id: string) {
    setChips((cs) => cs.filter((c) => c.id !== id));
    setChipChecked(id, false);
    await fetch(`/api/contexts/${id}`, { method: "DELETE" });
  }

  const checkedIds = new Set(selection.external_context_ids);
  const checkedChips = chips.filter((c) => checkedIds.has(c.id));
  const otherChips = chips.filter((c) => !checkedIds.has(c.id));
  // Connected providers covered by the picker (chip-based) vs. integrations
  // we still show as "live" toggles (no chip flow yet, e.g. Figma).
  const pickerProviders = integrations.filter(
    (p): p is ProviderId => p in SOURCE_PROVIDERS
  );
  const liveProviders = integrations.filter((p) => !(p in SOURCE_PROVIDERS));

  const allReady =
    checkedChips.length > 0 && checkedChips.every((c) => c.status === "ready");

  return (
    <div className="bg-bone-2 border border-mist rounded-[10px] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-[14px] py-[9px] bg-transparent border-0 cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-slate-2"
      >
        <span className="flex items-center gap-2">
          Context
          {checkedChips.length > 0 && (
            <span
              className={[
                "font-sans normal-case tracking-normal text-[10.5px]",
                allReady ? "text-echo-ink" : "text-slate",
              ].join(" ")}
            >
              {allReady ? "all sources ready" : "indexing…"}
            </span>
          )}
        </span>
        {presetName && (
          <span className="font-sans text-[11px] font-medium text-cortex-ink bg-cortex-tint px-2 py-[2px] rounded-full normal-case tracking-normal">
            {presetName}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-mist p-3 flex flex-col gap-[12px]">
          <Checkbox
            checked={selection.include_notes}
            onChange={(v) => setSelection({ ...selection, include_notes: v })}
          >
            Also search all my notes
          </Checkbox>

          <div className="flex flex-col gap-2">
            <Eyebrow className="text-[10px]">Sources</Eyebrow>
            <ContextSourcePicker
              providers={pickerProviders}
              onAdded={onChipAdded}
              disabledReason={
                pickerProviders.length === 0
                  ? "Connect GitHub, Jira, or Linear on the Integrations page to add sources."
                  : null
              }
            />
            {checkedChips.length > 0 && (
              <div className="flex flex-wrap gap-[6px] pt-1">
                {checkedChips.map((chip) => (
                  <ContextChip
                    key={chip.id}
                    chip={chip}
                    checked
                    onToggle={() => setChipChecked(chip.id, false)}
                    onRemove={() => unselectChip(chip.id)}
                    onCancel={() => cancelChip(chip.id)}
                    onUpdate={patchChip}
                  />
                ))}
              </div>
            )}
            {otherChips.length > 0 && (
              <details>
                <summary className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2 cursor-pointer select-none hover:text-ink">
                  From your library · {otherChips.length}
                </summary>
                <div className="flex flex-wrap gap-[6px] pt-2">
                  {otherChips.map((chip) => (
                    <ContextChip
                      key={chip.id}
                      chip={chip}
                      checked={false}
                      onToggle={() => setChipChecked(chip.id, true)}
                      onCancel={() => cancelChip(chip.id)}
                      onUpdate={patchChip}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>

          {liveProviders.length > 0 && (
            <div className="flex flex-col gap-1">
              <Eyebrow className="text-[10px]">Live integrations</Eyebrow>
              {liveProviders.map((p) => (
                <Checkbox
                  key={p}
                  checked={selection.integrations.some((i) => i.provider === p)}
                  onChange={() => toggleIntegration(p as Provider)}
                >
                  {p}
                </Checkbox>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
