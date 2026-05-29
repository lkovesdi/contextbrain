"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ArrowRight, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { LogoMark } from "@/components/ui/Logo";
import { Eyebrow } from "@/components/ui/typography";

const INDUSTRIES: SelectOption[] = [
  { value: "technology", label: "Technology / Software" },
  { value: "financial", label: "Financial Services" },
  { value: "healthcare", label: "Healthcare" },
  { value: "education", label: "Education" },
  { value: "media", label: "Media & Entertainment" },
  { value: "retail", label: "Retail & E-commerce" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "professional", label: "Professional Services" },
  { value: "government", label: "Government & Public Sector" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" },
];

const SIZES: SelectOption[] = [
  { value: "1-10", label: "1–10 people" },
  { value: "11-50", label: "11–50 people" },
  { value: "51-200", label: "51–200 people" },
  { value: "201-500", label: "201–500 people" },
  { value: "501-1000", label: "501–1,000 people" },
  { value: "1000+", label: "1,000+ people" },
];

type Props =
  | { mode: "create"; email: string; domain: string; suggestedName: string }
  | {
      mode: "join";
      email: string;
      domain: string;
      existingOrg: { id: string; name: string; memberCount: number };
    }
  | { mode: "solo"; email: string; reason: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-12">
      <div className="mb-8 flex items-center gap-[10px]">
        <LogoMark size={24} />
        <span className="font-display text-[24px] leading-none tracking-[-0.015em] text-ink">
          ContextBrain
        </span>
      </div>
      <div
        className="w-full max-w-[440px] rounded-[14px] border border-mist bg-bone-2 p-8"
        style={{ boxShadow: "var(--shadow-2)" }}
      >
        {children}
      </div>
    </main>
  );
}

export function OnboardingFlow(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goToApp() {
    router.push("/meetings");
    router.refresh();
  }

  // --- Create ---
  const [name, setName] = useState(props.mode === "create" ? props.suggestedName : "");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("create_organization", {
      p_name: name.trim(),
      p_industry: industry || null,
      p_size: size || null,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    goToApp();
  }

  async function joinOrg() {
    if (props.mode !== "join") return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("join_organization", { p_org_id: props.existingOrg.id });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    goToApp();
  }

  if (props.mode === "join") {
    return (
      <Shell>
        <Eyebrow>Join your team</Eyebrow>
        <h1 className="mt-3 font-display text-[28px] leading-[1.15] tracking-[-0.012em] text-ink">
          {props.existingOrg.name} is already here
        </h1>
        <p className="mt-2 text-[14px] text-slate">
          Your colleagues at <span className="font-medium text-ink">{props.domain}</span> have a
          workspace
          {props.existingOrg.memberCount > 0 && (
            <> with {props.existingOrg.memberCount} member{props.existingOrg.memberCount === 1 ? "" : "s"}</>
          )}
          .
        </p>

        <div className="mt-6 flex items-center gap-3 rounded-[10px] border border-mist bg-paper p-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[8px] bg-cortex-tint text-cortex">
            <Building2 size={18} strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-ink">{props.existingOrg.name}</div>
            <div className="font-mono text-[11px] text-slate-2">{props.domain}</div>
          </div>
        </div>

        {error && <p className="mt-4 text-[13px] text-pulse">{error}</p>}

        <div className="mt-6 flex flex-col gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={joinOrg}
            disabled={busy}
            rightIcon={<ArrowRight size={16} strokeWidth={1.8} />}
            className="w-full justify-center"
          >
            {busy ? "Joining…" : `Join ${props.existingOrg.name}`}
          </Button>
          <button
            type="button"
            onClick={goToApp}
            disabled={busy}
            className="cursor-pointer self-center text-[13px] text-slate hover:text-ink transition-colors disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      </Shell>
    );
  }

  if (props.mode === "solo") {
    return (
      <Shell>
        <Eyebrow>You&apos;re all set</Eyebrow>
        <h1 className="mt-3 font-display text-[28px] leading-[1.15] tracking-[-0.012em] text-ink">
          Welcome to ContextBrain
        </h1>
        <p className="mt-2 text-[14px] text-slate">
          You&apos;re signed in as <span className="font-medium text-ink">{props.email}</span>. You
          can use ContextBrain on your own — set up an organization later from a work email when
          you&apos;re ready to collaborate.
        </p>
        <div className="mt-6">
          <Button
            variant="primary"
            size="lg"
            onClick={goToApp}
            rightIcon={<ArrowRight size={16} strokeWidth={1.8} />}
            className="w-full justify-center"
          >
            Continue to ContextBrain
          </Button>
        </div>
      </Shell>
    );
  }

  // --- Create ---
  return (
    <Shell>
      <Eyebrow>Set up your organization</Eyebrow>
      <h1 className="mt-3 font-display text-[28px] leading-[1.15] tracking-[-0.012em] text-ink">
        Tell us about your company
      </h1>
      <p className="mt-2 flex items-center gap-2 text-[14px] text-slate">
        <Check size={14} strokeWidth={2} className="text-echo" />
        Verified work domain
        <span className="font-mono text-[12px] text-ink">{props.domain}</span>
      </p>

      <form onSubmit={createOrg} className="mt-6 flex flex-col gap-4">
        <Input
          label="Organization name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc."
          required
          autoFocus
        />
        <Select
          label="Industry"
          value={industry}
          onChange={setIndustry}
          options={INDUSTRIES}
          placeholder="Select an industry"
          fullWidth
        />
        <Select
          label="Company size"
          value={size}
          onChange={setSize}
          options={SIZES}
          placeholder="Select company size"
          fullWidth
        />

        {error && <p className="m-0 text-[13px] text-pulse">{error}</p>}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={busy || name.trim().length === 0}
          rightIcon={<ArrowRight size={16} strokeWidth={1.8} />}
          className="mt-1 w-full justify-center"
        >
          {busy ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </Shell>
  );
}
