"use client";

/**
 * Top-level component that subscribes to kick_signals and renders a
 * transient banner when the current user is forcibly removed from a
 * voice channel by an admin. Mount once in `page.tsx` alongside other
 * global overlays (e.g. HighPriorityWatcher).
 */

import { UserX, X } from "lucide-react";
import { useKickSignalWatcher } from "@/lib/force-kick";

export default function KickWatcher() {
  const { toast, dismissToast } = useKickSignalWatcher();
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] max-w-[min(90vw,520px)]">
      <div className="bg-[var(--bg-darkest)] border border-[var(--danger)]/70 rounded-lg shadow-2xl px-4 py-3 flex items-center gap-3 animate-in fade-in slide-in-from-bottom">
        <UserX size={18} className="text-[var(--danger)] shrink-0" />
        <span className="text-sm text-white flex-1">{toast}</span>
        <button
          type="button"
          aria-label="关闭"
          onClick={dismissToast}
          className="text-[var(--text-muted)] hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
