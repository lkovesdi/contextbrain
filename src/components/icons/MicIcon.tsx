"use client";

import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

// Story: the mic is live — the capsule bounces like a VU meter picking
// up audio while the pickup arc pulses with it. Loops while hovered.
const MicIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".mic-capsule",
        { scaleY: [1, 1.14, 0.88, 1.1, 0.93, 1.06, 1] },
        { duration: 1.1, ease: "easeInOut", repeat: Infinity },
      );
      animate(
        ".mic-arc",
        { scale: [1, 1.08, 1, 1.06, 1] },
        { duration: 1.1, ease: "easeInOut", repeat: Infinity },
      );
    }, [animate]);

    const stop = useCallback(async () => {
      animate(".mic-capsule", { scaleY: 1 }, { duration: 0.25, ease: "easeOut" });
      animate(".mic-arc", { scale: 1 }, { duration: 0.25, ease: "easeOut" });
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
        <path d="M12 19v3" />
        <motion.path className="mic-arc" style={{ transformOrigin: "50% 55%" }} d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <motion.rect className="mic-capsule" style={{ transformOrigin: "50% 62.5%" }} x="9" y="2" width="6" height="13" rx="3" />
      </motion.svg>
    );
  },
);

MicIcon.displayName = "MicIcon";
export default MicIcon;
