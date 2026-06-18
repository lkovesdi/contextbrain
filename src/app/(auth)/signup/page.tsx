"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AuthShell } from "../AuthShell";

type ExistingOrg = { id: string; name: string; memberCount: number };
type Status =
  | "idle"
  | "checking"
  | "sending"
  | "awaiting_code"
  | "verifying"
  | "error";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [existingOrg, setExistingOrg] = useState<ExistingOrg | null>(null);

  // Step 1: validate the domain, then ask Supabase to email a 6-digit OTP. The
  // code-based flow (no `emailRedirectTo`) avoids the magic-link PKCE failure
  // in the Tauri WebView.
  async function start(e: React.FormEvent) {
    e.preventDefault();
    setStatus("checking");
    setErrorMsg(null);
    setExistingOrg(null);

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

    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
      return;
    }
    setExistingOrg(data.existingOrg ?? null);
    setStatus("awaiting_code");
  }

  // Step 2: verify the code; on success, route to onboarding.
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setStatus("verifying");
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("awaiting_code");
    } else {
      window.location.href = "/onboarding";
    }
  }

  function resetEmail() {
    setStatus("idle");
    setCode("");
    setErrorMsg(null);
    setExistingOrg(null);
  }

  const awaitingCode = status === "awaiting_code" || status === "verifying";

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

      {awaitingCode ? (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <div className="rounded-[8px] border border-echo/40 bg-echo/10 p-4 text-[13px] text-echo-tint">
            We sent a 6-digit code to{" "}
            <span className="font-medium text-paper">{email}</span>. Enter it
            below to continue.
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
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            tone="dark"
            label="Sign-in code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            autoFocus
            error={errorMsg ?? undefined}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={status === "verifying" || code.length !== 6}
            className="w-full justify-center"
          >
            {status === "verifying" ? "Verifying…" : "Continue"}
          </Button>
          <button
            type="button"
            onClick={resetEmail}
            className="cursor-pointer self-start text-[13px] text-mist transition-colors hover:text-paper"
          >
            Use a different email
          </button>
        </form>
      ) : (
        <form onSubmit={start} className="flex flex-col gap-4">
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
            disabled={
              status === "checking" ||
              status === "sending" ||
              email.trim().length === 0
            }
            className="w-full justify-center"
          >
            {status === "checking"
              ? "Checking…"
              : status === "sending"
                ? "Sending…"
                : "Continue"}
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
