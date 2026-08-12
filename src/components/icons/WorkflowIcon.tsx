"use client";

import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

// Story: a signal travels through the pipeline — node A fires, the pulse
// draws its way down the connector, node B fires on arrival. Loops at a
// shared 1.2s cycle while hovered.
const WorkflowIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".wf-node-a",
        { scale: [1, 1.25, 1] },
        { duration: 0.35, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.85 },
      );
      animate(
        ".wf-connector",
        { pathLength: [0, 1] },
        { duration: 0.55, ease: "easeInOut", delay: 0.15, repeat: Infinity, repeatDelay: 0.65 },
      );
      animate(
        ".wf-node-b",
        { scale: [1, 1.25, 1] },
        { duration: 0.35, ease: "easeInOut", delay: 0.6, repeat: Infinity, repeatDelay: 0.85 },
      );
    }, [animate]);

    const stop = useCallback(async () => {
      animate(".wf-node-a, .wf-node-b", { scale: 1 }, { duration: 0.2, ease: "easeInOut" });
      animate(".wf-connector", { pathLength: 1 }, { duration: 0.25, ease: "easeOut" });
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
        <motion.rect className="wf-node-a" style={{ transformOrigin: "29% 29%" }} width="8" height="8" x="3" y="3" rx="2" />
        <motion.path className="wf-connector" d="M7 11v4a2 2 0 0 0 2 2h4" />
        <motion.rect className="wf-node-b" style={{ transformOrigin: "71% 71%" }} width="8" height="8" x="13" y="13" rx="2" />
      </motion.svg>
    );
  },
);

WorkflowIcon.displayName = "WorkflowIcon";
export default WorkflowIcon;
