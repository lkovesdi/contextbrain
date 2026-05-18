"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import TrashIcon from "@/components/icons/TrashIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { useConfirm } from "@/components/ui/ConfirmModal";

export function DeleteContextButton({ id }: { id: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const iconRef = useRef<AnimatedIconHandle | null>(null);

  async function onClick() {
    const ok = await confirm({
      title: "Delete context?",
      message: "This removes the context and all of its indexed chunks.",
      confirmLabel: "Delete context",
    });
    if (!ok) return;
    setBusy(true);
    await fetch(`/api/contexts/${id}`, { method: "DELETE" });
    router.refresh();
    setBusy(false);
  }

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
      disabled={busy}
      aria-label="Delete context"
      className={[
        "bg-transparent border-0 cursor-pointer rounded-[4px] p-1 transition-all duration-[120ms] ease-[var(--ease-out)] disabled:opacity-50",
        hover ? "text-pulse bg-pulse-tint" : "text-slate-3",
      ].join(" ")}
    >
      <TrashIcon ref={iconRef} size={14} strokeWidth={1.6} />
    </button>
  );
}
