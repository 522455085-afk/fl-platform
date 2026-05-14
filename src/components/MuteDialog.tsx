"use client";

/**
 * Staff-only dialog for issuing a temporary mute. Triggered from the
 * member-list right-click menu ("临时禁言") and whatever future call
 * sites need it. Collects:
 *   - duration in minutes (integer > 0, custom input, no presets)
 *   - reason (non-empty string, stored verbatim and shown to target)
 *
 * Submission goes through `issueMute()` which writes to the `mutes`
 * collection and returns the created row. On success we also drop a
 * line into the audit log so the action is traceable.
 */

import { useEffect, useRef, useState } from "react";
import { issueMute } from "@/lib/mute-store";
import { useAuth } from "@/lib/auth-store";
import { recordAuditEvent } from "@/lib/audit-log";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { X, Loader2, Clock } from "lucide-react";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import WheelPicker from "@/components/WheelPicker";

type Props = {
  targetUserId: string;
  targetUserName: string;
  /** Optional server scope (e.g., "home" for official). `null` → global. */
  serverId?: string | null;
  onClose: () => void;
  /** Called on successful mute so callers can show a toast / refresh list. */
  onMuted?: () => void;
};

export default function MuteDialog({
  targetUserId,
  targetUserName,
  serverId,
  onClose,
  onMuted,
}: Props) {
  const me = useAuth((s) => s.user);
  const backdropProps = useDismissOnBackdrop(onClose);
  // Two wheels: hours (0–24) and minutes (0–59). Total max 24h, see
  // the clamp logic in the change handler.
  const [hours, setHours] = useState(0);
  // Wheel step is 2 (per user request) so options jump 0→2→4→…
  // Default duration: 10 分钟 (a sensible "shut someone up briefly").
  const [mins, setMins] = useState(10);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    reasonRef.current?.focus();
  }, []);

  // Enforce the 24-hour cap: if hours hits 24, force minutes to 0.
  // We update both atomically so the user can't briefly land in an
  // illegal "24:01" state by twisting the minutes wheel.
  const onHoursChange = (h: number) => {
    setHours(h);
    if (h >= 24) setMins(0);
  };
  const onMinsChange = (m: number) => {
    if (hours >= 24) {
      setMins(0);
      return;
    }
    setMins(m);
  };

  const totalMinutes = hours * 60 + mins;

  const submit = async () => {
    setErr(null);
    const m = totalMinutes;
    if (m <= 0) {
      setErr("禁言时长必须大于 0。");
      return;
    }
    if (m > 60 * 24) {
      setErr("禁言时长不能超过 24 小时。");
      return;
    }
    const r = reason.trim();
    if (!r) {
      setErr("必须填写禁言原因。");
      return;
    }
    if (!me) {
      setErr("你尚未登录。");
      return;
    }
    setSubmitting(true);
    const res = await issueMute({
      targetUserId,
      issuedBy: me.id,
      issuedByName: me.username,
      reason: r,
      minutes: m,
      // Mutes are platform-wide regardless of where they were issued
      // from. We pass null instead of `serverId` so the row carries no
      // implicit scope — the audit label still notes the source server
      // for accountability.
      serverId: null,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    // Side-channel ping to the target so they pick up the mute within
    // a second instead of waiting on the 60s background poll. Reuses
    // kick_signals with `reason: "mute-changed"` — see force-kick.ts
    // useKickSignalWatcher branch.
    if (targetUserId) {
      void supabase.from("kick_signals").insert({
        target_user_id: targetUserId,
        target_channel_id: null,
        issued_by: me.id,
        issued_by_name: me.username,
        issued_at: new Date().toISOString(),
        reason: "mute-changed",
      });
    }
    recordAuditEvent({
      actor_id: me.id,
      actor_name: me.username,
      action: "temp_mute",
      target_type: "user",
      target_id: targetUserId,
      target_label: `${targetUserName} / ${hours}时${mins}分${
        serverId ? ` / from ${serverId}` : ""
      } / ${r}`,
    });
    onMuted?.();
    onClose();
  };

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="bg-[var(--bg-darker)] border border-[var(--bg-mid)] rounded-lg shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--bg-mid)]">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock size={16} className="text-[var(--warning)]" />
            临时禁言：{targetUserName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider block mb-2">
              禁言时长（最长 24 小时）
            </label>
            <div className="flex items-center justify-center gap-3 bg-[var(--bg-darkest)] rounded-lg py-2">
              <WheelPicker
                min={0}
                max={24}
                step={2}
                value={hours}
                onChange={onHoursChange}
                suffix="时"
              />
              <span className="text-2xl text-[var(--text-muted)] font-light">:</span>
              <WheelPicker
                min={0}
                max={hours >= 24 ? 0 : 58}
                step={2}
                value={mins}
                onChange={onMinsChange}
                suffix="分"
              />
            </div>
            <p className="mt-1 text-center text-[11px] text-[var(--text-muted)] tabular-nums">
              共 <span className="text-white font-semibold">{totalMinutes}</span> 分钟
            </p>
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider block mb-1">
              原因（必填，会显示给被禁言者）
            </label>
            <textarea
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="例如：刷屏 / 人身攻击 / 广告"
              className="w-full bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          {err && (
            <p className="text-xs text-[var(--danger)]">{err}</p>
          )}
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
                : "bg-[var(--warning)] hover:brightness-110 text-[#1a1325]",
            )}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            确认禁言
          </button>
        </footer>
      </div>
    </div>
  );
}
