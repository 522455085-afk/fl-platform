"use client";

/**
 * Persistent offline banner shown at the top of the window.
 * Displays pending message count and auto-hides when back online.
 */

import { useOfflineQueue } from "@/lib/offline-queue-store";
import { WifiOff, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/provider";

export default function OfflineBanner() {
  const isOffline = useOfflineQueue((s) => s.isOffline);
  const pending = useOfflineQueue((s) => s.pending);
  const t = useT();

  if (!isOffline && pending === 0) return null;

  return (
    <div className="shrink-0 bg-[var(--warning)]/15 border-b border-[var(--warning)]/30 px-4 py-1.5 flex items-center gap-2 text-xs">
      {isOffline ? (
        <WifiOff size={14} className="text-[var(--warning)]" />
      ) : (
        <Loader2 size={14} className="text-[var(--success)] animate-spin" />
      )}
      <span className="text-[var(--warning)] font-medium">
        {isOffline
          ? t("offline.banner")
          : t("offline.reconnecting")}
      </span>
      {pending > 0 && (
        <span className="text-[var(--text-muted)]">
          · {t("offline.pending").replace("{n}", String(pending))}
        </span>
      )}
    </div>
  );
}
