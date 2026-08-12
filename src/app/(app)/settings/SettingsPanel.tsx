"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Lock, Plug, Plus } from "lucide-react";
import type { SettingsStatus, ProviderStatus } from "@/lib/settings";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmProvider, useConfirm } from "@/components/ui/ConfirmModal";
import { Eyebrow } from "@/components/ui/typography";
import { ThemeSelect } from "@/components/ui/ThemeSelect";

type KeyProvider = "anthropic" | "deepgram";

export function SettingsPanel({ initial }: { initial: SettingsStatus }) {
  // ConfirmProvider isn't mounted app-wide, so scope it here for the Remove flow.
  return (
    <ConfirmProvider>
      <SettingsInner initial={initial} />
    </ConfirmProvider>
  );
}

function SettingsInner({ initial }: { initial: SettingsStatus }) {
  const [status, setStatus] = useState<SettingsStatus>(initial);

  return (
    <div className="flex flex-col gap-[26px]">
      <section>
        <Eyebrow className="mb-[10px]">Appearance</Eyebrow>
        <Card className="flex items-center justify-between gap-4 p-[16px]">
          <div>
            <div className="text-[14px] font-medium text-ink">Theme</div>
            <p className="m-0 mt-[2px] text-[12.5px] text-slate">
              System follows your OS setting.
            </p>
          </div>
          <ThemeSelect />
        </Card>
      </section>

      <section>
        <Eyebrow className="mb-[10px]">Credits</Eyebrow>
        <CreditsCard />
      </section>

      <section>
        <Eyebrow className="mb-[10px]">API keys</Eyebrow>
        <div className="flex flex-col gap-[14px]">
          <CredentialCard
            title="Anthropic"
            provider="anthropic"
            status={status.anthropic}
            keyPlaceholder="sk-ant-…"
            hint="Powers chat, catch-up, and meeting summaries."
            onStatus={setStatus}
          />
          <CredentialCard
            title="Deepgram"
            provider="deepgram"
            status={status.deepgram}
            keyPlaceholder="Deepgram API key"
            projectField
            hint="Powers live transcription."
            onStatus={setStatus}
          />
          <LockedCard
            title="OpenAI · Embeddings"
            note="Managed by ContextBrain. Retrieval embeddings run on a shared key + fixed model so your search index stays consistent — changing it would require re-embedding your whole corpus."
          />
        </div>
      </section>

      <section>
        <Eyebrow className="mb-[10px]">Integrations</Eyebrow>
        <IntegrationsCard />
      </section>
    </div>
  );
}

// Mirrors CREDIT_PACKS in src/lib/credits.ts (not imported — that module is
// server-only). The checkout route validates the pack id anyway.
const PACKS = [
  { id: "small", label: "$10" },
  { id: "medium", label: "$25" },
  { id: "large", label: "$100" },
] as const;

const REASON_LABEL: Record<string, string> = {
  signup_grant: "Starter credit",
  purchase: "Purchase",
  llm_usage: "AI usage",
  transcription_usage: "Transcription",
  adjustment: "Adjustment",
  refund: "Refund",
};

type LedgerEntry = {
  id: number;
  delta_usd_micros: number;
  reason: string;
  meta: { model?: string } & Record<string, unknown>;
  created_at: string;
};

type CreditsData = { balanceUsdMicros: number; entries: LedgerEntry[] };

function fmtBalance(micros: number): string {
  const usd = micros / 1_000_000;
  return usd < 0 ? `−$${Math.abs(usd).toFixed(2)}` : `$${usd.toFixed(2)}`;
}

// Signed ledger amount. Sub-cent LLM debits would render as −$0.00 at two
// decimals, so tiny non-zero amounts get four.
function fmtDelta(micros: number): string {
  const abs = Math.abs(micros) / 1_000_000;
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${micros < 0 ? "−" : "+"}$${abs.toFixed(digits)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function CreditsCard() {
  const [data, setData] = useState<CreditsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buying, setBuying] = useState<(typeof PACKS)[number]["id"] | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/credits");
        const json = (await res.json().catch(() => ({}))) as
          | CreditsData
          | { error?: string };
        if (!res.ok) {
          throw new Error(("error" in json && json.error) || "Couldn't load credits");
        }
        if (!cancelled) setData(json as CreditsData);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Couldn't load credits");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function buy(pack: (typeof PACKS)[number]["id"]) {
    setBuyError(null);
    setBuying(pack);
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      // 503 = checkout not configured; surface the route's message inline.
      if (!res.ok || !json.url) {
        throw new Error(json.error || "Checkout is unavailable right now.");
      }
      window.location.assign(json.url);
      // Keep the spinner while the browser navigates to Stripe.
    } catch (e) {
      setBuyError(e instanceof Error ? e.message : "Checkout failed");
      setBuying(null);
    }
  }

  const entries = data?.entries ?? [];

  return (
    <Card className="p-[16px] flex flex-col gap-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-ink">Credit balance</span>
        {data !== null && data.balanceUsdMicros <= 0 && (
          <Badge tone="pend">Out of credits</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-[16px] gap-y-[10px]">
        <div>
          <div className="text-[26px] leading-none font-semibold tracking-[-0.01em] text-ink">
            {data !== null ? fmtBalance(data.balanceUsdMicros) : loadError ? "—" : "…"}
          </div>
          <p className="m-0 mt-[5px] text-[12.5px] text-slate">
            Spent when your calls run on ContextBrain&apos;s platform keys.
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          {PACKS.map((p) => (
            <Button
              key={p.id}
              variant="secondary"
              size="sm"
              onClick={() => buy(p.id)}
              disabled={buying !== null}
              leftIcon={
                buying === p.id ? (
                  <Loader2 size={13} strokeWidth={1.8} className="animate-spin" />
                ) : (
                  <Plus size={12} strokeWidth={1.8} />
                )
              }
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <button
            type="button"
            onClick={() => setShowUsage((s) => !s)}
            className="self-start inline-flex items-center gap-[4px] font-mono text-[11px] uppercase tracking-[0.08em] text-slate-2 hover:text-ink transition-colors cursor-pointer"
          >
            <ChevronRight
              size={12}
              strokeWidth={1.8}
              className={[
                "transition-transform duration-[120ms]",
                showUsage ? "rotate-90" : "",
              ].join(" ")}
            />
            Recent usage
          </button>
          {showUsage && (
            <ul className="m-0 p-0 list-none flex flex-col">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-[6px] border-b border-mist last:border-b-0 text-[12px]"
                >
                  <span className="text-ink-2 truncate">
                    {REASON_LABEL[e.reason] ?? e.reason}
                    {typeof e.meta?.model === "string" && (
                      <span className="ml-[6px] font-mono text-[10.5px] text-slate-2">
                        {e.meta.model}
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-[10px] shrink-0">
                    <span
                      className={[
                        "font-mono text-[11.5px]",
                        e.delta_usd_micros > 0 ? "text-echo-ink" : "text-slate",
                      ].join(" ")}
                    >
                      {fmtDelta(e.delta_usd_micros)}
                    </span>
                    <span className="text-[11px] text-slate-2 w-[46px] text-right">
                      {fmtDate(e.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11.5px] text-slate-2 m-0">
        Calls made with your own API keys are free — they never draw down
        credits.
      </p>
      {loadError && <p className="text-[12px] text-pulse m-0">{loadError}</p>}
      {buyError && <p className="text-[12px] text-pulse m-0">{buyError}</p>}
    </Card>
  );
}

function CredentialCard({
  title,
  provider,
  status,
  keyPlaceholder,
  projectField = false,
  hint,
  onStatus,
}: {
  title: string;
  provider: KeyProvider;
  status: ProviderStatus;
  keyPlaceholder: string;
  projectField?: boolean;
  hint: string;
  onStatus: (s: SettingsStatus) => void;
}) {
  const confirm = useConfirm();
  const [keyInput, setKeyInput] = useState("");
  const [projectInput, setProjectInput] = useState(status.projectId ?? "");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "toggle" | "remove">(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(init: RequestInit, qs = "") {
    setError(null);
    const res = await fetch(`/api/settings/keys${qs}`, init);
    const data = (await res.json().catch(() => ({}))) as
      | SettingsStatus
      | { error?: string };
    if (!res.ok) {
      throw new Error(("error" in data && data.error) || "Request failed");
    }
    onStatus(data as SettingsStatus);
  }

  async function save() {
    if (!keyInput.trim()) return;
    setBusy("save");
    try {
      await apply({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          key: keyInput.trim(),
          ...(projectField ? { project_id: projectInput.trim() } : {}),
        }),
      });
      setKeyInput("");
      setReveal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(enabled: boolean) {
    setBusy("toggle");
    try {
      await apply({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, enabled }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Remove ${title} key?`,
      message: "Your calls will fall back to the ContextBrain platform key.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("remove");
    try {
      await apply({ method: "DELETE" }, `?provider=${provider}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  }

  const badge = !status.set ? (
    <Badge tone="idle">Not set</Badge>
  ) : status.enabled ? (
    <Badge tone="ok">Connected</Badge>
  ) : (
    <Badge tone="idle">Saved · not in use</Badge>
  );

  return (
    <Card className="p-[16px] flex flex-col gap-[12px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        {badge}
      </div>

      {status.set && (
        <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
          <span className="font-mono text-[12px] text-slate">
            key ···· {status.maskedSuffix ?? "••••"}
          </span>
          <Checkbox
            checked={status.enabled}
            onChange={toggle}
            disabled={busy !== null}
            dim
          >
            Use my key
          </Checkbox>
        </div>
      )}

      <Input
        label={status.set ? "Replace key" : "API key"}
        type={reveal ? "text" : "password"}
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        placeholder={keyPlaceholder}
        autoComplete="off"
        spellCheck={false}
      />

      {projectField && (
        <Input
          label="Project ID"
          value={projectInput}
          onChange={(e) => setProjectInput(e.target.value)}
          placeholder="Deepgram project ID"
          autoComplete="off"
          spellCheck={false}
        />
      )}

      <div className="flex items-center gap-[8px]">
        <Button
          size="sm"
          onClick={save}
          disabled={busy !== null || !keyInput.trim()}
          leftIcon={
            busy === "save" ? (
              <Loader2 size={13} strokeWidth={1.8} className="animate-spin" />
            ) : undefined
          }
        >
          Save
        </Button>
        {keyInput.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReveal((r) => !r)}
          >
            {reveal ? "Hide" : "Show"}
          </Button>
        )}
        {status.set && (
          <Button
            variant="ghost"
            size="sm"
            onClick={remove}
            disabled={busy !== null}
            className="ml-auto text-pulse"
          >
            Remove
          </Button>
        )}
      </div>

      <p className="text-[11.5px] text-slate-2 m-0">{hint}</p>
      {error && <p className="text-[12px] text-pulse m-0">{error}</p>}
    </Card>
  );
}

function LockedCard({ title, note }: { title: string; note: string }) {
  return (
    <Card className="p-[16px] flex flex-col gap-[8px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-ink">{title}</span>
        <Badge tone="info">
          <Lock size={11} strokeWidth={2} className="-ml-[1px]" />
          Managed
        </Badge>
      </div>
      <p className="text-[11.5px] text-slate-2 m-0 leading-[1.5]">{note}</p>
    </Card>
  );
}

function IntegrationsCard() {
  return (
    <Card className="p-[16px] flex items-center justify-between gap-4">
      <div className="flex flex-col gap-[3px]">
        <span className="text-[14px] font-semibold text-ink">
          GitHub, Jira, Linear, Figma…
        </span>
        <span className="text-[11.5px] text-slate-2">
          Connect these with OAuth — no key to paste.
        </span>
      </div>
      <Link href="/integrations">
        <Button variant="secondary" size="sm" leftIcon={<Plug size={13} strokeWidth={1.7} />}>
          Manage
        </Button>
      </Link>
    </Card>
  );
}
