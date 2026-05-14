"use client";

import { useRef, useCallback } from "react";

/**
 * Returns props you spread on a modal **backdrop** so that clicks/taps that
 * are genuinely on the backdrop dismiss the modal, but presses that started
 * inside the panel and dragged out (selecting text, dragging a slider,
 * leaving a color swatch) do NOT.
 *
 * Usage:
 * ```tsx
 * const backdrop = useDismissOnBackdrop(onClose);
 * return (
 *   <div className="fixed inset-0 z-50 ..." {...backdrop}>
 *     <div onMouseDown={(e) => e.stopPropagation()} className="panel ...">
 *       ...
 *     </div>
 *   </div>
 * );
 * ```
 *
 * Why not just `onClick={onClose}`? A `click` event fires on the deepest
 * common ancestor of mousedown's and mouseup's targets. So pressing inside
 * the panel and releasing on the backdrop produces a click whose target IS
 * the backdrop — closing the modal even though the user was just dragging.
 *
 * This hook fixes that by requiring **both** mousedown and mouseup to land
 * directly on the backdrop element.
 */
export function useDismissOnBackdrop(onDismiss: () => void) {
  const pressedOnBackdrop = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const fire =
        pressedOnBackdrop.current && e.target === e.currentTarget;
      pressedOnBackdrop.current = false;
      if (fire) onDismiss();
    },
    [onDismiss],
  );

  return { onMouseDown, onMouseUp };
}
