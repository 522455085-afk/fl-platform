/**
 * Single-end occupation enforcement for "real-time presence" activities:
 * voice channels, livestreams, party voice rooms.
 *
 * Per product spec (Q2-4, 2026-05-09):
 *  - A user may be occupying AT MOST one such activity at a time, GLOBALLY
 *    (across all their logged-in devices). Other devices can still chat
 *    and read announcements but cannot join voice/stream/party.
 *  - If the user tries to join from device B while device A is occupying,
 *    we offer to "switch" — release A's claim, immediately claim on B.
 *
 * Schema (CloudBase collection: `occupation`):
 *   _id: auto
 *   user_id: string         // exactly one alive row per user enforced by writes
 *   device_type: "pc" | "android" | "ios"
 *   session_id: string      // from sessions.ts
 *   activity: "voice" | "stream" | "party"
 *   resource_id: string     // channel/stream/party id (for UX display)
 *   started_at: number
 *   last_seen: number       // bumped by occupation heartbeat
 *
 * We keep a single row per user (delete-then-insert on switch) to make
 * the "is anyone holding this?" check trivial — just `where user_id = X`.
 */

import { supabase } from "@/lib/supabase";
import { detectDeviceType, type DeviceType } from "@/lib/device-type";
import { getMySessionId } from "@/lib/sessions";

export type OccupationActivity = "voice" | "stream" | "party";

export type OccupationRow = {
  id?: string;
  user_id: string;
  device_type: DeviceType;
  session_id: string;
  activity: OccupationActivity;
  resource_id: string;
  started_at: number;
  last_seen: number;
};

export type ClaimResult =
  | { ok: true; switched: boolean; previous: OccupationRow | null }
  | { ok: false; conflict: OccupationRow; reason: "active_on_other_device" }
  | { ok: false; reason: "no_session" | "no_user" | "internal"; error?: string };

/** Module-state: the active occupation row id we wrote, for fast release. */
let myOccupationDocId: string | null = null;
let occupationHeartbeat: ReturnType<typeof setInterval> | null = null;
let occupationLossPoll: ReturnType<typeof setInterval> | null = null;
const lossListeners = new Set<() => void>();

/**
 * Try to claim occupation. Behavior:
 *  - No row exists for this user → claim, return { ok, switched: false }
 *  - Existing row, same session → renew, return { ok, switched: false }
 *  - Existing row, same device_type but different session → release+claim
 *    (probably stale row from a previous tab; no UX prompt needed)
 *  - Existing row, different device_type → return conflict; caller MUST
 *    confirm with user, then call again with `force: true` to take over
 */
export async function claimOccupation(
  userId: string,
  activity: OccupationActivity,
  resourceId: string,
  options: { force?: boolean } = {},
): Promise<ClaimResult> {
  if (!userId) return { ok: false, reason: "no_user" };
  const sessionId = getMySessionId();
  if (!sessionId) return { ok: false, reason: "no_session" };

  const deviceType = detectDeviceType();
  const now = Date.now();

  // Look up any existing occupation row for this user.
  let existing: OccupationRow | null = null;
  try {
    const { data } = await supabase
      .from("occupation")
      .select("*")
      .eq("user_id", userId)
      .limit(1);
    existing = ((data || [])[0] as OccupationRow) || null;
  } catch (e) {
    console.warn("[occupation] lookup failed:", e);
  }

  const isStale =
    existing && now - (existing.last_seen || 0) > 60_000; // older than 1min → assume dead

  if (existing && !isStale && existing.device_type !== deviceType && !options.force) {
    return {
      ok: false,
      conflict: existing,
      reason: "active_on_other_device",
    };
  }

  // OK to take over. Delete any existing row first so there's only ever
  // one row per user (matches schema invariant).
  if (existing) {
    try {
      await supabase.from("occupation").delete().eq("user_id", userId);
    } catch (e) {
      console.warn("[occupation] delete-existing failed:", e);
    }
  }

  const row: OccupationRow = {
    user_id: userId,
    device_type: deviceType,
    session_id: sessionId,
    activity,
    resource_id: resourceId,
    started_at: now,
    last_seen: now,
  };
  try {
    const { data, error } = await supabase
      .from("occupation")
      .insert(row)
      .select()
      .maybeSingle();
    if (error) throw error;
    const r = (data || row) as OccupationRow & { _id?: string; id?: string };
    myOccupationDocId = (r.id || r._id) ?? null;
  } catch (e) {
    return {
      ok: false,
      reason: "internal",
      error: (e as Error).message || "insert failed",
    };
  }

  startOccupationHeartbeat(userId);
  startLossPoll(userId, sessionId);

  return { ok: true, switched: !!existing, previous: existing };
}

/**
 * Release our claim. Called when leaving voice/stream/party normally,
 * or when forcibly disconnecting because another device took over.
 */
export async function releaseOccupation(userId: string): Promise<void> {
  stopOccupationHeartbeat();
  stopLossPoll();
  if (!userId) return;
  const sessionId = getMySessionId();
  if (!sessionId) return;
  try {
    // Only delete if we still own it — defensive against races where the
    // other device already took over and we'd be deleting their row.
    await supabase
      .from("occupation")
      .delete()
      .eq("user_id", userId)
      .eq("session_id", sessionId);
  } catch (e) {
    console.warn("[occupation] release failed:", e);
  }
  myOccupationDocId = null;
}

/**
 * Subscribe to "you lost the occupation" — fires when the row is gone or
 * has been claimed by a different session. The active client should
 * disconnect from voice/stream/party when this fires.
 */
export function onOccupationLost(listener: () => void): () => void {
  lossListeners.add(listener);
  return () => lossListeners.delete(listener);
}

// --- internals ---

function startOccupationHeartbeat(userId: string) {
  stopOccupationHeartbeat();
  // 15s heartbeat — keep last_seen fresh so a stale-row check on another
  // device correctly sees us as alive.
  occupationHeartbeat = setInterval(async () => {
    const sessionId = getMySessionId();
    if (!sessionId) return;
    try {
      await supabase
        .from("occupation")
        .update({ last_seen: Date.now() })
        .eq("user_id", userId)
        .eq("session_id", sessionId);
    } catch {
      /* best-effort */
    }
  }, 15_000);
}

function stopOccupationHeartbeat() {
  if (occupationHeartbeat) {
    clearInterval(occupationHeartbeat);
    occupationHeartbeat = null;
  }
}

function startLossPoll(userId: string, mySessionId: string) {
  stopLossPoll();
  occupationLossPoll = setInterval(async () => {
    try {
      const { data } = await supabase
        .from("occupation")
        .select("*")
        .eq("user_id", userId)
        .limit(1);
      const row = ((data || [])[0] as OccupationRow) || null;
      if (!row || row.session_id !== mySessionId) {
        stopLossPoll();
        stopOccupationHeartbeat();
        myOccupationDocId = null;
        lossListeners.forEach((l) => l());
      }
    } catch {
      /* best-effort */
    }
  }, 6_000);
}

function stopLossPoll() {
  if (occupationLossPoll) {
    clearInterval(occupationLossPoll);
    occupationLossPoll = null;
  }
}

/** Read whether THIS user currently holds an occupation. UI badge use. */
export async function getCurrentOccupation(
  userId: string,
): Promise<OccupationRow | null> {
  if (!userId) return null;
  try {
    const { data } = await supabase
      .from("occupation")
      .select("*")
      .eq("user_id", userId)
      .limit(1);
    return ((data || [])[0] as OccupationRow) || null;
  } catch {
    return null;
  }
}
