"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AuthShell } from "../AuthShell";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-[32px] leading-[1.1] tracking-[-0.015em] text-paper">
          Welcome back
        </h2>
        <p className="m-0 text-[14px] text-mist">
          Sign in with a magic link — no password to remember.
        </p>
      </div>

      {status === "sent" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-[8px] border border-echo/40 bg-echo/10 p-4 text-[13px] text-echo-tint">
            Check <span className="font-medium text-paper">{email}</span> for a sign-in
            link. It expires in a few minutes.
          </div>
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
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={status === "sending"}
            className="w-full justify-center"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
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
    </AuthShell>
  );
}
