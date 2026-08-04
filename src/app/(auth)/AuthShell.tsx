import Link from "next/link";
import { LogoMarkLight } from "@/components/ui/Logo";
import { FluidParticlesBackground } from "@/components/ui/fluid-particles-background";

const BRAND_POINTS = [
  "Live transcription that never misses a beat",
  "Summaries structured the way your team thinks",
  "Chat with every meeting you've ever had",
];

/**
 * Two-column branded shell for the auth screens. The dark editorial panel on
 * the left carries the brand; the right column hosts the form (children).
 * Below `lg` the brand panel collapses to a compact header.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen overflow-hidden bg-ink">
      {/* Ambient "context field" — full-bleed across the whole dark shell. */}
      <div className="pointer-events-none absolute inset-0">
        <FluidParticlesBackground
          particleCount={2000}
          particleColor="150, 148, 245"
          trailColor="rgba(20, 21, 26, 0.06)"
          className="h-full"
        />
      </div>

      {/* Indigo bloom on the brand side. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 90% at 12% 0%, color-mix(in srgb, var(--cortex) 30%, transparent) 0%, color-mix(in srgb, var(--cortex) 0%, transparent) 52%)",
        }}
      />
      {/* Gentle darkening behind the form so it stays legible over the field. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(75% 95% at 82% 50%, rgba(20,21,26,0.55) 0%, rgba(20,21,26,0) 72%)",
        }}
      />

      {/* Brand panel (content only — the dark + field sit behind it). */}
      <aside className="relative z-10 hidden w-[44%] max-w-[560px] flex-col justify-between p-12 lg:flex">
        <Link href="/" className="flex items-center gap-[10px]">
          <LogoMarkLight size={26} />
          <span className="font-display text-[26px] leading-none tracking-[-0.015em] text-float-ink">
            ContextBrain
          </span>
        </Link>

        <div className="flex flex-col gap-7">
          <h1 className="font-display text-[44px] leading-[1.05] tracking-[-0.018em] text-float-ink">
            Every meeting,
            <br />
            turned into context
            <span className="text-float-accent"> you can use.</span>
          </h1>
          <ul className="flex flex-col gap-[14px]">
            {BRAND_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[14px] text-float-ink-2">
                <span className="mt-[7px] h-[5px] w-[5px] flex-shrink-0 rounded-full bg-cortex" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-float-ink-3">
          Futuristic, but calm.
        </p>
      </aside>

      {/* Form panel */}
      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-8 rounded-[16px] border border-float-border bg-float-ink/[0.03] p-8 backdrop-blur-md">
          <Link href="/" className="flex items-center gap-[10px] lg:hidden">
            <LogoMarkLight size={24} />
            <span className="font-display text-[24px] leading-none tracking-[-0.015em] text-float-ink">
              ContextBrain
            </span>
          </Link>
          {children}
        </div>
      </section>
    </main>
  );
}
