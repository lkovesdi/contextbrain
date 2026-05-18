"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LogoMark } from "@/components/ui/Logo";

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
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div
        className="w-full max-w-[400px] flex flex-col gap-6 rounded-[14px] border border-mist bg-bone-2 p-8"
        style={{ boxShadow: "var(--shadow-1)" }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-[10px]">
            <LogoMark size={28} />
            <span className="font-display text-[28px] tracking-[-0.015em] text-ink leading-none">
              MeetingBrain
            </span>
          </div>
          <p className="text-[14px] text-slate m-0">Sign in with a magic link.</p>
        </div>

        {status === "sent" ? (
          <p className="rounded-[6px] bg-echo-tint border border-echo p-3 text-[13px] text-echo-ink m-0">
            Check <span className="font-medium">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Input
              type="email"
              required
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              error={errorMsg ?? undefined}
            />
            <Button
              type="submit"
              variant="ink"
              disabled={status === "sending"}
              className="w-full justify-center"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
