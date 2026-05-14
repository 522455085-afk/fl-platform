"use client";

/**
 * useLongPress — unified press-and-hold handler for touch + mouse.
 *
 * Long-press is how mobile users "right-click" in our app. The goal is to
 * let existing `onContextMenu` UIs (member list, messages, server icons)
 * surface the same menu via touch without duplicating logic. Components
 * call `useLongPress(onLongPress)` and spread the returned handlers onto
 * the element — the hook fires `onLongPress(point)` once the user has
 * held for `delay` ms without moving too far.
 *
 * Design notes:
 *   - We cancel on scroll and on any pointer movement beyond a small
 *     threshold (10px); this avoids false-triggers during list scrolling
 *     on phones.
 *   - The callback receives the original screen coords so the caller can
 *     anchor a context menu at that point.
 *   - We expose a matching `onContextMenu` that calls the same callback
 *     with `preventDefault()` so desktop right-clicks still work and the
 *     component doesn't need to wire both hooks.
 */

import { useCallback, useRef } from "react";

export type LongPressPoint = { x: number; y: number };

export type LongPressHandlers = {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

const DEFAULT_DELAY_MS = 500;
const MAX_MOVEMENT_PX = 10;

export function useLongPress(
  onLongPress: (point: LongPressPoint) => void,
  opts: { delay?: number } = {},
): LongPressHandlers {
  const { delay = DEFAULT_DELAY_MS } = opts;
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<LongPressPoint | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) {
        clear();
        return;
      }
      const t = e.touches[0];
      startRef.current = { x: t.clientX, y: t.clientY };
      firedRef.current = false;
      timerRef.current = window.setTimeout(() => {
        if (startRef.current) {
          firedRef.current = true;
          onLongPress(startRef.current);
        }
        timerRef.current = null;
      }, delay);
    },
    [onLongPress, delay, clear],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!startRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startRef.current.x;
      const dy = t.clientY - startRef.current.y;
      if (dx * dx + dy * dy > MAX_MOVEMENT_PX * MAX_MOVEMENT_PX) {
        // Finger moved too far — treat as a scroll, cancel the long press.
        clear();
      }
    },
    [clear],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // If the long-press already fired, swallow the subsequent tap so the
      // ghost click doesn't also select the row behind the menu.
      if (firedRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
      clear();
    },
    [clear],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onLongPress({ x: e.clientX, y: e.clientY });
    },
    [onLongPress],
  );

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
    onContextMenu: handleContextMenu,
  };
}
