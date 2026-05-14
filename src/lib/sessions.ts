/**
 * Single-instance-per-device-type session enforcement.
 *
 * Policy:
 *  - On login, write a row into `sessions` for THIS tab.
 *  - Mark any OTHER active session of the same `device_type` as kicked.
 *  - Each tab polls its own row every 8s. If `kicked_at` becomes set,
 *    the tab forcibly logs out and shows the KickedModal.
 *
 * Schema (CloudBase collection: `sessions`):
 *   _id: string (auto)
 *   user_id: string         // owner
 *   device_type: "pc" | "android" | "ios"
 *   session_id: string      // client-generated UUID; unique per tab
 *   ua: string              // navigator.userAgent (for display)
 *   created_at: number      // Date.now()
 *   last_seen: number       // Date.now(), bumped by heartbeat
 *   kicked_at: number|null  // null while alive
 *   kicked_by_session: string|null  // session_id that kicked us
 */

import { supabase } from "@/lib/supabase";
import { db } from "@/lib/cloudbase";
import { detectDeviceType, newSessionId, type DeviceType } from "@/lib/device-type";

export type SessionRow = {
  id?: string;
  user_id: string;
  device_type: DeviceType;
  session_id: string;
  ua: string;
  created_at: number;
  last_seen: number;
  kicked_at: number | null;
  kicked_by_session: string | null;
};

/** Module-scoped: the session id this tab/instance owns. Regenerated when the
 * effective user_id changes (logout → login as different account), to prevent
 * stale state from one user leaking into another. */
let mySessionId: string | null = null;
/** Tracks which user_id `mySessionId` was minted for. Used to detect a change
 * of account and reset all per-session state. */
let mySessionUserId: string | null = null;
/** The CloudBase doc id of our session row (so we can update last_seen efficiently). */
let myDocId: string | null = null;
/** Heartbeat timer to keep last_seen fresh and trigger kick-detection polls. */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
/** Polling timer that watches `kicked_at` on our own row. */
let kickPollTimer: ReturnType<typeof setInterval> | null = null;
let kickWatchRef: { close: () => void } | null = null;
/** Listeners notified when this tab gets kicked. */
const kickListeners = new Set<(by: SessionRow | null) => void>();

export function getMySessionId(): string | null {
  return mySessionId;
}

/**
 * Claim a session slot for this user on this device type.
 * Kicks any existing same-type session belonging to the same user.
 * Idempotent — safe to call again on re-login from the same tab.
 */
export async function claimSession(userId: string): Promise<{
  ok: boolean;
  sessionId: string;
  kickedSessionIds: string[];
  error?: string;
}> {
  if (!userId) {
    return { ok: false, sessionId: "", kickedSessionIds: [], error: "no userId" };
  }

  const deviceType = detectDeviceType();

  // CRITICAL: if the user_id this tab is claiming for has CHANGED since
  // last call (logout → login as different account in same tab), wipe
  // all per-session state. Otherwise the new user inherits the previous
  // user's mySessionId and the stale `kickedNotified` latch / row links,
  // which causes the kick modal to misfire on the new account.
  if (mySessionUserId && mySessionUserId !== userId) {
    console.log("[sessions] user changed", mySessionUserId, "->", userId,
      "— resetting session state");
    stopHeartbeat();
    stopKickPoll();
    mySessionId = null;
    myDocId = null;
    kickedNotified = false;
  }
  if (!mySessionId) mySessionId = newSessionId();
  mySessionUserId = userId;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const now = Date.now();

  // Step 1: kick all other active same-type sessions for this user.
  let kickedIds: string[] = [];
  try {
    const { data: existing } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("device_type", deviceType);
    const rows = (existing || []) as SessionRow[];
    const aliveOther = rows.filter(
      (r) => r.session_id !== mySessionId && !r.kicked_at,
    );
    kickedIds = aliveOther.map((r) => r.session_id);
    for (const r of aliveOther) {
      try {
        await supabase
          .from("sessions")
          .update({ kicked_at: now, kicked_by_session: mySessionId })
          .eq("session_id", r.session_id);
      } catch (e) {
        console.warn("[sessions] kick same-type failed:", r.session_id, e);
      }
    }
  } catch (e) {
    console.warn("[sessions] enumerate same-type failed (non-fatal):", e);
  }

  // Step 2: write our own row. If a row for this session already exists
  // (rare: same tab re-logins), update last_seen instead of creating dup.
  try {
    const { data: mine } = await supabase
      .from("sessions")
      .select("*")
      .eq("session_id", mySessionId)
      .limit(1);
    const myRows = (mine || []) as SessionRow[];
    if (myRows.length > 0) {
      myDocId = (myRows[0].id as string) || null;
      await supabase
        .from("sessions")
        .update({
          user_id: userId,
          device_type: deviceType,
          ua,
          last_seen: now,
          kicked_at: null,
          kicked_by_session: null,
        })
        .eq("session_id", mySessionId);
    } else {
      const row: SessionRow = {
        user_id: userId,
        device_type: deviceType,
        session_id: mySessionId,
        ua,
        created_at: now,
        last_seen: now,
        kicked_at: null,
        kicked_by_session: null,
      };
      const { data: ins, error } = await supabase
        .from("sessions")
        .insert(row)
        .select()
        .maybeSingle();
      if (error) throw error;
      const r = (ins || row) as SessionRow & { _id?: string; id?: string };
      myDocId = (r.id || r._id) ?? null;
    }
  } catch (e) {
    // CRITICAL: if this fires, almost always means the CloudBase rules
    // for `sessions` haven't been opened up. The default rules forbid
    // non-creator writes, so the new session row never gets persisted,
    // and subsequent kick polls then find "no row" — which would
    // otherwise be misinterpreted as "I got kicked".
    console.error(
      "[sessions] insert/update FAILED — likely missing CloudBase rules. " +
        "Set sessions collection to {read:true, write:\"auth.openid != null\"}.",
      e,
    );
    return {
      ok: false,
      sessionId: mySessionId || "",
      kickedSessionIds: kickedIds,
      error: (e as Error).message || "insert failed",
    };
  }

  startHeartbeat(userId);
  startKickPoll();

  console.log("[sessions] claimed", {
    userId,
    deviceType,
    sessionId: mySessionId,
    kickedOthers: kickedIds.length,
  });

  return { ok: true, sessionId: mySessionId!, kickedSessionIds: kickedIds };
}

/**
 * Release this tab's session. Called on explicit logout. Best-effort —
 * if the network is dead the row will just stay around, but its
 * `last_seen` will go stale and other clients can ignore it.
 */
export async function releaseSession(): Promise<void> {
  stopHeartbeat();
  stopKickPoll();
  const sid = mySessionId;
  // Clear the user-id tracker so the NEXT claimSession (potentially for
  // a different account) starts with a fresh sessionId — see the "user
  // changed" branch in claimSession().
  mySessionUserId = null;
  kickedNotified = false;
  if (!sid) return;
  try {
    await supabase.from("sessions").delete().eq("session_id", sid);
  } catch (e) {
    console.warn("[sessions] release failed (non-fatal):", e);
  }
  // Keep mySessionId set so re-login from the same tab + same user can
  // re-claim cleanly. claimSession will rotate it if the user changes.
}

/** Subscribe to "you got kicked" events. Returns an unsubscribe fn. */
export function onKicked(listener: (by: SessionRow | null) => void): () => void {
  kickListeners.add(listener);
  return () => kickListeners.delete(listener);
}

// --------- internals ---------

function startHeartbeat(userId: string) {
  stopHeartbeat();
  // 30s heartbeat — light load, just enough to mark "still alive".
  heartbeatTimer = setInterval(async () => {
    if (!mySessionId) return;
    try {
      await supabase
        .from("sessions")
        .update({ last_seen: Date.now() })
        .eq("session_id", mySessionId)
        .eq("user_id", userId);
    } catch {
      /* best-effort */
    }
  }, 30_000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startKickPoll() {
  stopKickPoll();
  void checkKicked();
  try {
    kickWatchRef = db.collection("sessions").where({ session_id: mySessionId }).watch({
      onChange: () => void checkKicked(),
      onError: () => {},
    });
  } catch { /* fallback to poll only */ }
  // 60s fallback in case watch drops.
  kickPollTimer = setInterval(checkKicked, 60_000);
}

function stopKickPoll() {
  if (kickPollTimer) {
    clearInterval(kickPollTimer);
    kickPollTimer = null;
  }
  try { kickWatchRef?.close(); } catch { /* ignore */ }
  kickWatchRef = null;
}

let kickedNotified = false;

async function checkKicked() {
  if (!mySessionId || kickedNotified) return;
  try {
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .eq("session_id", mySessionId)
      .limit(1);
    const rows = (data || []) as SessionRow[];
    const me = rows[0];
    // SAFETY: "row missing" must NOT be interpreted as "kicked". If our
    // initial insert failed (e.g. CloudBase rules misconfigured), the
    // row was never written, so polling will always find nothing. We'd
    // false-positive kick ourselves and the user can't stay logged in.
    // Treat missing as "no info" — only an explicit `kicked_at` value
    // signals an actual kick.
    if (!me) return;
    // SAFETY 2: defend against module-state contamination across user
    // switches. If the row's user_id doesn't match who we currently
    // think we're logged in as, ignore — our caller is already in the
    // middle of a re-claim that will rewrite the row.
    if (mySessionUserId && me.user_id !== mySessionUserId) {
      console.warn(
        "[sessions] poll found row for different user_id (", me.user_id,
        ") while logged in as", mySessionUserId, "— ignoring",
      );
      return;
    }
    if (me.kicked_at) {
      kickedNotified = true;
      // Try to look up the kicker for nicer UX.
      let kicker: SessionRow | null = null;
      if (me.kicked_by_session) {
        try {
          const { data: kdata } = await supabase
            .from("sessions")
            .select("*")
            .eq("session_id", me.kicked_by_session)
            .limit(1);
          kicker = ((kdata || [])[0] as SessionRow) || null;
        } catch {
          /* ignore */
        }
      }
      kickListeners.forEach((l) => l(kicker));
      stopHeartbeat();
      stopKickPoll();
    }
  } catch (e) {
    console.warn("[sessions] kick poll failed:", e);
  }
}

/**
 * Reset the "kicked" latch. Call when starting a brand-new session
 * (post-login from a fresh state) to re-arm the watcher.
 */
export function resetKickLatch() {
  kickedNotified = false;
}
