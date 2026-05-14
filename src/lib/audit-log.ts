"use client";

/**
 * Lightweight admin-action audit trail.
 *
 * ========================================================================
 * BACKEND REQUIREMENT — set up in Tencent CloudBase console:
 *
 *   Collection name:  audit_log
 *   Fields:           id (auto), actor_id, actor_name, action,
 *                     target_type, target_id, target_label, at
 *   Read permission:  仅主教可读 (tighten later — for now 登录用户可读)
 *   Write permission: 登录用户可写 (later: cloud function verifies
 *                                   actor is in NEXT_PUBLIC_ADMIN_USER_IDS)
 * ========================================================================
 *
 * Purpose: every time a platform admin performs a moderation action
 * (delete message / disband party / delist listing / pin / kick), we
 * record one row here. This is **best-effort**: if the collection
 * doesn't exist, we log a warning and return — the action itself still
 * succeeds. The audit UI (not built yet) reads this table chronologically.
 *
 * Non-goal: this does NOT enforce authorization. `isAdminId()` still
 * gates the UI; audit-log is purely observational.
 */

import { supabase } from "@/lib/supabase";

export type AuditAction =
  | "delete_message"
  | "pin_message"
  | "unpin_message"
  | "force_disband_party"
  | "force_delist_listing"
  | "force_kick_voice"
  | "high_priority_post"
  // User-targeting moderation
  | "temp_mute"
  | "revoke_mute"
  | "permanent_ban"
  // Tier change side-effects (issued by StaffSync)
  | "force_reload_role";

export type AuditEntry = {
  actor_id: string;
  actor_name: string;
  action: AuditAction;
  /** Canonical table name of the thing operated on. */
  target_type:
    | "message"
    | "party"
    | "trade_listing"
    | "voice_occupant"
    | "user";
  /** Primary key of the target row. */
  target_id: string;
  /** Short human-readable label (e.g. message preview, party name,
   *  item name, kicked user name). Capped to 80 chars. */
  target_label?: string;
};

/**
 * Write a single audit row. Fire-and-forget: callers shouldn't block on
 * this, and we swallow errors (a missing collection just means audit is
 * not set up yet, which is not a user-facing concern).
 */
export function recordAuditEvent(entry: AuditEntry): void {
  const label = (entry.target_label || "").slice(0, 80);
  void (async () => {
    try {
      const { error } = await supabase.from("audit_log").insert({
        actor_id: entry.actor_id,
        actor_name: entry.actor_name,
        action: entry.action,
        target_type: entry.target_type,
        target_id: entry.target_id,
        target_label: label,
        at: new Date().toISOString(),
      });
      if (error) {
        console.warn("[audit] write failed (non-fatal):", error.message);
      }
    } catch (e) {
      console.warn("[audit] unexpected error (non-fatal):", e);
    }
  })();
}
