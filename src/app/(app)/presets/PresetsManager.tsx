"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import TrashIcon from "@/components/icons/TrashIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Eyebrow } from "@/components/ui/typography";
import { Card, ListCard } from "@/components/ui/Card";
import { ContextChip, type ChipData } from "@/components/context/ContextChip";
import { ContextSourcePicker } from "@/components/context/ContextSourcePicker";
import { SOURCE_PROVIDERS, type ProviderId } from "@/components/context/sources";
import { useConfirm } from "@/components/ui/ConfirmModal";

type Provider = "github" | "jira" | "figma" | "linear";

// A preset is only the explicit attachments the user adds — pinned notes,
// attached spaces (for recurring summaries), external sources, and
// integrations. The "current meeting's transcripts" come implicitly from
// being in a meeting; "all my notes" is an ad-hoc runtime toggle in the
// meeting chat, not part of the preset definition.
export type PresetSources = {
  external_context_ids?: string[];
  note_ids?: string[];
  space_id?: string | null;
  recent_summary_count?: number;
  integrations?: Partial<Record<Provider, Record<string, unknown>>>;
};

export type ExistingPreset = {
  id: string;
  name: string;
  sources: PresetSources;
  created_at: string;
};

export type SpaceOption = { id: string; name: string; icon: string | null };
export type NoteOption = {
  id: string;
  content: string;
  meeting_id: string | null;
  meeting_title: string | null;
  created_at: string;
};

const EMPTY: PresetSources = {
  external_context_ids: [],
  note_ids: [],
  space_id: null,
  recent_summary_count: 3,
  integrations: {},
};

export function PresetsManager({
  presets,
  chips: initialChips,
  connectedIntegrations,
  spaces,
  notes,
}: {
  presets: ExistingPreset[];
  chips: ChipData[];
  connectedIntegrations: string[];
  spaces: SpaceOption[];
  notes: NoteOption[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [sources, setSources] = useState<PresetSources>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chips, setChips] = useState<ChipData[]>(initialChips);
  const [saveError, setSaveError] = useState<string | null>(null);

  function reset() {
    setName("");
    setSources(EMPTY);
    setEditingId(null);
  }

  function loadForEdit(p: ExistingPreset) {
    setEditingId(p.id);
    setName(p.name);
    setSources({ ...EMPTY, ...p.sources });
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      const res = editingId
        ? await fetch("/api/presets", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: editingId, name: name.trim(), sources }),
          })
        : await fetch("/api/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim(), sources }),
          });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSaveError(j.error ?? `Save failed (${res.status})`);
        return;
      }
      reset();
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete preset?",
      message: "Meetings that referenced it will fall back to no preset.",
      confirmLabel: "Delete preset",
    });
    if (!ok) return;
    await fetch(`/api/presets?id=${id}`, { method: "DELETE" });
    if (editingId === id) reset();
    router.refresh();
  }

  function setChipChecked(id: string, checked: boolean) {
    setSources((s) => {
      const list = s.external_context_ids ?? [];
      return {
        ...s,
        external_context_ids: checked
          ? Array.from(new Set([...list, id]))
          : list.filter((x) => x !== id),
      };
    });
  }

  function toggleIntegration(provider: Provider) {
    setSources((s) => {
      const map = { ...(s.integrations ?? {}) };
      if (map[provider]) delete map[provider];
      else map[provider] = {};
      return { ...s, integrations: map };
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
  // referencing it from this preset.
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

  const checkedIds = new Set(sources.external_context_ids ?? []);
  const checkedChips = chips.filter((c) => checkedIds.has(c.id));
  const otherChips = chips.filter((c) => !checkedIds.has(c.id));
  const pickerProviders = connectedIntegrations.filter(
    (p): p is ProviderId => p in SOURCE_PROVIDERS
  );
  const liveProviders = connectedIntegrations.filter(
    (p) => !(p in SOURCE_PROVIDERS)
  );

  return (
    <div className="flex flex-col gap-7">
      <Card className="p-[22px]">
        <h2 className="text-[14px] font-semibold m-0 mb-[14px] text-ink">
          {editingId ? "Edit preset" : "New preset"}
        </h2>
        <div className="flex flex-col gap-[18px]">
          <Input
            label="Name"
            placeholder="Sprint planning"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <SpaceContextPicker
            spaces={spaces}
            spaceId={sources.space_id ?? null}
            count={sources.recent_summary_count ?? 3}
            onSpaceChange={(id) =>
              setSources((s) => ({ ...s, space_id: id }))
            }
            onCountChange={(n) =>
              setSources((s) => ({ ...s, recent_summary_count: n }))
            }
          />

          <NotePicker
            notes={notes}
            selected={sources.note_ids ?? []}
            onChange={(ids) => setSources((s) => ({ ...s, note_ids: ids }))}
          />

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
              <div className="flex flex-wrap gap-[8px] pt-1">
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
              <details className="mt-1">
                <summary className="font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2 cursor-pointer select-none hover:text-ink">
                  From your library · {otherChips.length}
                </summary>
                <div className="flex flex-wrap gap-[8px] pt-2">
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
              <Eyebrow className="text-[10px] mb-1">Live integrations</Eyebrow>
              {liveProviders.map((p) => (
                <Checkbox
                  key={p}
                  checked={!!(sources.integrations ?? {})[p as Provider]}
                  onChange={() => toggleIntegration(p as Provider)}
                >
                  {p}
                </Checkbox>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-[6px]">
            <Button
              variant="ink"
              onClick={save}
              disabled={busy || !name.trim()}
            >
              {editingId ? "Save changes" : "Create preset"}
            </Button>
            {editingId && (
              <Button variant="secondary" onClick={reset}>
                Cancel
              </Button>
            )}
            {saveError && (
              <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-pulse-ink">
                {saveError}
              </span>
            )}
          </div>
        </div>
      </Card>

      {presets.length > 0 && (
        <div>
          <Eyebrow className="mb-[10px]">Saved · {presets.length}</Eyebrow>
          <ListCard>
            {presets.map((p, i) => (
              <div
                key={p.id}
                className={[
                  "flex items-center gap-[14px] px-[18px] py-[14px]",
                  i < presets.length - 1 ? "border-b border-mist" : "",
                ].join(" ")}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-ink truncate">
                    {p.name}
                  </div>
                  <div className="font-mono text-[11px] text-slate mt-[3px]">
                    {summarizeSources(p.sources, chips)}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => loadForEdit(p)}
                >
                  Edit
                </Button>
                <DeleteIcon onClick={() => remove(p.id)} />
              </div>
            ))}
          </ListCard>
        </div>
      )}
    </div>
  );
}

function DeleteIcon({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const iconRef = useRef<AnimatedIconHandle | null>(null);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => {
        setHover(true);
        iconRef.current?.startAnimation();
      }}
      onMouseLeave={() => {
        setHover(false);
        iconRef.current?.stopAnimation();
      }}
      aria-label="Delete preset"
      className={[
        "bg-transparent border-0 cursor-pointer rounded-[4px] p-[6px] transition-all duration-[120ms] ease-[var(--ease-out)]",
        hover ? "text-pulse bg-pulse-tint" : "text-slate-3",
      ].join(" ")}
    >
      <TrashIcon ref={iconRef} size={13} strokeWidth={1.6} />
    </button>
  );
}

function summarizeSources(s: PresetSources, chips: ChipData[]): string {
  const parts: string[] = [];
  const noteCount = (s.note_ids ?? []).length;
  if (noteCount > 0) parts.push(`${noteCount} pinned note${noteCount === 1 ? "" : "s"}`);
  if (s.space_id) {
    parts.push(`recent space summaries · ${s.recent_summary_count ?? 3}`);
  }
  const checked = (s.external_context_ids ?? []).length;
  if (checked > 0) parts.push(`${checked} sources`);
  const ints = Object.keys(s.integrations ?? {}).filter((p) => p !== "github");
  if (ints.length) parts.push(ints.join(" + "));
  // Suppress lint warning — chips is reserved for richer summaries (chunks_total totals etc.)
  void chips;
  return parts.length ? parts.join(" · ") : "empty";
}

function SpaceContextPicker({
  spaces,
  spaceId,
  count,
  onSpaceChange,
  onCountChange,
}: {
  spaces: SpaceOption[];
  spaceId: string | null;
  count: number;
  onSpaceChange: (id: string | null) => void;
  onCountChange: (n: number) => void;
}) {
  if (spaces.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="text-[10px]">Recurring context</Eyebrow>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        <span>Pull the last</span>
        <select
          value={count}
          onChange={(e) => onCountChange(parseInt(e.target.value, 10))}
          disabled={!spaceId}
          className="rounded-[6px] bg-bone-2 border border-mist px-2 py-[3px] text-[12px] text-ink outline-none disabled:opacity-50"
        >
          {[1, 2, 3, 5, 7, 10].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span>summaries from</span>
        <select
          value={spaceId ?? ""}
          onChange={(e) => onSpaceChange(e.target.value || null)}
          className="rounded-[6px] bg-bone-2 border border-mist px-2 py-[3px] text-[12px] text-ink outline-none"
        >
          <option value="">— no space —</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.icon ? `${s.icon} ` : ""}
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.07em] text-slate-2 -mt-[2px]">
        Adds prior meeting summaries to this preset so recurring meetings keep continuity.
      </p>
    </div>
  );
}

function NotePicker({
  notes,
  selected,
  onChange,
}: {
  notes: NoteOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const checked = new Set(selected);

  if (notes.length === 0) return null;

  const filtered = query.trim()
    ? notes.filter((n) =>
        (n.content + " " + (n.meeting_title ?? "")).toLowerCase().includes(query.toLowerCase())
      )
    : notes;

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  }

  return (
    <details className="flex flex-col gap-2" open={selected.length > 0}>
      <summary className="cursor-pointer list-none flex items-center justify-between">
        <Eyebrow className="text-[10px]">Pin specific notes</Eyebrow>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.07em] text-slate-2">
          {selected.length > 0 ? `${selected.length} pinned ↓` : `${notes.length} available ↓`}
        </span>
      </summary>
      <Input
        placeholder="Search notes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex flex-col gap-1 max-h-[260px] overflow-y-auto border border-mist rounded-[8px] bg-bone-2 p-2">
        {filtered.length === 0 ? (
          <p className="text-[12px] text-slate-2 px-2 py-1">No matches.</p>
        ) : (
          filtered.map((n) => (
            <label
              key={n.id}
              className={[
                "flex items-start gap-2 px-2 py-[7px] rounded-[6px] cursor-pointer",
                "transition-colors duration-[120ms] ease-[var(--ease-out)]",
                checked.has(n.id) ? "bg-cortex-tint" : "hover:bg-paper-2",
              ].join(" ")}
            >
              <input
                type="checkbox"
                checked={checked.has(n.id)}
                onChange={() => toggle(n.id)}
                className="mt-[3px]"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] leading-[1.45] text-ink whitespace-pre-wrap line-clamp-3">
                  {n.content}
                </div>
                <div className="font-mono text-[10px] text-slate-2 mt-[2px] uppercase tracking-[0.06em]">
                  {n.meeting_title ?? "Standalone note"} ·{" "}
                  {new Date(n.created_at).toLocaleDateString()}
                </div>
              </div>
            </label>
          ))
        )}
      </div>
    </details>
  );
}
