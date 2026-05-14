"use client";

/**
 * useBreakpoint — SSR-safe window-width hook.
 *
 * Components read the current breakpoint to decide between desktop and
 * mobile layouts at runtime (e.g. MemberList becomes a drawer instead of
 * a fixed sidebar on phones). We expose a *string* breakpoint rather than
 * raw pixel width so callers don't hardcode magic numbers.
 *
 * Breakpoints mirror Tailwind defaults:
 *   - "xs" :   <  640px
 *   - "sm" :   640 – 767px
 *   - "md" :   768 – 1023px   (tablet)
 *   - "lg" :  1024 – 1279px   (small desktop)
 *   - "xl" :  ≥ 1280px        (desktop)
 *
 * During SSR we always return "lg" so the desktop layout renders on the
 * server; a `useEffect` in the hook flips to the real value on mount,
 * avoiding hydration warnings.
 */

import { useEffect, useState } from "react";

export type Breakpoint = "xs" | "sm" | "md" | "lg" | "xl";

function classify(width: number): Breakpoint {
  if (width < 640) return "xs";
  if (width < 768) return "sm";
  if (width < 1024) return "md";
  if (width < 1280) return "lg";
  return "xl";
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("lg");

  useEffect(() => {
    const compute = () => setBp(classify(window.innerWidth));
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  return bp;
}

/** True when the current breakpoint is xs or sm (phone-like). */
export function useIsMobile(): boolean {
  const bp = useBreakpoint();
  return bp === "xs" || bp === "sm";
}
