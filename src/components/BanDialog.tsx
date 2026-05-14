"use client";
import { confirm } from "@/lib/confirm-store";

/**
 * Permanent-ban dialog. Founder + admin only (mods don't have ban
 * power). Same UX shape as MuteDialog: collect reason, write the
 * row, audit-log the action. There is no "duration" field — bans
 * are permanent until explicitly revoked (which is a future admin UI).
 *
 * Callers gate visibility via `canBanUsers(me.id)` — see MemberList's
 * right-click menu.
 */

import { useEffect, useRef, useState } from "react";
import { issueBan } from "@/lib/ban-store";
import { useAuth } from "@/lib/auth-store";
import { recordAuditEvent } from "@/lib/audit-log";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import { cn } from "@/lib/utils";
import { Ban, Loader2, X } from "lucide-react";

type Props = {
  targetUserId: string;
  targetUserName: string;
  onClose: () => void;
  onBanned?: () => void;
};

export default function BanDialog({
  targetUserId,
  targetUserName,
  onClose,
  onBanned,
}: Props) {
  const me = useAuth((s) => s.user);
  const backdropProps = useDismissOnBackdrop(onClose);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const firstInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  const submit = async () => {
    setErr(null);
    const r = reason.trim();
    if (!r) {
      setErr("必须填写封禁原因。");
      return;
    }
    if (!me) {
      setErr("你尚未登录。");
      return;
    }
    // Browser confirm() — second confirmation as a destructive-action
    // safeguard (replaces the older "type the username to confirm"
    // pattern that the user found too cumbersome).
    if (!(await confirm(`确认永久封禁「${targetUserName}」？\n\n该用户将立即被踢出并无法重新登录。\n原因：${r}`))) {
      return;
    }
    setSubmitting(true);
    const res = await issueBan({
      targetUserId,
      bannedBy: me.id,
      bannedByName: me.username,
      reason: r,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    recordAuditEvent({
      actor_id: me.id,
      actor_name: me.username,
      action: "permanent_ban",
      target_type: "user",
      target_id: targetUserId,
      target_label: `${targetUserName} / ${r}`,
    });
    onBanned?.();
    onClose();
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="bg-[var(--bg-darker)] border border-[var(--danger)]/40 rounded-lg shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--bg-mid)]">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Ban size={16} className="text-[var(--danger)]" />
            永久封禁：{targetUserName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <p className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded px-3 py-2 leading-relaxed">
            ⚠️ 永久封禁是不可逆操作，被封禁用户将无法登录。仅在明确违规时使用。
          </p>
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">
              封禁原因（必填，登录失败时显示给该用户）
            </label>
            <textarea
              ref={firstInput}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="例如：恶意刷屏 / 攻击他人 / 外挂脚本"
              className="w-full bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-[var(--danger)]"
            />
          </div>
          {err && <p className="text-xs text-[var(--danger)]">{err}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--bg-mid)]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm px-3 py-1.5 rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={cn(
              "text-sm font-semibold px-4 py-1.5 rounded flex items-center gap-1.5 transition-colors",
              submitting
                ? "bg-[var(--bg-mid)] text-[var(--text-muted)] cursor-not-allowed"
                : "bg-[var(--danger)] hover:brightness-110 text-white",
            )}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            永久封禁
          </button>
        </footer>
      </div>
    </div>
  );
}
