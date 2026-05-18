"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Preset = { id: string; name: string };

export function NewMeetingButton({ presets }: { presets: Preset[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [presetId, setPresetId] = useState<string>("");
  const [busy, setBusy] = useState(false);

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

            <label className="flex flex-col gap-[5px]">
              <span className="text-[12px] font-medium text-ink-2">
                Context preset (optional)
              </span>
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                className="rounded-[6px] bg-bone-2 border border-mist px-3 py-[9px] text-[13px] text-ink outline-none appearance-none"
                style={{
                  backgroundImage:
                    "linear-gradient(45deg, transparent 50%, var(--slate) 50%), linear-gradient(135deg, var(--slate) 50%, transparent 50%)",
                  backgroundPosition: "right 12px top 17px, right 7px top 17px",
                  backgroundSize: "5px 5px, 5px 5px",
                  backgroundRepeat: "no-repeat",
                }}
              >
                <option value="">— None —</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

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
