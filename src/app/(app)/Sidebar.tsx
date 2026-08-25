"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from "react";
import MicIcon from "@/components/icons/MicIcon";
import FolderIcon from "@/components/icons/FolderIcon";
import DatabaseIcon from "@/components/icons/DatabaseIcon";
import WorkflowIcon from "@/components/icons/WorkflowIcon";
import BookmarkIcon from "@/components/icons/BookmarkIcon";
import PlugConnectedIcon from "@/components/icons/PlugConnectedIcon";
import SettingsIcon from "@/components/icons/SettingsIcon";
import type { AnimatedIconHandle, AnimatedIconProps } from "@/components/icons/types";
import { LogoMark } from "@/components/ui/Logo";
import { SignOutButton } from "./SignOutButton";

type AnimatedIcon = ForwardRefExoticComponent<AnimatedIconProps & RefAttributes<AnimatedIconHandle>>;

type NavEntry = {
  href: string;
  label: string;
  icon: AnimatedIcon;
  match: (p: string) => boolean;
};

const NAV: NavEntry[] = [
  { href: "/meetings",     label: "Meetings",     icon: MicIcon,            match: (p) => p.startsWith("/meetings") },
  { href: "/spaces",       label: "Spaces",       icon: FolderIcon,         match: (p) => p.startsWith("/spaces") },
  { href: "/contexts",     label: "Contexts",     icon: DatabaseIcon,       match: (p) => p.startsWith("/contexts") },
  { href: "/diagrams",     label: "Diagrams",     icon: WorkflowIcon,       match: (p) => p.startsWith("/diagrams") },
  { href: "/presets",      label: "Presets",      icon: BookmarkIcon,       match: (p) => p.startsWith("/presets") },
  { href: "/integrations", label: "Integrations", icon: PlugConnectedIcon,  match: (p) => p.startsWith("/integrations") },
  { href: "/settings",     label: "Settings",     icon: SettingsIcon,       match: (p) => p.startsWith("/settings") },
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

  // The nav targets are dynamic routes, so the URL only changes once the
  // server responds. Move the highlight optimistically on click and reconcile
  // with the real pathname when the navigation lands.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [pathname]);
  const current = pending ?? pathname;

  // In the desktop app the top --titlebar-inset (28px) of the window is the
  // native traffic-light / drag-strip zone — content there is covered and
  // clicks drag the window, so the brand must start below it.
  return (
    <aside className="hidden md:flex md:flex-col w-[224px] flex-shrink-0 bg-bone-2 border-r border-mist p-[18px] pt-[calc(18px+var(--titlebar-inset,0px))] gap-[22px]">
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
          const active = item.match(current);
          return (
            <AnimatedNavItem
              key={item.href}
              href={item.href}
              label={item.label}
              active={active}
              Icon={item.icon}
              onNavigate={() => setPending(item.href)}
            />
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
function AnimatedNavItem({
  href,
  label,
  active,
  Icon,
  onNavigate,
}: {
  href: string;
  label: string;
  active: boolean;
  Icon: AnimatedIcon;
  onNavigate: () => void;
}) {
  const iconRef = useRef<AnimatedIconHandle | null>(null);
  return (
    <Link
      href={href}
      onClick={(e) => {
        // Modified clicks open elsewhere — this window's pathname won't
        // change, so don't move the highlight.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
          return;
        onNavigate();
      }}
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
