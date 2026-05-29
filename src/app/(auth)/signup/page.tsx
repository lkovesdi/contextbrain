"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AuthShell } from "../AuthShell";

type ExistingOrg = { id: string; name: string; memberCount: number };

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [existingOrg, setExistingOrg] = useState<ExistingOrg | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("checking");
    setErrorMsg(null);
    setExistingOrg(null);

    // 1) Verify it's a real work email (DNS + not a free provider).
    const res = await fetch("/api/org/check-domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!data.ok) {
      setErrorMsg(data.reason ?? "We couldn't verify that email.");
      setStatus("error");
      return;
    }

    // 2) Send the magic link, routing to onboarding after confirmation.
    const supabase = createClient();
    const next = encodeURIComponent("/onboarding");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${next}` },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
      return;
    }
    setExistingOrg(data.existingOrg ?? null);
    setStatus("sent");
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[32px] leading-[1.1] tracking-[-0.015em] text-paper">
          Create your organization
        </h2>
        <p className="m-0 text-[14px] text-mist">
          Start with your work email. We&apos;ll set up your workspace once you confirm it.
        </p>
      </div>

      {status === "sent" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-[8px] border border-echo/40 bg-echo/10 p-4 text-[13px] text-echo-tint">
            Check <span className="font-medium text-paper">{email}</span> for a confirmation
            link to continue setting up your workspace.
          </div>
          {existingOrg && (
            <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-4 text-[13px] text-mist">
              <span className="font-medium text-paper">{existingOrg.name}</span> is already on
              ContextBrain
              {existingOrg.memberCount > 0 && (
                <> ({existingOrg.memberCount} member{existingOrg.memberCount === 1 ? "" : "s"})</>
              )}
              . You&apos;ll be able to join your team after confirming.
            </div>
          )}
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="cursor-pointer self-start text-[13px] text-mist transition-colors hover:text-paper"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            type="email"
            required
            tone="dark"
            label="Work email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoFocus
            error={errorMsg ?? undefined}
            hint={errorMsg ? undefined : "Personal email providers aren't supported."}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={status === "checking" || email.trim().length === 0}
            className="w-full justify-center"
          >
            {status === "checking" ? "Checking…" : "Continue"}
          </Button>
        </form>
      )}

      <p className="m-0 text-[13px] text-mist">
        Already have an account?{" "}
        <Link
          href="/login"
          className="cursor-pointer font-medium text-cortex-tint-2 hover:text-paper"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
