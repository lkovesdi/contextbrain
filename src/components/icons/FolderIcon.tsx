"use client";

import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

// Story: the folder tips open and a document pops out of the top,
// holding that pose while hovered; on leave the paper tucks back in.
const FolderIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".folder-group",
        { rotate: -6, y: 1 },
        { type: "spring", stiffness: 300, damping: 15 },
      );
      animate(
        ".folder-paper",
        { y: 0, opacity: 1 },
        { duration: 0.3, ease: "backOut", delay: 0.05 },
      );
    }, [animate]);

    const stop = useCallback(async () => {
      animate(".folder-paper", { y: 5, opacity: 0 }, { duration: 0.2, ease: "easeIn" });
      animate(".folder-group", { rotate: 0, y: 0 }, { duration: 0.25, ease: "easeInOut" });
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
        <motion.rect
          className="folder-paper"
          style={{ y: 5, opacity: 0 }}
          x="10"
          y="0.5"
          width="5.5"
          height="6"
          rx="0.5"
        />
        <motion.g className="folder-group" style={{ transformOrigin: "50% 90%" }}>
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          <path d="M2 10h20" />
        </motion.g>
      </motion.svg>
    );
  },
);

FolderIcon.displayName = "FolderIcon";
export default FolderIcon;
