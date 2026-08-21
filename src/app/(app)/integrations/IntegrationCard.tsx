"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmModal";

type Provider =
  | "github"
  | "jira"
  | "figma"
  | "linear"
  | "linkedin"
  | "zoom"
  | "slack"
  | "gmail";

export function IntegrationCard({
  provider,
  label,
  description,
  logo,
  logoBg,
  logoUrl,
  connected,
  pending,
}: {
  provider: Provider;
  label: string;
  description: string;
  logo: string;
  logoBg: string;
  logoUrl?: string | null;
  connected: boolean;
  pending: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
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
      // OAuth gets its own tab/window so a failed flow strands only that tab,
      // never the app — this page stays put and polls for the outcome. In the
      // desktop app that means the system browser (the webview has no back
      // button); app builds predating the opener plugin fall through to the
      // browser paths. On the web, same-tab navigation only if the popup was
      // blocked (the callback redirect is the way back in that case).
      if (isTauri()) {
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(json.redirect_url);
          setWaiting(true);
          return;
        } catch {}
      }
      const popup = window.open(json.redirect_url, "_blank");
      if (!popup) {
        window.location.href = json.redirect_url;
        return;
      }
      setWaiting(true);
    } finally {
      setBusy(false);
    }
  }

  // While an OAuth window is open, poll the status endpoint. It reconciles
  // with Composio server-side, so success is picked up even when the OAuth
  // window held no app session (desktop) and its callback couldn't flip the
  // row. "none" means the failure callback deleted the pending row.
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const startedAt = Date.now();
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/integrations/${provider}`);
        const json = (await res.json().catch(() => ({}))) as { status?: string };
        if (cancelled) return;
        if (json.status === "connected") {
          setWaiting(false);
          router.refresh();
          return;
        }
        if (json.status === "none") {
          setWaiting(false);
          setError("Connection failed — try again");
          router.refresh();
          return;
        }
      } catch {
        // Transient poll failure — keep trying until the timeout.
      }
      if (!cancelled && Date.now() - startedAt > 5 * 60_000) setWaiting(false);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [waiting, provider, router]);

  async function disconnect() {
    const ok = await confirm({
      title: `Disconnect ${label}?`,
      message:
        "Everything indexed from this provider (attached contexts and, for GitHub, the repo atlas) is deleted from ContextBrain too. You can reconnect and re-index at any time.",
      confirmLabel: "Disconnect & delete data",
      tone: "danger",
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
        className="w-9 h-9 rounded-[8px] grid place-content-center font-mono font-semibold text-[14px] overflow-hidden border"
        style={{ borderColor: logoBg, color: logoBg }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`${label} logo`} className="w-5 h-5 object-contain" />
        ) : (
          logo
        )}
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
            {busy ? "Starting…" : waiting ? "Waiting…" : pending ? "Resume" : "Connect"}
          </Button>
        )}
      </div>
      {waiting && (
        <p className="text-[11px] text-slate m-0">
          Finish authorizing in the window that opened — this updates automatically.
        </p>
      )}
      {error && (
        <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-pulse-ink">
          {error}
        </p>
      )}
    </div>
  );
}
