"use client";

/**
 * Generic "coming soon" modal used for Discovery & Add-server entries until
 * the real flows are implemented. Keeps clicks from silently no-op'ing.
 */

import { X, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";

type Props = {
  title: string;
  description: string;
  onClose: () => void;
};

export default function PlaceholderModal({ title, description, onClose }: Props) {
  const backdrop = useDismissOnBackdrop(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"
      {...backdrop}
    >
      <div
        className="w-full max-w-md rounded-lg border border-[var(--bg-mid)] bg-[var(--bg-darker)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="h-20 bg-gradient-to-br from-[var(--accent)]/40 to-[#7e3a8c]/40 relative grid place-items-center">
          <Sparkles size={40} className="text-[var(--accent)] drop-shadow-[0_0_12px_var(--accent-glow)]" />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 size-7 grid place-items-center rounded-full bg-black/40 text-white hover:bg-black/70"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <h2
            className="text-xl font-bold text-[var(--text-bright)] mb-2"
            style={{ fontFamily: '"Cinzel", "Noto Serif SC", serif' }}
          >
            {title}
          </h2>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed">
            {description}
          </p>
          <button
            onClick={onClose}
            className="mt-5 w-full h-9 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium"
          >
            好
          </button>
        </div>
      </div>
    </div>
  );
}
