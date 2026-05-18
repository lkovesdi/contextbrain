"use client";

import * as React from "react";
import { createPortal } from "react-dom";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: "max-w-[380px]",
  md: "max-w-[480px]",
  lg: "max-w-[640px]",
};

export function Modal({
  open,
  onClose,
  size = "md",
  labelledBy,
  describedBy,
  children,
  closeOnBackdrop = true,
  closeOnEsc = true,
}: {
  open: boolean;
  onClose: () => void;
  size?: Size;
  labelledBy?: string;
  describedBy?: string;
  children: React.ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
}) {
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Standard "render only after client mount to avoid SSR/CSR hydration
  // mismatch on the portal target" pattern. The lint rule is overly cautious
  // here — this fires once per mount, not on every render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevActive = document.activeElement as HTMLElement | null;

    function onKey(e: KeyboardEvent) {
      if (closeOnEsc && e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);

    queueMicrotask(() => {
      const root = panelRef.current;
      if (!root) return;
      const focusable = root.querySelector<HTMLElement>(
        "[data-autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      focusable?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      prevActive?.focus?.();
    };
  }, [open, closeOnEsc, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-[mb-fade-in_120ms_ease-out]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={[
          "relative w-full rounded-[12px] bg-bone border border-mist shadow-[0_18px_48px_-12px_rgba(20,20,30,0.28)]",
          "animate-[mb-modal-in_140ms_var(--ease-out)] outline-none",
          SIZE[size],
        ].join(" ")}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export function ModalHeader({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-[22px] pt-[20px] pb-[10px]">
      <h2
        id={id}
        className="font-display text-[18px] tracking-[-0.012em] text-ink m-0 leading-[1.3]"
      >
        {children}
      </h2>
    </div>
  );
}

export function ModalBody({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={["px-[22px] pb-[18px] text-[13px] text-slate leading-[1.5]", className].join(" ")}
    >
      {children}
    </div>
  );
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 px-[18px] py-[14px] border-t border-mist bg-bone-2 rounded-b-[12px]">
      {children}
    </div>
  );
}
