"use strict";
/**
 * CloudBase Function: admin-action
 *
 * Server-side enforcement for all privileged admin operations.
 * Runs with admin SDK (bypasses security rules), but FIRST verifies
 * the caller is in the authorised admin UID list (env: FOUNDER_IDS,
 * ADMIN_IDS).  Any unauthenticated or unauthorised call is rejected
 * with a 403 before touching the database.
 *
 * Supported actions (event.action):
 *   deleteMessage  { messageId }
 *   banUser        { targetId, reason, expiresAt? }
 *   unbanUser      { targetId }
 *   muteUser       { targetId, serverId, durationMs, reason }
 *   unmuteUser     { targetId, serverId }
 *   kickMember     { targetId, serverId }
 */

const tcb = require("@cloudbase/node-sdk");

const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const db  = app.database();

// Admin UID lists — set these as Function environment variables
// in the CloudBase console (Function config → env vars).
function parseIds(raw) {
  return new Set((raw || "").split(",").map(s => s.trim()).filter(Boolean));
}
const FOUNDER_IDS = parseIds(process.env.FOUNDER_IDS);
const ADMIN_IDS   = parseIds(process.env.ADMIN_IDS);

function isAdmin(uid) {
  return FOUNDER_IDS.has(uid) || ADMIN_IDS.has(uid);
}

exports.main = async (event, context) => {
  // 1. Authenticate caller — context.userInfo is empty for web email/pw auth;
  //    getEndUserInfo() is the reliable path (same pattern as delete-user fn).
  let callerUid;
  try {
    const endUser = await app.auth().getEndUserInfo();
    callerUid = endUser?.uid;
  } catch (e) {
    return { code: 401, message: "Unauthenticated: " + String(e?.message || e) };
  }
  if (!callerUid) {
    return { code: 401, message: "Unauthenticated" };
  }
  if (!isAdmin(callerUid)) {
    return { code: 403, message: "Not authorised" };
  }

  const { action } = event;

  try {
    switch (action) {

      case "deleteMessage": {
        const { messageId } = event;
        if (!messageId) return { code: 400, message: "messageId required" };
        await db.collection("messages").doc(messageId).remove();
        return { code: 200 };
      }

      case "banUser": {
        const { targetId, reason = "", expiresAt = null } = event;
        if (!targetId) return { code: 400, message: "targetId required" };
        await db.collection("bans").add({
          user_id: targetId,
          banned_by: callerUid,
          reason,
          created_at: Date.now(),
          expires_at: expiresAt,
        });
        return { code: 200 };
      }

      case "unbanUser": {
        const { targetId } = event;
        if (!targetId) return { code: 400, message: "targetId required" };
        const res = await db.collection("bans")
          .where({ user_id: targetId })
          .get();
        for (const doc of (res.data || [])) {
          await db.collection("bans").doc(doc._id).remove();
        }
        return { code: 200 };
      }

      case "muteUser": {
        const { targetId, serverId = "global", durationMs = 600_000, reason = "" } = event;
        if (!targetId) return { code: 400, message: "targetId required" };
        const expiresAt = Date.now() + durationMs;
        await db.collection("mutes").add({
          user_id: targetId,
          server_id: serverId,
          muted_by: callerUid,
          reason,
          created_at: Date.now(),
          expires_at: expiresAt,
        });
        return { code: 200, expiresAt };
      }

      case "unmuteUser": {
        const { targetId, serverId = "global" } = event;
        if (!targetId) return { code: 400, message: "targetId required" };
        const res = await db.collection("mutes")
          .where({ user_id: targetId, server_id: serverId })
          .get();
        for (const doc of (res.data || [])) {
          await db.collection("mutes").doc(doc._id).remove();
        }
        return { code: 200 };
      }

      case "kickMember": {
        const { targetId, serverId } = event;
        if (!targetId || !serverId) return { code: 400, message: "targetId and serverId required" };
        const res = await db.collection("server_members")
          .where({ user_id: targetId, server_id: serverId })
          .get();
        for (const doc of (res.data || [])) {
          await db.collection("server_members").doc(doc._id).remove();
        }
        return { code: 200 };
      }

      default:
        return { code: 400, message: `Unknown action: ${action}` };
    }
  } catch (err) {
    console.error("[admin-action] error:", err);
    return { code: 500, message: String(err?.message || err) };
  }
};
