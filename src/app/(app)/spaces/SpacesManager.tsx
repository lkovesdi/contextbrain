"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";
import TrashIcon from "@/components/icons/TrashIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Eyebrow } from "@/components/ui/typography";
import { Card, ListCard } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmModal";

export type SpaceRow = {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  default_preset_id: string | null;
  created_at: string;
  updated_at: string;
  meeting_count: number;
};

type PresetOpt = { id: string; name: string };

export function SpacesManager({
  spaces,
  presets,
}: {
  spaces: SpaceRow[];
  presets: PresetOpt[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [presetId, setPresetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setIcon("");
    setDescription("");
    setPresetId("");
  }

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          icon: icon.trim() || null,
          description: description.trim() || null,
          default_preset_id: presetId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Save failed (${res.status})`);
        return;
      }
      reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete space?",
      message: "Meetings filed under it will become unfiled.",
      confirmLabel: "Delete space",
    });
    if (!ok) return;
    await fetch(`/api/spaces/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-7">
      <Card className="p-[22px]">
        <h2 className="text-[14px] font-semibold m-0 mb-[14px] text-ink">New space</h2>
        <div className="flex flex-col gap-[18px]">
          <div className="grid grid-cols-[64px_1fr] gap-3">
            <Input
              label="Icon"
              placeholder="🚀"
              value={icon}
              maxLength={4}
              onChange={(e) => setIcon(e.target.value)}
            />
            <Input
              label="Name"
              placeholder="Acme Corp"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <label className="flex flex-col gap-[5px]">
            <span className="text-[12px] font-medium text-ink-2">Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What lives in this space?"
              className="rounded-[6px] bg-bone-2 border border-mist px-3 py-[9px] text-[13px] text-ink outline-none resize-none"
            />
          </label>

          <label className="flex flex-col gap-[5px]">
            <span className="text-[12px] font-medium text-ink-2">Default preset (optional)</span>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="rounded-[6px] bg-bone-2 border border-mist px-3 py-[9px] text-[13px] text-ink outline-none appearance-none"
            >
              <option value="">— None —</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <Button variant="ink" onClick={create} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create space"}
            </Button>
            {error && (
              <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-pulse-ink">
                {error}
              </span>
            )}
          </div>
        </div>
      </Card>

      {spaces.length > 0 ? (
        <div>
          <Eyebrow className="mb-[10px]">Saved · {spaces.length}</Eyebrow>
          <ListCard>
            {spaces.map((s, i) => (
              <div
                key={s.id}
                className={[
                  "flex items-center gap-[14px] px-[18px] py-[14px]",
                  "transition-colors duration-[120ms] ease-[var(--ease-out)] hover:bg-paper-2",
                  i < spaces.length - 1 ? "border-b border-mist" : "",
                ].join(" ")}
              >
                <Link
                  href={`/spaces/${s.id}`}
                  className="flex-1 min-w-0 flex items-center gap-[12px]"
                >
                  <span className="text-[18px] leading-none w-[24px] text-center">
                    {s.icon || "📁"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-ink truncate">
                      {s.name}
                    </div>
                    <div className="font-mono text-[11px] text-slate mt-[3px] truncate">
                      {s.meeting_count} meeting{s.meeting_count === 1 ? "" : "s"}
                      {s.description ? ` · ${s.description}` : ""}
                    </div>
                  </div>
                </Link>
                <DeleteIcon onClick={() => remove(s.id)} />
              </div>
            ))}
          </ListCard>
        </div>
      ) : (
        <div className="rounded-[10px] border border-dashed border-mist-2 bg-bone-2 p-12 text-center">
          <p className="text-[13px] text-slate">No spaces yet.</p>
          <p className="mt-1 text-[12px] text-slate-2">
            Create one above, then file meetings into it from the meeting page.
          </p>
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
      aria-label="Delete space"
      className={[
        "bg-transparent border-0 cursor-pointer rounded-[4px] p-[6px] transition-all duration-[120ms] ease-[var(--ease-out)]",
        hover ? "text-pulse bg-pulse-tint" : "text-slate-3",
      ].join(" ")}
    >
      <TrashIcon ref={iconRef} size={13} strokeWidth={1.6} />
    </button>
  );
}
