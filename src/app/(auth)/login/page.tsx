"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AuthShell } from "../AuthShell";
import { devSignIn } from "./actions";

type Status = "idle" | "sending" | "awaiting_code" | "verifying" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 1: ask Supabase to send a 6-digit OTP code to the email. We use the
  // code-based flow (no `emailRedirectTo`) so the user types the code back into
  // the app — that sidesteps the magic-link PKCE failure in the Tauri WebView,
  // where the link opens in the system browser and strands the verifier.
  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("awaiting_code");
    }
  }

  // Step 2: verify the code. On success, @supabase/ssr persists the session
  // cookie; we hard-navigate so the protected layout reads the cookie fresh.
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
      window.location.href = "/meetings";
    }
  }

  function resetEmail() {
    setStatus("idle");
    setCode("");
    setErrorMsg(null);
  }

  const awaitingCode = status === "awaiting_code" || status === "verifying";

  return (
    <AuthShell>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[32px] leading-[1.1] tracking-[-0.015em] text-paper">
          Welcome back
        </h2>
        <p className="m-0 text-[14px] text-mist">
          Sign in with a one-time code — no password to remember.
        </p>
      </div>

      {awaitingCode ? (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <div className="rounded-[8px] border border-echo/40 bg-echo/10 p-4 text-[13px] text-echo-tint">
            We sent a 6-digit code to{" "}
            <span className="font-medium text-paper">{email}</span>. Enter it
            below.
          </div>
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
            {status === "verifying" ? "Verifying…" : "Sign in"}
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
        <form onSubmit={sendCode} className="flex flex-col gap-4">
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
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={status === "sending"}
            className="w-full justify-center"
          >
            {status === "sending" ? "Sending…" : "Email me a code"}
          </Button>
        </form>
      )}

      <p className="m-0 text-[13px] text-mist">
        New here?{" "}
        <Link
          href="/signup"
          className="cursor-pointer font-medium text-cortex-tint-2 hover:text-paper"
        >
          Create an organization
        </Link>
      </p>

      {process.env.NODE_ENV !== "production" && (
        <form
          action={devSignIn}
          className="mt-2 border-t border-white/10 pt-4"
        >
          <button
            type="submit"
            className="cursor-pointer text-[12px] uppercase tracking-[0.08em] text-mist hover:text-paper"
          >
            Dev sign in (skip code)
          </button>
        </form>
      )}
    </AuthShell>
  );
}
