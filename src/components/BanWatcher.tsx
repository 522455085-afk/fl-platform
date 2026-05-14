"use client";

/**
 * Mount once at the app root. Periodically checks whether the
 * currently-logged-in user has been banned mid-session, and force
 * logs them out with a centered, modal-style notice (NOT a native
 * `window.alert`, which always renders at the top of the viewport
 * and looks like a system error).
 *
 * Login-time enforcement lives in auth-store (see `getActiveBan` in
 * @/lib/ban-store) — this watcher only catches the case where a user
 * was online when staff issued the ban.
 *
 * Polling cadence: 30s. Bans are rare so realtime would be overkill.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { getActiveBan, type BanRow } from "@/lib/ban-store";
import { db } from "@/lib/cloudbase";
import { Ban } from "lucide-react";

export default function BanWatcher() {
  const userId = useAuth((s) => s.user?.id ?? null);
  const logout = useAuth((s) => s.logout);
  // Holds the ban row that triggered the modal. While set, the user
  // sees the modal and the only escape is the "我知道了" button which
  // calls logout(). We never auto-dismiss — the user must acknowledge.
  const [banModal, setBanModal] = useState<BanRow | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      const ban = await getActiveBan(userId);
      if (cancelled) return;
      if (ban) setBanModal(ban);
    };
    void check();
    let watchRef: { close: () => void } | null = null;
    try {
      watchRef = db.collection("bans").where({ user_id: userId }).watch({
        onChange: () => void check(),
        onError: () => {},
      });
    } catch { /* fallback to poll only */ }
    const tick = setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      try { watchRef?.close(); } catch { /* ignore */ }
    };
  }, [userId]);

  if (!banModal) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[var(--bg-darker)] border-2 border-[var(--danger)]/60 rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--bg-mid)]">
          <div className="size-10 grid place-items-center rounded-full bg-[var(--danger)]/20">
            <Ban size={22} className="text-[var(--danger)]" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">
              账号已被永久封禁
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              你将被强制退出，无法继续使用平台
            </p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm text-[var(--text-normal)]">
          <div>
            <span className="text-[var(--text-muted)]">封禁人：</span>
            <span className="font-semibold text-white">
              {banModal.banned_by_name}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">原因：</span>
            <span className="text-white">{banModal.reason}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">封禁时间：</span>
            <span className="text-white tabular-nums">
              {new Date(banModal.created_at).toLocaleString("zh-CN")}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--bg-mid)]/60">
            如认为封禁有误，请通过其他渠道联系主教申诉。
          </p>
        </div>
        <div className="px-5 py-3 border-t border-[var(--bg-mid)] flex justify-end">
          <button
            type="button"
            onClick={async () => {
              setBanModal(null);
              await logout();
            }}
            className="text-sm font-semibold px-5 py-2 rounded bg-[var(--danger)] hover:brightness-110 text-white transition-colors"
          >
            我知道了，退出
          </button>
        </div>
      </div>
    </div>
  );
}
