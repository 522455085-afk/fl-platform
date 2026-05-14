"use client";

/**
 * iOS-style scroll wheel for picking a number from a fixed range.
 *
 * Pure-CSS scroll snapping; no library, no transform math beyond what
 * the browser does for free. The selected item is whichever option
 * is in the center band of the visible viewport when scrolling stops.
 *
 * The wheel is fully accessible: each option is a focusable button
 * so keyboard users can tab + arrow through. Mouse wheel events are
 * forwarded into the scroll container (the default behaviour).
 *
 * Why we don't use `<input type="number">` + arrow buttons here: the
 * caller (MuteDialog) wants a touch-friendly look, and the wheel
 * disambiguates the "00:00–24:00" range much faster than typing.
 */

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

export type WheelPickerProps = {
  /** Lower bound (inclusive). */
  min: number;
  /** Upper bound (inclusive). */
  max: number;
  /** Step between adjacent options. Default 1. */
  step?: number;
  /** Current value. Must equal one of the generated options or it
   *  will snap to the nearest valid one. */
  value: number;
  /** Called when the wheel comes to rest on a new option. */
  onChange: (next: number) => void;
  /** Optional unit label rendered to the right of each item. e.g. "时". */
  suffix?: string;
  /** Pixel height per option. Default 36; 5 visible rows = 180px. */
  itemHeight?: number;
  /** Number of rows visible at once (always odd so there's a center).
   *  Default 5. */
  visibleRows?: number;
  /** Width override; defaults to ~6rem so two wheels fit side-by-side
   *  comfortably in a modal. */
  className?: string;
};

export default function WheelPicker({
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix,
  itemHeight = 36,
  visibleRows = 5,
  className,
}: WheelPickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Debounce-id for the post-scroll commit. Refs are fine — we don't
  // need to re-render when this changes.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options = useMemo(() => {
    const arr: number[] = [];
    for (let i = min; i <= max; i += step) arr.push(i);
    return arr;
  }, [min, max, step]);

  // visibleRows must be odd so there's a single middle row. The
  // number we render to the *top* and *bottom* of the list as
  // padding "ghost" rows. Otherwise the first/last real options
  // could never reach the center band.
  const padRows = Math.floor(visibleRows / 2);

  // Find the index of the currently-selected value, snapping to the
  // closest legal option if the prop is malformed.
  const selectedIdx = useMemo(() => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < options.length; i++) {
      const d = Math.abs(options[i] - value);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }, [options, value]);

  // Programmatically scroll to align the selected option with the
  // center band whenever `value` changes from outside (e.g., parent
  // reset). We use `scrollTo` with `behavior: "auto"` for sync alignment
  // on mount, then `smooth` for subsequent updates.
  const didMount = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: selectedIdx * itemHeight,
      behavior: didMount.current ? "smooth" : "auto",
    });
    didMount.current = true;
  }, [selectedIdx, itemHeight]);

  // Handle scroll: debounce a settle event, find the nearest option
  // to the current scroll offset, snap and commit via onChange.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const idx = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(options.length - 1, idx));
      const next = options[clamped];
      if (next !== value) onChange(next);
      // Re-snap in case scroll-snap-y didn't quite center it (long
      // gestures sometimes leave a fractional offset).
      el.scrollTo({ top: clamped * itemHeight, behavior: "smooth" });
    }, 120);
  };

  return (
    <div
      className={cn(
        "relative select-none",
        // Tailwind doesn't give us a clean way to express "120px wide";
        // 6rem == 96px which is enough for 3 digits + suffix.
        "w-24",
        className,
      )}
      style={{ height: itemHeight * visibleRows }}
    >
      {/* Center selection highlight — sits behind the scroll viewport
          so the chosen option visually sits inside it. */}
      <div
        aria-hidden
        className="absolute inset-x-0 pointer-events-none border-y border-[var(--accent)]/40 bg-[var(--accent)]/10 rounded"
        style={{
          top: padRows * itemHeight,
          height: itemHeight,
        }}
      />
      {/* Scroll container. Padding-y creates the "ghost" rows so that
          the first/last options can be aligned with the center band. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-scroll snap-y snap-mandatory scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div style={{ height: padRows * itemHeight }} aria-hidden />
        {options.map((opt, i) => {
          const isSelected = i === selectedIdx;
          return (
            <button
              key={opt}
              type="button"
              tabIndex={isSelected ? 0 : -1}
              onClick={() => {
                onChange(opt);
                scrollRef.current?.scrollTo({
                  top: i * itemHeight,
                  behavior: "smooth",
                });
              }}
              className={cn(
                "block w-full text-center snap-center transition-colors tabular-nums",
                isSelected
                  ? "text-white font-semibold text-base"
                  : "text-[var(--text-muted)] text-sm",
              )}
              style={{ height: itemHeight, lineHeight: `${itemHeight}px` }}
            >
              {opt.toString().padStart(2, "0")}
              {suffix && (
                <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                  {suffix}
                </span>
              )}
            </button>
          );
        })}
        <div style={{ height: padRows * itemHeight }} aria-hidden />
      </div>
    </div>
  );
}
