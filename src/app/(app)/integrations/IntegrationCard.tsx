"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select, type SelectOption } from "@/components/ui/Select";
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
  githubOrg = null,
}: {
  provider: Provider;
  label: string;
  description: string;
  logo: string;
  logoBg: string;
  logoUrl?: string | null;
  connected: boolean;
  pending: boolean;
  /** GitHub only: org login the integration is scoped to (null = personal). */
  githubOrg?: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub org picker — which account repo search & the atlas read from.
  // "" encodes the personal account (Select values are strings).
  const showOrgPicker = provider === "github" && connected;
  const [orgValue, setOrgValue] = useState(githubOrg ?? "");
  const [orgSaving, setOrgSaving] = useState(false);
  const [accounts, setAccounts] = useState<{
    login: string | null;
    orgs: { login: string }[];
    orgs_unavailable: boolean;
  } | null>(null);

  useEffect(() => {
    if (!showOrgPicker) return;
    let cancelled = false;
    fetch("/api/github/orgs")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        setAccounts({
          login: json.login ?? null,
          orgs: Array.isArray(json.orgs) ? json.orgs : [],
          orgs_unavailable: !!json.orgs_unavailable,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showOrgPicker]);

  async function changeOrg(value: string) {
    const prev = orgValue;
    setOrgValue(value);
    setOrgSaving(true);
    try {
      const res = await fetch("/api/integrations/github", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org: value || null }),
      });
      if (!res.ok) {
        setOrgValue(prev);
        setError("Couldn't switch account — try again");
        return;
      }
      setError(null);
      router.refresh();
    } finally {
      setOrgSaving(false);
    }
  }

  const orgOptions: SelectOption[] = accounts
    ? [
        {
          value: "",
          label: accounts.login ? `Personal (${accounts.login})` : "Personal account",
        },
        ...accounts.orgs.map((o) => ({ value: o.login, label: o.login })),
        // Keep a stale selection visible (e.g. the org kicked the user out)
        // instead of silently snapping the trigger back to the placeholder.
        ...(orgValue && !accounts.orgs.some((o) => o.login === orgValue)
          ? [{ value: orgValue, label: `${orgValue} (unavailable)` }]
          : []),
      ]
    : [];

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
      {showOrgPicker && (
        <div className="flex flex-col gap-[5px]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate flex-shrink-0">Repos from</span>
            <Select
              size="sm"
              fullWidth
              aria-label="GitHub account or organization"
              value={orgValue}
              onChange={changeOrg}
              options={orgOptions}
              placeholder={accounts ? "Select account…" : "Loading accounts…"}
              disabled={!accounts || orgSaving}
            />
          </div>
          {accounts && accounts.orgs.length === 0 && (
            <p className="text-[11px] text-slate m-0 leading-[1.45]">
              {accounts.orgs_unavailable
                ? "Couldn't list your organizations — reconnect to grant org access."
                : "No orgs found. An org only appears once it approves the GitHub OAuth app (github.com → Settings → Applications)."}
            </p>
          )}
        </div>
      )}
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
