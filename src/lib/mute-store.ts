"use client";

/**
 * Temporary-mute system. Staff (founder/admin/mod within their scope)
 * can silence a user for a custom number of minutes; the target's
 * composer is disabled until `expires_at` passes, with a banner
 * showing who muted them and why.
 *
 * ========================================================================
 * BACKEND REQUIREMENT — create on the Tencent CloudBase console:
 *
 *   Collection name:  mutes
 *   Permission preset: 读取全部数据，修改本人数据[READONLY]
 *     (所有人可读 — target needs to see their own mute;
 *      写入仅限 "本人" — enforcement is client-side; prod should
 *      tighten this via a cloud function later.)
 * ========================================================================
 *
 * Schema (CloudBase is schemaless — rows are created with these fields
 * on first insert, no explicit migration needed):
 *
 *   id             auto
 *   user_id        string   — the muted user's CloudBase id
 *   muted_by       string   — staff user id who issued the mute
 *   muted_by_name  string   — display name of the issuing staff
 *   reason         string   — human-readable reason (required, shown
 *                              to the target)
 *   minutes        number   — duration requested
 *   server_id      string?  — DEPRECATED: written for backwards
 *                              compatibility but client never reads
 *                              it. Mutes are platform-wide; staff
 *                              can mute from any context and the
 *                              target user is silenced everywhere
 *                              (DMs, custom servers, official server)
 *                              until the row expires.
 *   expires_at     string   — ISO timestamp, derived from
 *                              created_at + minutes
 *   created_at     string   — ISO
 *
 * The client enforcement is: on each send attempt, we check
 * `useMute.isMutedNow()` for the current user. Regular players see an
 * inline "你被 X 禁言至 Y，原因：Z" banner above the composer.
 *
 * Not yet implemented (intentional): staff-side "unmute" button.
 * Expired rows naturally stop blocking sends; a later admin UI pass
 * will add early-release + a list of active mutes.
 */

import { create } from "zustand";
import { db } from "@/lib/cloudbase";
import { adminMuteUser, adminUnmuteUser } from "@/lib/admin-actions";

/**
 * Row shape as stored in the `mutes` collection. All fields use the
 * snake_case convention we use for every other CloudBase collection.
 */
export type MuteRow = {
  id: string;
  user_id: string;
  muted_by: string;
  muted_by_name: string;
  reason: string;
  minutes: number;
  server_id?: string | null;
  expires_at: string;
  created_at: string;
};

/**
 * Create (and return) a mute targeting `userId`. Fails gracefully if
 * the collection doesn't exist (returns `{ ok: false, message }`).
 */
export async function issueMute(args: {
  targetUserId: string;
  issuedBy: string;
  issuedByName: string;
  reason: string;
  minutes: number;
  serverId?: string | null;
}): Promise<{ ok: true; row: MuteRow } | { ok: false; message: string }> {
  try {
    const now = new Date();
    const durationMs = args.minutes * 60_000;
    await adminMuteUser(
      args.targetUserId,
      args.serverId ?? "global",
      durationMs,
      args.reason.slice(0, 200),
    );
    const row: MuteRow = {
      id: "",
      user_id: args.targetUserId,
      muted_by: args.issuedBy,
      muted_by_name: args.issuedByName,
      reason: args.reason.slice(0, 200),
      minutes: args.minutes,
      server_id: args.serverId ?? null,
      expires_at: new Date(now.getTime() + durationMs).toISOString(),
      created_at: now.toISOString(),
    };
    return { ok: true, row };
  } catch (e: unknown) {
    return { ok: false, message: String((e as Error)?.message ?? e) };
  }
}

/** ------------------------------------------------------------------
 *  Current-user mute watcher. Each logged-in client keeps at most ONE
 *  active mute row in memory — the one with the latest `expires_at`.
 *  ------------------------------------------------------------------ */

type MuteState = {
  /** Currently-active mute row for the logged-in user, or null. */
  active: MuteRow | null;
  /** Fetch the latest active mute for `userId`. Safe to call any time. */
  refresh: (userId: string) => Promise<void>;
  /** Optimistic local setter used by the watcher when realtime events
   *  fire before the refresh round-trips. */
  set: (row: MuteRow | null) => void;
  /** True when `active` exists AND it hasn't expired yet. */
  isMutedNow: () => boolean;
};

export const useMute = create<MuteState>()((set, get) => ({
  active: null,
  set: (row) => set({ active: row }),
  refresh: async (userId) => {
    if (!userId) {
      set({ active: null });
      return;
    }
    try {
      // Query newest mute for this user. CloudBase supports .orderBy.
      const res = await db
        .collection("mutes")
        .where({ user_id: userId })
        .orderBy("expires_at", "desc")
        .limit(1)
        .get();
      const row = (res.data || [])[0] as MuteRow | undefined;
      if (!row) {
        set({ active: null });
        return;
      }
      // Drop expired rows rather than parading them; callers rely on
      // `active` = "currently enforced".
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        set({ active: null });
        return;
      }
      set({ active: row });
    } catch (e) {
      // Missing collection is not fatal — treat as "no active mute".
      console.warn("[mute] refresh skipped:", e);
      set({ active: null });
    }
  },
  isMutedNow: () => {
    const a = get().active;
    if (!a) return false;
    return new Date(a.expires_at).getTime() > Date.now();
  },
}));

/**
 * Look up the active (unexpired) mute for ANY user — used by the
 * right-click menu to decide whether to show "临时禁言…" or "解除禁言".
 * Returns null if there's no row, the latest row has expired, or the
 * `mutes` collection isn't set up yet.
 */
export async function getActiveMuteFor(
  userId: string,
): Promise<MuteRow | null> {
  if (!userId) return null;
  try {
    const res = await db
      .collection("mutes")
      .where({ user_id: userId })
      .orderBy("expires_at", "desc")
      .limit(1)
      .get();
    const row = (res.data || [])[0] as MuteRow | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return row;
  } catch (e) {
    console.warn("[mute] getActiveMuteFor skipped:", e);
    return null;
  }
}

/**
 * Revoke a user's currently-active mute(s).
 *
 * Implementation detail: we UPDATE `expires_at` to a past timestamp
 * instead of DELETE-ing the row. Reason: CloudBase reads can return
 * stale rows for 3–10 seconds after a DELETE (eventual-consistency
 * cache behavior). That caused the target's next `refresh()` — fired
 * from the kick_signals "mute-changed" ping within 1s — to still see
 * the "deleted" mute as active, keeping them locked for up to 10s.
 *
 * Expiring in place dodges the stale-read problem entirely:
 *   - Any read (stale or fresh) sees `expires_at < now` → treated as
 *     inactive by both `useMute.isMutedNow()` and `getActiveMuteFor`.
 *   - Row lingers for audit history; any future "mute history" UI
 *     can list who was muted and when. Cleanup is the caller's
 *     responsibility (e.g., a weekly cron).
 *
 * Returns `{ ok: true }` even if no rows needed expiring — the
 * post-condition "user is not muted" holds either way.
 */
export async function revokeMutesFor(
  userId: string,
  serverId = "global",
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!userId) return { ok: false, message: "缺少用户 id" };
  try {
    await adminUnmuteUser(userId, serverId);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

/** Convenience selector for components: returns the active mute for
 *  the current user, or null. Subscribes to the store so expiry ticks
 *  naturally re-render via the `refresh` side-effect in MuteWatcher. */
export function useMyMute(): MuteRow | null {
  // Explicit selector type — without it, zustand sometimes infers
  // `never` for ternary selectors and JSX consumers can't access row
  // fields through narrowing.
  return useMute(
    (s): MuteRow | null => (s.isMutedNow() ? s.active : null),
  );
}
