"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, SlidersHorizontal, X } from "lucide-react";
import type { Provider } from "@/lib/composio";
import { Checkbox } from "@/components/ui/Checkbox";
import { Eyebrow } from "@/components/ui/typography";
import { Popover } from "@/components/ui/Popover";
import { ContextChip, type ChipData } from "@/components/context/ContextChip";
import { ContextSourcePicker } from "@/components/context/ContextSourcePicker";
import { SOURCE_PROVIDERS, type ProviderId } from "@/components/context/sources";
import { tagDisplay, type Tag } from "@/lib/tags";

export type Selection = {
  // `include_notes` is the only ambient toggle left — opt-in cross-meeting
  // notes search. Current meeting transcripts are always included implicitly
  // and don't appear on this type.
  include_notes: boolean;
  external_context_ids: string[];
  note_ids: string[];
  space_id: string | null;
  // The meeting's own applied tags, pulled forward for cross-meeting topic
  // continuity. Seeded from the meeting and not user-toggled here.
  tag_ids: string[];
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
  tags = [],
  compact = false,
  align = "start",
}: {
  selection: Selection;
  setSelection: (s: Selection) => void;
  chips: ChipData[];
  integrations: string[];
  /** Currently unused — kept on the prop signature for the upcoming
   *  GitHub-specific UI gate. Underscored to silence lint until wired. */
  githubConnected: boolean;
  presetName?: string | null;
  /** Tags already applied to this meeting — seed the picker's display so the
   *  pre-selected chips render without waiting on the library fetch. */
  tags?: Tag[];
  /** Icon-only trigger for tight rows; the summary moves into the tooltip and
   *  a dot marks that sources are selected. */
  compact?: boolean;
  align?: "start" | "end";
}) {
  const [chips, setChips] = useState<ChipData[]>(initialChips);

  // The full tag library, lazily fetched the first time the picker opens.
  const [tagLibrary, setTagLibrary] = useState<Tag[] | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  useEffect(() => {
    if (!tagPickerOpen || tagLibrary !== null) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/tags", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      if (!cancelled) setTagLibrary((await res.json()) as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [tagPickerOpen, tagLibrary]);

  function addTag(id: string) {
    setSelection({
      ...selection,
      tag_ids: Array.from(new Set([...selection.tag_ids, id])),
    });
    setTagQuery("");
  }

  function removeTag(id: string) {
    setSelection({
      ...selection,
      tag_ids: selection.tag_ids.filter((x) => x !== id),
    });
  }

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

  // Resolve selected tag ids to display objects from whatever we know: the
  // meeting's own tags (passed in) plus the lazily-fetched library.
  const knownTags = new Map<string, Tag>();
  for (const t of tags) knownTags.set(t.id, t);
  for (const t of tagLibrary ?? []) knownTags.set(t.id, t);
  const selectedTags = selection.tag_ids
    .map((id) => knownTags.get(id))
    .filter((t): t is Tag => !!t);
  const selectedTagIds = new Set(selection.tag_ids);
  const availableTags = (tagLibrary ?? [])
    .filter((t) => !selectedTagIds.has(t.id))
    .filter(
      (t) =>
        !tagQuery.trim() ||
        tagDisplay(t).toLowerCase().includes(tagQuery.trim().toLowerCase())
    );

  // Compact summary shown on the collapsed trigger so the configured context is
  // legible without opening the popover.
  const summaryBits: string[] = [];
  if (checkedChips.length > 0)
    summaryBits.push(
      `${checkedChips.length} source${checkedChips.length === 1 ? "" : "s"}`
    );
  if (selectedTags.length > 0)
    summaryBits.push(
      `${selectedTags.length} tag${selectedTags.length === 1 ? "" : "s"}`
    );
  if (selection.include_notes) summaryBits.push("all notes");
  const liveSelected = selection.integrations.filter((i) =>
    liveProviders.includes(i.provider)
  ).length;
  if (liveSelected > 0) summaryBits.push(`${liveSelected} live`);
  const summaryText =
    checkedChips.length > 0 && !allReady
      ? "indexing…"
      : summaryBits.length > 0
        ? summaryBits.join(" · ")
        : "no sources selected";

  return (
    <Popover
      align={align}
      width={400}
      className="max-h-[70vh] overflow-y-auto"
      trigger={
        compact ? (
          <button
            type="button"
            aria-label="Context sources"
            title={[
              `Context: ${summaryText}`,
              presetName ? `Preset: ${presetName}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            className="relative grid h-[30px] w-[30px] place-content-center rounded-[8px] border border-mist bg-bone-2 text-slate cursor-pointer transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <SlidersHorizontal size={14} strokeWidth={1.7} />
            {summaryBits.length > 0 && (
              <span className="absolute top-[4px] right-[4px] h-[6px] w-[6px] rounded-full bg-cortex" />
            )}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-[8px] rounded-[8px] border border-mist bg-bone-2 px-[12px] py-[7px] cursor-pointer transition-colors hover:bg-paper-2"
          >
            <SlidersHorizontal size={13} strokeWidth={1.7} className="text-slate-2" />
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-slate-2">
              Context
            </span>
            <span
              className={[
                "text-[11px]",
                checkedChips.length > 0 && !allReady ? "text-slate" : "text-slate-2",
              ].join(" ")}
            >
              {summaryText}
            </span>
            {presetName && (
              <span className="text-[11px] font-medium text-cortex-ink bg-cortex-tint px-[7px] py-[2px] rounded-full">
                {presetName}
              </span>
            )}
            <ChevronDown size={13} strokeWidth={1.7} className="text-slate-2" />
          </button>
        )
      }
    >
      <div className="flex flex-col gap-[12px]">
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

          <div className="flex flex-col gap-2">
            <Eyebrow className="text-[10px]">Tagged meetings</Eyebrow>
            {selectedTags.length > 0 ? (
              <div className="flex flex-wrap gap-[6px]">
                {selectedTags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-[5px] pl-[9px] pr-[5px] py-[3px] rounded-full text-[11px] border border-mist bg-paper-2 text-ink-2"
                  >
                    <TagText tag={t} />
                    <button
                      onClick={() => removeTag(t.id)}
                      aria-label={`Remove ${tagDisplay(t)}`}
                      className="grid place-content-center w-[14px] h-[14px] rounded-full text-slate-2 hover:text-ink hover:bg-mist bg-transparent border-0 cursor-pointer"
                    >
                      <X size={10} strokeWidth={2} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px] text-slate-2 m-0">
                Add a tag to pull in context from meetings that share it.
              </p>
            )}

            <div>
              <button
                onClick={() => setTagPickerOpen((o) => !o)}
                className="inline-flex items-center gap-[4px] px-[8px] py-[3px] rounded-full text-[11px] border border-dashed border-mist-2 text-slate-2 hover:text-ink hover:border-mist bg-transparent transition-colors cursor-pointer"
              >
                <Plus size={11} strokeWidth={1.8} />
                Add tag
              </button>

              {tagPickerOpen && (
                <div className="mt-2 rounded-[8px] border border-mist bg-bone-2 p-[6px]">
                  <input
                    value={tagQuery}
                    onChange={(e) => setTagQuery(e.target.value)}
                    placeholder="Search tags…"
                    autoFocus
                    className="w-full rounded-[6px] border border-mist bg-paper-2 px-2 py-[5px] text-[12px] text-ink outline-none mb-1"
                  />
                  <div className="max-h-[160px] overflow-y-auto">
                    {availableTags.length === 0 ? (
                      <p className="px-2 py-[6px] text-[11.5px] text-slate-2 m-0">
                        {tagLibrary === null
                          ? "Loading…"
                          : tagQuery.trim()
                          ? "No matches."
                          : "No tags yet — add tags to a meeting first."}
                      </p>
                    ) : (
                      availableTags.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => addTag(t.id)}
                          className="w-full flex items-center gap-2 px-2 py-[6px] text-[12.5px] text-left text-ink hover:bg-paper-2 rounded-[5px] cursor-pointer"
                        >
                          <TagText tag={t} />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
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
    </Popover>
  );
}

function TagText({ tag }: { tag: Tag }) {
  if (tag.label_key) {
    return (
      <span className="truncate">
        <span className="text-cortex-ink font-medium">{tag.label_key}</span>
        <span className="text-slate-2">: </span>
        {tag.value}
      </span>
    );
  }
  return <span className="truncate">{tag.value}</span>;
}
