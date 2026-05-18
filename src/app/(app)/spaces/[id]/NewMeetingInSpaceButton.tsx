"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function NewMeetingInSpaceButton({
  spaceId,
  spaceName,
}: {
  spaceId: string;
  spaceName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${spaceName} — ${new Date().toLocaleDateString()}`,
          space_id: spaceId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? "Failed to create meeting");
        return;
      }
      router.push(`/meetings/${json.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ink" leftIcon={<Plus size={14} strokeWidth={1.6} />} onClick={create} disabled={busy}>
      {busy ? "Creating…" : "New meeting"}
    </Button>
  );
}
