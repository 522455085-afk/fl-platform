"use client";

/**
 * Global toast viewport. Renders any ephemeral toasts published via
 * `toast(...)` from `@/lib/toast-store`. Mount once near the root.
 *
 * Positioning: bottom-center, above the channel composer / member
 * list. Stacks newest at the bottom so reading order matches arrival
 * order, but limits to 5 visible so a flood doesn't push the page
 * around.
 */

import { useToastStore } from "@/lib/toast-store";

export default function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  const visible = toasts.slice(-5);
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2">
      {visible.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={[
            "pointer-events-auto px-4 py-2 rounded-md shadow-lg text-sm font-medium",
            "transition-opacity duration-150 animate-[fade-in_0.15s_ease-out]",
            t.kind === "success"
              ? "bg-emerald-600 text-white"
              : t.kind === "error"
                ? "bg-rose-600 text-white"
                : "bg-[var(--bg-panel)] text-[var(--text-primary)] border border-[var(--border)]",
          ].join(" ")}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
