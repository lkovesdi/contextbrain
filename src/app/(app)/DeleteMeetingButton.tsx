"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TrashIcon from "@/components/icons/TrashIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { useConfirm } from "@/components/ui/ConfirmModal";

export function DeleteMeetingButton({
  meetingId,
  title,
}: {
  meetingId: string;
  title: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const iconRef = useRef<AnimatedIconHandle | null>(null);

  async function remove() {
    if (busy) return;
    const ok = await confirm({
      title: "Delete meeting?",
      message: (
        <>
          Permanently delete <span className="font-medium text-ink">{title}</span>?
          This can&rsquo;t be undone.
        </>
      ),
      confirmLabel: "Delete meeting",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? `Delete failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      onMouseEnter={() => {
        setHover(true);
        iconRef.current?.startAnimation();
      }}
      onMouseLeave={() => {
        setHover(false);
        iconRef.current?.stopAnimation();
      }}
      disabled={busy}
      aria-label="Delete meeting"
      className={[
        "bg-transparent border-0 cursor-pointer rounded-[4px] p-[6px] transition-all duration-[120ms] ease-[var(--ease-out)]",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        hover ? "text-pulse bg-pulse-tint" : "text-slate-3",
        busy ? "opacity-50 cursor-wait" : "",
      ].join(" ")}
    >
      <TrashIcon ref={iconRef} size={13} strokeWidth={1.6} />
    </button>
  );
}
