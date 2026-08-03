"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Lock, Plug } from "lucide-react";
import type { SettingsStatus, ProviderStatus } from "@/lib/settings";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmProvider, useConfirm } from "@/components/ui/ConfirmModal";
import { Eyebrow } from "@/components/ui/typography";

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
