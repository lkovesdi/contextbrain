"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Upload } from "lucide-react";

export function ImportClaude() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/contexts/claude-export", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Import failed");
        setStatus(null);
        return;
      }
      setStatus(`Imported ${json.chunk_count} chunks.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStatus(null);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  const imported = status?.startsWith("Imported");

  return (
    <div className="flex flex-col gap-[10px]">
      <label className="inline-flex items-center gap-[7px] cursor-pointer rounded-[6px] border border-mist bg-bone-2 px-[14px] py-[8px] text-[13px] font-medium text-ink hover:bg-paper-2 transition-colors w-fit">
        <Upload size={14} strokeWidth={1.6} />
        <input
          type="file"
          accept="application/json"
          onChange={onChange}
          disabled={busy}
          className="hidden"
        />
        {busy ? "Importing…" : "Choose conversations.json"}
      </label>
      {status && (
        <p
          className={[
            "font-mono text-[11px] m-0",
            imported ? "text-echo-ink" : "text-slate",
          ].join(" ")}
        >
          {status}
        </p>
      )}
      {error && (
        <p className="font-mono text-[11px] text-pulse-ink m-0">{error}</p>
      )}
    </div>
  );
}
