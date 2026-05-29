import Link from "next/link";
import { redirect } from "next/navigation";
import { Mic, Sparkles, MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LogoMarkLight } from "@/components/ui/Logo";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/typography";
import { FluidParticlesBackground } from "@/components/ui/fluid-particles-background";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Mic,
    title: "Capture",
    body: "Live, accurate transcription for every meeting — in the browser or on the desktop.",
  },
  {
    icon: Sparkles,
    title: "Structure",
    body: "Summaries, decisions, and action items generated the way your team actually works.",
  },
  {
    icon: MessagesSquare,
    title: "Recall",
    body: "Ask questions across all of your meetings and connected context, and get cited answers.",
  },
];

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/meetings");

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-ink">
      {/* Ambient "context field" — a calm Cortex-tinted particle flow behind the hero. */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <FluidParticlesBackground
          particleCount={2000}
          particleColor="150, 148, 245"
          trailColor="rgba(20, 21, 26, 0.06)"
          className="h-full"
        />
      </div>
      {/* Soft vignette keeps the field subtle and the copy fully legible. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 16%, rgba(20,21,26,0) 0%, rgba(20,21,26,0.55) 50%, var(--ink) 90%)",
        }}
      />
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="flex items-center gap-[10px]">
          <LogoMarkLight size={24} />
          <span className="font-display text-[24px] leading-none tracking-[-0.015em] text-paper">
            ContextBrain
          </span>
        </span>
        <nav className="flex items-center gap-2">
          <Link
            href="/login"
            className="cursor-pointer rounded-[8px] px-[14px] py-[9px] text-[14px] font-medium text-mist transition-colors hover:bg-white/5 hover:text-paper"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="cursor-pointer rounded-[8px] bg-cortex px-[16px] py-[10px] text-[14px] font-medium text-white transition-colors hover:bg-cortex-hover"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-[920px] flex-col items-center px-6 pb-16 pt-16 text-center sm:pt-24">
          <Eyebrow>Meeting intelligence for teams</Eyebrow>
          <h1 className="mt-5 max-w-[760px] font-display text-[clamp(44px,7vw,72px)] leading-[1.02] tracking-[-0.02em] text-paper">
            Every meeting, turned into
            <span className="text-cortex-tint-2"> context you can use.</span>
          </h1>
          <p className="mt-6 max-w-[560px] text-[17px] leading-[1.55] text-mist">
            Record, summarize, and chat with your meetings — then bring in the docs, tickets, and
            code that give them meaning. Set up your organization in under a minute.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="cursor-pointer rounded-[8px] bg-cortex px-[22px] py-[13px] text-[15px] font-medium text-white transition-colors hover:bg-cortex-hover"
            >
              Create your organization
            </Link>
            <Link
              href="/login"
              className="cursor-pointer rounded-[8px] border border-white/15 bg-white/5 px-[22px] py-[13px] text-[15px] font-medium text-paper transition-colors hover:bg-white/10"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.07em] text-slate-2">
            Work email required · No credit card
          </p>
        </section>

        <section className="mx-auto grid w-full max-w-[920px] gap-4 px-6 pb-24 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <Card key={title} variant="dark" className="flex flex-col gap-3 p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-cortex-tint text-cortex">
                <Icon size={18} strokeWidth={1.7} />
              </span>
              <h3 className="font-display text-[20px] leading-[1.2] tracking-[-0.01em] text-paper">
                {title}
              </h3>
              <p className="m-0 text-[14px] leading-[1.55] text-mist">{body}</p>
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t border-white/10 px-6 py-6 sm:px-10">
        <p className="m-0 font-mono text-[11px] uppercase tracking-[0.07em] text-slate-2">
          ContextBrain · Futuristic, but calm
        </p>
      </footer>
    </div>
  );
}
