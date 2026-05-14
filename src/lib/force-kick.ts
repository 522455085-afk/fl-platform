"use client";

/**
 * Admin "force kick" plumbing for voice channels.
 *
 * ========================================================================
 * BACKEND REQUIREMENT — must be set up in the Tencent CloudBase console
 * BEFORE this feature works end-to-end:
 *
 *   Collection name:  kick_signals
 *   Fields:           id (auto), target_user_id, target_channel_id,
 *                     issued_by, issued_at
 *   Read permission:  登录用户可读      (auth != null)
 *   Write permission: 登录用户可写      (tighten later via cloud function
 *                                        that checks isAdminId in server code)
 * ========================================================================
 *
 * Flow:
 *   1. Admin clicks "踢出" on an occupant tile → `sendKickSignal()` inserts
 *      a row into `kick_signals`.
 *   2. Every logged-in client runs `useKickSignalWatcher()` which subscribes
 *      to realtime INSERTs. When a signal whose `target_user_id` matches
 *      our own id arrives, we:
 *        - call `useVoice.leave()` to disconnect the local voice session
 *        - show a non-intrusive banner so the user knows what happened
 *        - (best-effort) delete the signal row so it doesn't linger
 *   3. If the collection doesn't exist yet, `sendKickSignal()` surfaces a
 *      descriptive alert instead of silently failing.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import { useVoice } from "@/lib/voice-store";
import { recordAuditEvent } from "@/lib/audit-log";
import { useMute } from "@/lib/mute-store";
import { alert as showAlert } from "@/lib/confirm-store";

export type KickSignalRow = {
  id: string;
  target_user_id: string;
  target_channel_id: string | null;
  issued_by: string;
  issued_by_name?: string | null;
  issued_at: string;
  /** Why the signal was issued.
   *  - `"voice-kick"` (default, omitted for back-compat): disconnect voice.
   *  - `"role-changed"`: hard reload — pick up new staff-tier perms.
   *  - `"mute-changed"`: refresh `useMute` state in place. No reload,
   *    no toast — just makes the composer lock/unlock within seconds
   *    of staff issuing or revoking a mute. */
  reason?: "voice-kick" | "role-changed" | "mute-changed" | null;
};

/**
 * Emit a kick signal for a single user. Returns `{ ok: true }` on success,
 * `{ ok: false, message }` on failure (e.g. missing collection, permission
 * denied). Caller is responsible for UX on error.
 */
export async function sendKickSignal(args: {
  targetUserId: string;
  targetChannelId: string | null;
  issuedBy: string;
  /** Display name of the issuing admin — shown to the target user in the
   *  kicked-out toast. Optional for backwards compatibility. */
  issuedByName?: string;
  /** Display name of the target — used for the audit log label. Optional. */
  targetName?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("kick_signals").insert({
    target_user_id: args.targetUserId,
    target_channel_id: args.targetChannelId,
    issued_by: args.issuedBy,
    issued_by_name: args.issuedByName ?? null,
    issued_at: new Date().toISOString(),
  });
  if (error) {
    // The most likely failure mode is the collection not existing yet —
    // surface that specifically so the admin knows to set it up.
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("not found") || msg.includes("does not exist") || msg.includes("collection")) {
      return {
        ok: false,
        message:
          '需要先在腾讯云控制台创建 "kick_signals" 集合（见 force-kick.ts 顶部注释）。',
      };
    }
    return { ok: false, message: error.message };
  }
  recordAuditEvent({
    actor_id: args.issuedBy,
    actor_name: args.issuedByName || "主教",
    action: "force_kick_voice",
    target_type: "voice_occupant",
    target_id: args.targetUserId,
    target_label: args.targetName ?? args.targetUserId,
  });
  return { ok: true };
}

/**
 * Mount once at the app root. Subscribes to kick signals targeting the
 * current user and, when one arrives, disconnects voice + toasts.
 */
export function useKickSignalWatcher() {
  const userId = useAuth((s) => s.user?.id ?? null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const seen = new Set<string>();
    const channel = supabase
      .channel(`kick-signals:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "kick_signals" },
        async (payload) => {
          const row = payload.new as KickSignalRow | undefined;
          if (!row || !row.id) return;
          if (row.target_user_id !== userId) return;
          if (seen.has(row.id)) return;
          seen.add(row.id);

          // Branch on the reason so we don't blanket-reload on plain
          // voice kicks (which only need to disconnect audio).
          if (row.reason === "mute-changed") {
            // Lightweight: staff explicitly signaled our mute state
            // changed. Optimistically clear the local mute so the
            // composer unlocks INSTANTLY (no DB round-trip); then
            // also kick off a refresh to pick up the authoritative
            // state from the server. If a new mute is actually
            // active (e.g., staff replaced a long mute with a short
            // one), refresh() will re-set it within a few hundred ms.
            void supabase.from("kick_signals").delete().eq("id", row.id);
            useMute.getState().set(null);
            void useMute.getState().refresh(userId);
            return;
          }
          if (row.reason === "role-changed") {
            // Best-effort cleanup before reload — if it doesn't land
            // before the navigation, the row is harmless on next boot.
            void supabase.from("kick_signals").delete().eq("id", row.id);
            // Brief alert + reload. We can't show a useful toast that
            // survives the reload, so a synchronous notice is simpler.
            if (typeof window !== "undefined") {
              // Use the centered custom dialog so the notice matches
              // the rest of the app's UI (no native browser alert).
              // The reload is sequenced AFTER the user acknowledges,
              // matching the previous synchronous-feeling flow.
              await showAlert(
                "你的主教权限已变更，页面将自动刷新以同步最新状态。",
              );
              window.location.reload();
            }
            return;
          }

          // Default: voice-kick. Disconnect voice if connected to the
          // (optionally specified) target channel; show toast.
          const current = useVoice.getState().current;
          if (current && (!row.target_channel_id || current.channelId === row.target_channel_id)) {
            useVoice.getState().leave();
            const who = row.issued_by_name?.trim() || "主教";
            setToast(`${who} 已将你移出当前语音频道。`);
          } else {
            // Not connected here — no action needed; silently consume.
          }

          // Best-effort clean-up so the row doesn't linger forever.
          void supabase.from("kick_signals").delete().eq("id", row.id);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Auto-clear the toast after 8s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8_000);
    return () => clearTimeout(t);
  }, [toast]);

  return { toast, dismissToast: () => setToast(null) };
}
