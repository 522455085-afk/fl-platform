"use client";

/**
 * Theme-styled hover tooltip.
 *
 * The browser's native `title` attribute can't be styled (renders in
 * the OS' default chrome — usually a stark white box with system
 * font). Wrap interactive elements with this component to get a
 * tooltip that matches the rest of the app's theme: dark surface,
 * accent ring, small font.
 *
 * Usage:
 *   <Tooltip label="提及成员"><AtSign size={20} /></Tooltip>
 *
 * The wrapper renders an inline-flex container so it doesn't disturb
 * existing layout, and the tooltip itself is absolutely positioned
 * above the trigger with a small gap. Placement defaults to "top"
 * because composer toolbar buttons live at the bottom of the chat —
 * pass `placement="bottom"` for elements at the top of the viewport.
 */

import { useState, memo, type ReactNode, type ReactElement } from "react";

type Props = {
  label: string;
  children: ReactElement;
  placement?: "top" | "bottom";
  /** Optional class for the wrapping span (e.g. to make the trigger
   *  fill its parent). */
  className?: string;
};

// Memoized comparison — only re-render when label, placement, or children change
const Tooltip = memo(function Tooltip({
  label,
  children,
  placement = "top",
  className,
}: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className={
        "relative inline-flex" + (className ? " " + className : "")
      }
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={[
            "pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap z-[9999]",
            "px-2 py-1 rounded-md text-[11px] font-medium",
            "bg-[var(--bg-darkest)] text-[var(--text-bright)]",
            "border border-[var(--accent)]/40 shadow-[0_0_10px_var(--accent-glow,rgba(255,255,255,0.15))]",
            placement === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          ].join(" ")}
        >
          {label}
        </span>
      )}
    </span>
  );
});

export default Tooltip;
