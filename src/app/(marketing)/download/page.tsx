import Link from "next/link";
import { LogoMarkLight } from "@/components/ui/Logo";
import { DownloadCard } from "@/components/ui/DownloadCard";
import { FluidParticlesBackground } from "@/components/ui/fluid-particles-background";

export const metadata = {
  title: "Download ContextBrain for Mac",
  description: "Get the native Mac app for ContextBrain. Auto-updates as new features ship.",
};

export default function DownloadPage() {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-ink text-paper">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <FluidParticlesBackground
          particleCount={1400}
          particleColor="150, 148, 245"
          trailColor="rgba(20, 21, 26, 0.06)"
          className="h-full"
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 16%, rgba(20,21,26,0) 0%, rgba(20,21,26,0.55) 50%, var(--ink) 90%)",
        }}
      />

      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="flex cursor-pointer items-center gap-[10px]">
          <LogoMarkLight size={24} />
          <span className="font-display text-[22px] leading-none tracking-[-0.015em] text-paper">
            ContextBrain
          </span>
        </Link>
        <Link
          href="/meetings"
          className="cursor-pointer text-[13px] text-mist transition-colors hover:text-paper"
        >
          Open in browser
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col gap-3 text-center">
            <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.015em] text-paper">
              ContextBrain for Mac
            </h1>
            <p className="m-0 text-[14px] text-mist">
              Native window for your meetings. Auto-updates as we ship — system audio capture coming next.
            </p>
          </div>

          <DownloadCard />

          <p className="m-0 text-center text-[12px] text-mist">
            macOS 13 Ventura or later · Apple Silicon and Intel
          </p>
        </div>
      </main>
    </div>
  );
}
