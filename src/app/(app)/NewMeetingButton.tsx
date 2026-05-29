"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { parseTagInput, tagDisplay, type Tag, type TagSpec } from "@/lib/tags";

type Preset = { id: string; name: string };

function sameSpec(a: TagSpec, b: TagSpec): boolean {
  return (
    (a.label_key ?? null) === (b.label_key ?? null) &&
    a.value.toLowerCase() === b.value.toLowerCase()
  );
}

export function NewMeetingButton({ presets }: { presets: Preset[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [presetId, setPresetId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Tags to attach to the new meeting. Kept as specs (not ids) so brand-new
  // tags and references to existing ones share one path — the attach endpoint
  // resolves or coins each on submit.
  const [tagLibrary, setTagLibrary] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<TagSpec[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [tagFocused, setTagFocused] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/tags", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      if (!cancelled) setTagLibrary((await res.json()) as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function addSpec(spec: TagSpec) {
    setSelectedTags((cur) =>
      cur.some((s) => sameSpec(s, spec)) ? cur : [...cur, spec]
    );
    setTagQuery("");
  }

  const parsedTag = parseTagInput(tagQuery);
  const tagQ = tagQuery.trim().toLowerCase();
  const availableTags = tagLibrary
    .filter(
      (t) =>
        !selectedTags.some((s) =>
          sameSpec(s, { label_key: t.label_key, value: t.value })
        )
    )
    .filter((t) => !tagQ || tagDisplay(t).toLowerCase().includes(tagQ));
  const exactExists =
    !!parsedTag &&
    (availableTags.some((t) =>
      sameSpec(parsedTag, { label_key: t.label_key, value: t.value })
    ) ||
      selectedTags.some((s) => sameSpec(s, parsedTag)));
  const showCreateTag = !!parsedTag && !exactExists;

  async function createMeeting() {
    setBusy(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          context_preset_id: presetId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "Failed to create meeting");
        return;
      }
      // Attach the chosen tags before navigating so the meeting opens with
      // them in place (and their context already wired into chat/summary).
      if (selectedTags.length > 0) {
        await Promise.all(
          selectedTags.map((spec) =>
            fetch(`/api/meetings/${json.id}/tags`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(spec),
            })
          )
        );
      }
      router.push(`/meetings/${json.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="ink" leftIcon={<Plus size={14} strokeWidth={1.6} />} onClick={() => setOpen(true)}>
        New meeting
      </Button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 flex items-center justify-center p-6 bg-[rgba(20,21,26,0.20)] backdrop-blur-[2px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[420px] bg-bone-2 rounded-[14px] p-6 flex flex-col gap-4"
            style={{ boxShadow: "var(--shadow-4)" }}
          >
            <h2 className="font-display text-[24px] font-normal tracking-[-0.012em] text-ink m-0">
              Start a new meeting
            </h2>

            <Input
              label="Title"
              placeholder="Untitled meeting"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />

            <div className="flex flex-col gap-[5px]">
              <span className="text-[12px] font-medium text-ink-2">
                Tags (optional)
              </span>
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-[6px] mb-1">
                  {selectedTags.map((s, i) => (
                    <span
                      key={`${s.label_key ?? ""}-${s.value}-${i}`}
                      className="inline-flex items-center gap-[5px] pl-[9px] pr-[5px] py-[3px] rounded-full text-[11px] border border-mist bg-paper-2 text-ink-2"
                    >
                      <TagText spec={s} />
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTags((cur) => cur.filter((_, j) => j !== i))
                        }
                        aria-label={`Remove ${tagDisplay(s)}`}
                        className="grid place-content-center w-[14px] h-[14px] rounded-full text-slate-2 hover:text-ink hover:bg-mist bg-transparent border-0 cursor-pointer"
                      >
                        <X size={10} strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <input
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  onFocus={() => setTagFocused(true)}
                  onBlur={() => setTimeout(() => setTagFocused(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && parsedTag) {
                      e.preventDefault();
                      addSpec(parsedTag);
                    }
                  }}
                  placeholder="Tag, or key: value…"
                  className="w-full rounded-[6px] bg-bone-2 border border-mist px-3 py-[9px] text-[13px] text-ink outline-none"
                />
                {tagFocused && (availableTags.length > 0 || showCreateTag) && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 z-10 rounded-[8px] border border-mist bg-bone-2 py-[5px] max-h-[180px] overflow-y-auto"
                    style={{ boxShadow: "var(--shadow-3)" }}
                  >
                    {showCreateTag && parsedTag && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addSpec(parsedTag)}
                        className="w-full flex items-center gap-2 px-3 py-[7px] text-[12.5px] text-left text-cortex-ink hover:bg-cortex-tint cursor-pointer"
                      >
                        <Plus size={12} strokeWidth={1.8} />
                        <span>
                          Create{" "}
                          <span className="font-medium">{tagDisplay(parsedTag)}</span>
                        </span>
                      </button>
                    )}
                    {availableTags.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() =>
                          addSpec({ label_key: t.label_key, value: t.value })
                        }
                        className="w-full flex items-center gap-2 px-3 py-[7px] text-[12.5px] text-left text-ink hover:bg-paper-2 cursor-pointer"
                      >
                        <TagText spec={t} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Select
              label="Context preset (optional)"
              fullWidth
              value={presetId}
              onChange={setPresetId}
              options={[
                { value: "", label: "— None —" },
                ...presets.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />

            <div className="flex justify-end gap-2 mt-1">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="ink" disabled={busy} onClick={createMeeting}>
                {busy ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TagText({ spec }: { spec: TagSpec }) {
  if (spec.label_key) {
    return (
      <span className="truncate">
        <span className="text-cortex-ink font-medium">{spec.label_key}</span>
        <span className="text-slate-2">: </span>
        {spec.value}
      </span>
    );
  }
  return <span className="truncate">{spec.value}</span>;
}
