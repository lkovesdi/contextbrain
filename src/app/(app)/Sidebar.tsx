"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ComponentType } from "react";
import { Mic, Database, FolderClosed } from "lucide-react";
import PlugConnectedIcon from "@/components/icons/PlugConnectedIcon";
import BookmarkIcon from "@/components/icons/BookmarkIcon";
import type { AnimatedIconHandle } from "@/components/icons/types";
import { LogoMark } from "@/components/ui/Logo";
import { SignOutButton } from "./SignOutButton";

type LucideIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

type NavEntry = {
  href: string;
  label: string;
  match: (p: string) => boolean;
} & (
  | { kind: "static"; icon: LucideIcon }
  | { kind: "animated"; icon: "plug" | "bookmark" }
);

const NAV: NavEntry[] = [
  { kind: "static",   href: "/meetings",     label: "Meetings",     icon: Mic,          match: (p) => p.startsWith("/meetings") },
  { kind: "static",   href: "/spaces",       label: "Spaces",       icon: FolderClosed, match: (p) => p.startsWith("/spaces") },
  { kind: "static",   href: "/contexts",     label: "Contexts",     icon: Database,     match: (p) => p.startsWith("/contexts") },
  { kind: "animated", href: "/presets",      label: "Presets",      icon: "bookmark",   match: (p) => p.startsWith("/presets") },
  { kind: "animated", href: "/integrations", label: "Integrations", icon: "plug",       match: (p) => p.startsWith("/integrations") },
];

const ROW_CLASSES = (active: boolean) =>
  [
    "flex items-center gap-[10px] px-[10px] py-[7px] rounded-[6px] text-[13.5px]",
    "transition-colors duration-[120ms] ease-[var(--ease-out)]",
    active ? "bg-cortex-tint text-cortex-ink" : "text-ink-2 hover:bg-paper-2",
  ].join(" ");

const ICON_COLOR = (active: boolean) => (active ? "text-cortex" : "text-slate");

export function Sidebar({
  userEmail,
  orgName,
}: {
  userEmail: string;
  orgName?: string | null;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:flex-col w-[224px] flex-shrink-0 bg-bone-2 border-r border-mist p-[18px] gap-[22px]">
      <Link href="/meetings" className="flex flex-col gap-[6px] px-1 py-0.5 -mx-1">
        <span className="flex items-center gap-[10px]">
          <LogoMark size={22} />
          <span className="font-display text-[22px] tracking-[-0.015em] text-ink leading-none">
            ContextBrain
          </span>
        </span>
        {orgName && (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-2 truncate pl-[1px]">
            {orgName}
          </span>
        )}
      </Link>

      <nav className="flex flex-col gap-[2px]">
        {NAV.map((item) => {
          const active = item.match(pathname);
          if (item.kind === "animated") {
            return (
              <AnimatedNavItem
                key={item.href}
                href={item.href}
                label={item.label}
                active={active}
                icon={item.icon}
              />
            );
          }
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={ROW_CLASSES(active)}>
              <Icon size={14} strokeWidth={1.6} className={ICON_COLOR(active)} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-[14px] border-t border-mist flex flex-col gap-[6px]">
        <div
          className="font-mono text-[11px] text-slate truncate"
          title={userEmail}
        >
          {userEmail}
        </div>
        <SignOutButton />
      </div>
    </aside>
  );
}

// Wraps an animated icon so hovering anywhere on the row drives its
// animation (each icon has its own hover handlers too, but a row this
// narrow makes hitting just the icon fiddly).
const ANIMATED_ICONS = {
  plug: PlugConnectedIcon,
  bookmark: BookmarkIcon,
} as const;

function AnimatedNavItem({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: keyof typeof ANIMATED_ICONS;
}) {
  const iconRef = useRef<AnimatedIconHandle | null>(null);
  const Icon = ANIMATED_ICONS[icon];
  return (
    <Link
      href={href}
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
      className={ROW_CLASSES(active)}
    >
      <Icon
        ref={iconRef}
        size={14}
        strokeWidth={1.6}
        className={ICON_COLOR(active)}
      />
      {label}
    </Link>
  );
}
