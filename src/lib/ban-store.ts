"use client";

/**
 * Permanent-ban (account suspension) helpers.
 *
 * ========================================================================
 * BACKEND REQUIREMENT — create on the Tencent CloudBase console:
 *
 *   Collection name:  bans
 *   Permission preset: 读取全部数据，修改本人数据[READONLY]
 * ========================================================================
 *
 * Schema (snake_case, schemaless):
 *   id            auto
 *   user_id       string  — banned user's CloudBase id
 *   banned_by     string  — staff user id
 *   banned_by_name string
 *   reason        string  — required, surfaced in the login error
 *   created_at    string  — ISO
 *
 * The enforcement flow:
 *   - On login (auth-store), we check `isUserBanned(userId)` after
 *     username/password succeed and BEFORE setting the auth user. If
 *     banned, we surface the row's `reason` in the auth error.
 *   - For an already-logged-in session that gets banned mid-flight,
 *     the BanWatcher (mounted globally) listens for new `bans` rows
 *     targeting the current user and forces a logout + alert.
 */

import { db } from "@/lib/cloudbase";
import { adminBanUser } from "@/lib/admin-actions";

export type BanRow = {
  id: string;
  user_id: string;
  banned_by: string;
  banned_by_name: string;
  reason: string;
  created_at: string;
};

/** Insert a ban row. Best-effort (returns descriptive failure if the
 *  collection isn't set up). Caller should also write an audit entry. */
export async function issueBan(args: {
  targetUserId: string;
  bannedBy: string;
  bannedByName: string;
  reason: string;
}): Promise<{ ok: true; row: BanRow } | { ok: false; message: string }> {
  try {
    await adminBanUser(args.targetUserId, args.reason.slice(0, 200));
    // Return a synthetic row — the real doc is written server-side.
    const row: BanRow = {
      id: "",
      user_id: args.targetUserId,
      banned_by: args.bannedBy,
      banned_by_name: args.bannedByName,
      reason: args.reason.slice(0, 200),
      created_at: new Date().toISOString(),
    };
    return { ok: true, row };
  } catch (e: unknown) {
    return { ok: false, message: String((e as Error)?.message ?? e) };
  }
}

/** Lookup whether `userId` has any ban rows. Returns the most recent
 *  one if so. Used at login and by the BanWatcher tick. */
export async function getActiveBan(userId: string): Promise<BanRow | null> {
  if (!userId) return null;
  try {
    const res = await db
      .collection("bans")
      .where({ user_id: userId })
      .orderBy("created_at", "desc")
      .limit(1)
      .get();
    return ((res.data || [])[0] as BanRow) || null;
  } catch (e) {
    // No collection → not banned (safe default for the unconfigured
    // bootstrap case). We swallow because the install instructions
    // don't make `bans` required for basic chat to work.
    console.warn("[ban] lookup skipped:", e);
    return null;
  }
}
