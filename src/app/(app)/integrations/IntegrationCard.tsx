"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmModal";

type Provider = "github" | "jira" | "figma" | "linear";

export function IntegrationCard({
  provider,
  label,
  description,
  logo,
  logoBg,
  connected,
  pending,
}: {
  provider: Provider;
  label: string;
  description: string;
  logo: string;
  logoBg: string;
  connected: boolean;
  pending: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to start OAuth");
        return;
      }
      if (json.already_connected) {
        router.refresh();
        return;
      }
      if (!json.redirect_url) {
        setError("No OAuth URL returned");
        return;
      }
      window.location.href = json.redirect_url;
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: `Disconnect ${label}?`,
      message: "You can reconnect at any time.",
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    setBusy(true);
    await fetch(`/api/integrations/${provider}`, { method: "DELETE" });
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="bg-bone-2 border border-mist rounded-[10px] p-[18px] flex flex-col gap-3 min-h-[168px]">
      <div
        className="w-9 h-9 rounded-[8px] grid place-content-center font-mono font-semibold text-[14px] text-white"
        style={{ background: logoBg }}
      >
        {logo}
      </div>
      <div>
        <div className="text-[14px] font-semibold text-ink mb-[3px]">{label}</div>
        <div className="text-[12px] text-slate leading-[1.45]">{description}</div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        {connected ? (
          <Badge tone="ok">Connected</Badge>
        ) : pending ? (
          <Badge tone="pend">Pending</Badge>
        ) : (
          <Badge tone="idle">Not connected</Badge>
        )}
        {connected ? (
          <Button variant="secondary" size="sm" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <Button variant="ink" size="sm" onClick={connect} disabled={busy}>
            {busy ? "Starting…" : pending ? "Resume" : "Connect"}
          </Button>
        )}
      </div>
      {error && (
        <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-pulse-ink">
          {error}
        </p>
      )}
    </div>
  );
}
