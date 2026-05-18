"use client";

import { useState } from "react";

type Space = {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  default_preset_id: string | null;
};

type Preset = { id: string; name: string };

export function SpaceHeader({ space, presets }: { space: Space; presets: Preset[] }) {
  const [name, setName] = useState(space.name);
  const [icon, setIcon] = useState(space.icon ?? "");
  const [description, setDescription] = useState(space.description ?? "");
  const [presetId, setPresetId] = useState(space.default_preset_id ?? "");
  const [savingDesc, setSavingDesc] = useState(false);

  async function patch(body: Record<string, unknown>) {
    await fetch(`/api/spaces/${space.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          value={icon}
          maxLength={4}
          onChange={(e) => setIcon(e.target.value)}
          onBlur={() => patch({ icon: icon || null })}
          placeholder="📁"
          className="w-[44px] h-[44px] text-center text-[22px] rounded-[8px] border border-mist bg-bone-2 outline-none"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed) {
              setName(space.name);
              return;
            }
            if (trimmed !== space.name) patch({ name: trimmed });
          }}
          className="flex-1 font-display text-[36px] tracking-[-0.012em] text-ink bg-transparent border-0 outline-none p-0"
        />
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onFocus={() => setSavingDesc(true)}
        onBlur={() => {
          setSavingDesc(false);
          const trimmed = description.trim();
          if ((trimmed || null) !== (space.description ?? null)) {
            patch({ description: trimmed || null });
          }
        }}
        rows={2}
        placeholder="Add a description…"
        className={[
          "w-full resize-none rounded-[6px] bg-transparent text-[13.5px] leading-[1.55] text-slate-2 outline-none px-2 py-[5px] -mx-2",
          savingDesc ? "border border-mist bg-bone-2" : "border border-transparent hover:border-mist",
        ].join(" ")}
      />

      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <span>Default preset:</span>
        <select
          value={presetId}
          onChange={(e) => {
            const v = e.target.value;
            setPresetId(v);
            patch({ default_preset_id: v || null });
          }}
          className="rounded-[6px] bg-bone-2 border border-mist px-2 py-[5px] text-[12.5px] text-ink outline-none appearance-none"
        >
          <option value="">— None —</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
