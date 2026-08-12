"use client";

import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

// Story: the lid springs open and stays up while data "writes" into the
// cylinder — the middle ring redraws itself in a loop like a scan pass.
const DatabaseIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".db-lid",
        { y: -2.2 },
        { type: "spring", stiffness: 350, damping: 14 },
      );
      animate(
        ".db-band",
        { pathLength: [0, 1] },
        { duration: 0.9, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.25 },
      );
    }, [animate]);

    const stop = useCallback(async () => {
      animate(".db-lid", { y: 0 }, { duration: 0.25, ease: "easeInOut" });
      animate(".db-band", { pathLength: 1 }, { duration: 0.3, ease: "easeOut" });
    }, [animate]);

    useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }));

    return (
      <motion.svg
        ref={scope}
        onHoverStart={start}
        onHoverEnd={stop}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`cursor-pointer ${className}`}
        style={{ overflow: "visible" }}
      >
        <motion.ellipse className="db-lid" cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <motion.path className="db-band" d="M3 12A9 3 0 0 0 21 12" />
      </motion.svg>
    );
  },
);

DatabaseIcon.displayName = "DatabaseIcon";
export default DatabaseIcon;
