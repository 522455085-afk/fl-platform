"use client";

/**
 * Site-wide listener for "high priority" announcements.
 *
 * Mount once at the app root (page.tsx). Subscribes to INSERTs on the
 * `messages` table and, for each row flagged `priority === "high"`,
 * pops a transient toast overlay so every online user sees the
 * announcement even if they're not currently viewing the channel it
 * was posted to.
 *
 * Design choices:
 *  - No persistent history — toasts are ephemeral. The message itself is
 *    stored as a normal row in its channel and can be viewed there.
 *  - Don't toast our own messages — the admin who just posted sees the
 *    row in the channel directly.
 *  - Don't toast messages from before the session started (we skip any
 *    row with `created_at` more than 2 minutes old at receive time).
 *    This prevents the "toast avalanche" when you log in hours after
 *    an announcement went out.
 *  - Toasts auto-dismiss after 10s; user can click "关闭" early.
 */

import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { supabase, type DbMessage } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";

type Toast = {
  id: string;
  authorName: string;
  authorColor: string;
  content: string;
  arrivedAt: number;
};

export default function HighPriorityWatcher() {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const seen = new Set<string>();
    const channel = supabase
      .channel(`high-priority-announcements:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as DbMessage | undefined;
          if (!row || !row.id) return;
          if (row.priority !== "high") return;
          if (row.author_id === userId) return; // don't toast myself
          if (seen.has(row.id)) return;
          seen.add(row.id);
          // Skip stale rows (more than 2 minutes old) so login doesn't
          // replay historical announcements as fresh toasts.
          const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now();
          if (Date.now() - ts > 2 * 60 * 1000) return;
          setToasts((prev) => [
            ...prev,
            {
              id: row.id,
              authorName: row.author_name,
              authorColor: row.author_color,
              content: row.content,
              arrivedAt: Date.now(),
            },
          ]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Auto-dismiss after 10s.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 10_000 - (Date.now() - t.arrivedAt)),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-[min(90vw,380px)]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="bg-[var(--bg-darkest)] border border-[var(--danger)]/60 rounded-lg shadow-2xl p-3 text-sm animate-in slide-in-from-right"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Megaphone size={16} className="text-[var(--danger)]" />
            <span className="font-bold text-[var(--danger)] text-[11px] tracking-wider">
              全站推送公告
            </span>
            <span
              className="font-semibold truncate ml-auto text-[12px]"
              style={{ color: t.authorColor }}
            >
              {t.authorName}
            </span>
            <button
              type="button"
              aria-label="关闭"
              onClick={() =>
                setToasts((prev) => prev.filter((x) => x.id !== t.id))
              }
              className="text-[var(--text-muted)] hover:text-white shrink-0"
            >
              <X size={14} />
            </button>
          </div>
          <div className="text-[13px] text-white whitespace-pre-wrap break-words line-clamp-6">
            {t.content}
          </div>
        </div>
      ))}
    </div>
  );
}
