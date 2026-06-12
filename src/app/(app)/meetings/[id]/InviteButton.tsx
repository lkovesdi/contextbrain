"use client";

import { useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";

export function InviteButton({
  meetingId,
  initialToken,
}: {
  meetingId: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const link =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/join/${meetingId}?t=${token}`
      : "";

  async function mint() {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/share`, {
        method: "POST",
      });
      const j = await res.json();
      if (res.ok) setToken(j.token);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await fetch(`/api/meetings/${meetingId}/share`, { method: "DELETE" });
      setToken(null);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Popover
      align="end"
      width={300}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<UserPlus size={13} strokeWidth={1.7} />}
        >
          Invite
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0 font-mono text-[10px] uppercase tracking-[0.07em] text-slate-2">
          Guest link
        </p>
        {token ? (
          <>
            <p className="m-0 text-[12px] leading-[1.45] text-slate">
              Anyone with this link can watch live and ask questions — just a
              name, no account.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-[6px] border border-mist bg-paper-2 px-2 py-[6px] text-[12px] text-ink outline-none"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={copy}
                leftIcon={
                  copied ? <Check size={13} /> : <Copy size={13} />
                }
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={mint} disabled={busy}>
                New link
              </Button>
              <Button size="sm" variant="ghost" onClick={revoke} disabled={busy}>
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="m-0 text-[12px] leading-[1.45] text-slate">
              Create a link to let guests watch this meeting live and ask
              questions about the context you attached.
            </p>
            <Button size="sm" onClick={mint} disabled={busy}>
              {busy ? "Creating…" : "Create invite link"}
            </Button>
          </>
        )}
      </div>
    </Popover>
  );
}
