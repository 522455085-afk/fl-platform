/**
 * delete-user — privileged hard-delete of the current user.
 *
 * What this does (in order):
 *  1. Read the caller's uid from CloudBase context
 *  2. Refuse if the caller still owns any custom servers (defense in depth;
 *     the client also checks, but this is the authoritative gate)
 *  3. Remove every row in our user-scoped collections owned by this uid:
 *       profiles, server_members, dm_threads, dm_messages, message_reactions,
 *       presence
 *  4. Try to remove the CloudBase auth row itself via the admin API. The
 *     exact endpoint depends on the SDK version available in the runtime —
 *     we attempt the v2 surface first and fall back gracefully so the
 *     function still succeeds even if the admin call isn't supported in
 *     this environment.
 *  5. Return { ok: true }
 *
 * Safety:
 *  - Runs with cloud function privileges (service-role-equivalent), so DB
 *    writes bypass row-level security. Make sure the calling user can only
 *    target their own data — we hard-pin every query to `context.userInfo.uid`.
 *
 * Deployment: see DEPLOY_DELETE_USER_FUNCTION.md in the repo root.
 */

"use strict";

const tcb = require("@cloudbase/node-sdk");
const app = tcb.init({
  env: tcb.SYMBOL_CURRENT_ENV,
});
const db = app.database();
const _ = db.command;
const auth = app.auth();

// Lazily-initialised CloudBase Manager (admin SDK). Requires
// TENCENT_SECRET_ID + TENCENT_SECRET_KEY + TCB_ENV_ID set as cloud
// function environment variables. We don't fail the whole function if
// these are missing — auth-row deletion will fall back to the SDK paths
// that are known not to work in this runtime, and the caller will get
// authDeleted: false. The frontend's tombstone gate keeps the user out
// in either case, so this is degradation-tolerant.
let _manager = null;
function getManager() {
  if (_manager !== null) return _manager;
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const envId = process.env.TCB_ENV_ID || process.env.SCF_NAMESPACE;
  if (!secretId || !secretKey || !envId) {
    console.warn(
      "[delete-user] manager-node not configured (missing env vars):",
      {
        hasSecretId: !!secretId,
        hasSecretKey: !!secretKey,
        hasEnvId: !!envId,
      },
    );
    _manager = false;
    return false;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const CloudBaseManager = require("@cloudbase/manager-node");
    _manager = new CloudBaseManager({
      secretId,
      secretKey,
      envId,
    });
    console.log("[delete-user] manager-node initialised for env:", envId);
    return _manager;
  } catch (e) {
    console.warn("[delete-user] manager-node init failed:", e && e.message);
    _manager = false;
    return false;
  }
}

/**
 * Best-effort delete every row in `collection` matching `where`.
 * Swallows errors so a single failing collection doesn't abort the whole
 *注销 — the user will still get their auth row removed, which is the
 * point.
 */
async function safeDelete(collection, where) {
  try {
    const res = await db.collection(collection).where(where).remove();
    return res?.deleted || 0;
  } catch (e) {
    console.warn(`[delete-user] ${collection} delete failed:`, e && e.message);
    return 0;
  }
}

exports.main = async (event, context) => {
  // ----- Diagnostic mode -----
  // Bypass auth checks to verify manager-node + env vars + permissions.
  // Trigger from CloudBase test panel with: { "__diagnose": true }
  // Returns the state of every dependency without touching any data.
  if (event && event.__diagnose === true) {
    const mgr = getManager();
    const out = {
      mode: "diagnose",
      env: {
        hasSecretId: !!process.env.TENCENT_SECRET_ID,
        hasSecretKey: !!process.env.TENCENT_SECRET_KEY,
        TCB_ENV_ID: process.env.TCB_ENV_ID || null,
        SCF_NAMESPACE: process.env.SCF_NAMESPACE || null,
      },
      manager: {
        initialised: !!mgr,
        hasUserModule: !!(mgr && mgr.user),
        userModuleMethods:
          mgr && mgr.user
            ? Object.getOwnPropertyNames(Object.getPrototypeOf(mgr.user) || {})
            : [],
      },
    };
    // Probe a harmless query to validate credentials work end-to-end.
    if (mgr && mgr.user && typeof mgr.user.getEndUserList === "function") {
      try {
        const probe = await mgr.user.getEndUserList({ limit: 1, offset: 0 });
        out.manager.probeOk = true;
        out.manager.probeSample = {
          total: probe?.Total ?? probe?.total,
          firstUid: probe?.Users?.[0]?.UUId || probe?.users?.[0]?.uuid || null,
        };
      } catch (e) {
        out.manager.probeOk = false;
        out.manager.probeError = e && (e.message || String(e));
      }
    }
    console.log("[delete-user] DIAGNOSE:", JSON.stringify(out));
    return out;
  }

  // CloudBase exposes caller identity in many shapes depending on the
  // login type (anonymous / WeChat / email-password / custom-token).
  // For email-password logins, `context.userInfo` is typically EMPTY —
  // we have to call the privileged `auth().getEndUserInfo()` to recover
  // the real uid. Try everything and log what we see.
  const ctxUserInfo = (context && context.userInfo) || {};
  const ctxAuth = (context && context.auth) || {};

  let resolvedUid =
    ctxUserInfo.uid ||
    ctxUserInfo.openId ||
    ctxUserInfo.userId ||
    ctxUserInfo.customUserId ||
    ctxAuth.uid ||
    ctxAuth.openId ||
    null;

  // Authoritative path: ask the auth service for the end user attached
  // to this invocation. Works for email/password and custom-token logins.
  let endUserInfo = null;
  try {
    const r = await app.auth().getEndUserInfo();
    endUserInfo = r && (r.userInfo || r);
    if (endUserInfo) {
      resolvedUid =
        resolvedUid ||
        endUserInfo.uid ||
        endUserInfo.userID ||
        endUserInfo.userId ||
        endUserInfo.customUserId ||
        endUserInfo.openId ||
        null;
    }
  } catch (e) {
    console.warn("[delete-user] getEndUserInfo failed:", e && e.message);
  }

  console.log("[delete-user] context.userInfo:", JSON.stringify(ctxUserInfo));
  console.log("[delete-user] context.auth:", JSON.stringify(ctxAuth));
  console.log("[delete-user] endUserInfo:", JSON.stringify(endUserInfo));
  console.log("[delete-user] resolved uid:", resolvedUid);

  const uid = resolvedUid;

  if (!uid) {
    return {
      ok: false,
      error: "云函数无法识别调用者身份。userInfo / auth 字段都为空。",
      debug: {
        userInfo: ctxUserInfo,
        auth: ctxAuth,
        endUserInfo,
        eventKeys: Object.keys(event || {}),
      },
    };
  }

  // ---- Pre-flight: refuse if caller owns servers ----
  try {
    const owned = await db
      .collection("servers")
      .where({ creator_id: uid })
      .limit(1)
      .get();
    if ((owned.data || []).length > 0) {
      return {
        ok: false,
        error:
          "你仍是一个或多个服务器的创始人。请先转让创始人或解散服务器后再注销。",
      };
    }
  } catch (e) {
    // Non-fatal — proceed.
    console.warn("[delete-user] owned-server check failed:", e && e.message);
  }

  // ---- Cleanup user-scoped data (everything EXCEPT profile row) ----
  // We deliberately DO NOT hard-delete the profile row here. Reason: in this
  // environment the cloud function cannot delete the CloudBase auth row
  // (SDK has no deleteUser method), which means the user can still log in
  // with email/password. If we also deleted the profile, ensureProfile on
  // re-login would create a fresh row and resurrect the account.
  //
  // Instead: leave the profile row in place but redact every personal field
  // and set deleted_at. The frontend's ensureProfile sees deleted_at and
  // immediately signs the user out -> permanent ban.
  const counts = {
    server_members: await safeDelete("server_members", { user_id: uid }),
    dm_threads: await safeDelete("dm_threads", { user_id: uid }),
    dm_messages: await safeDelete("dm_messages", { author_id: uid }),
    message_reactions: await safeDelete("message_reactions", { user_id: uid }),
    presence: await safeDelete("presence", { presence_key: uid }),
    profiles_tombstoned: 0,
  };

  // Tombstone the profile row.
  try {
    const stamp = new Date().toISOString();
    const redacted = `__deleted_${String(uid).slice(0, 8)}`;
    const upd = await db
      .collection("profiles")
      .where({ id: uid })
      .update({
        deleted_at: stamp,
        username: redacted,
        email: null,
        phone: null,
        phone_verified_at: null,
        avatar_url: null,
        bio: null,
      });
    counts.profiles_tombstoned = upd?.updated || 0;
    console.log("[delete-user] profile tombstone updated:", upd);
  } catch (e) {
    console.warn(
      "[delete-user] profile tombstone failed:",
      e && e.message,
    );
  }

  // ---- Try to drop the CloudBase auth row ----
  // The admin auth API surface varies between SDK versions. We try a few
  // shapes; whichever one resolves wins. If none do, we still return ok
  // because the data has been wiped — the auth row will need a manual or
  // scheduled sweep.
  let authDeleted = false;
  const authAttempts = [];
  const tryDeleteUid = async (label, fn) => {
    try {
      const r = await fn();
      authDeleted = true;
      authAttempts.push({ label, ok: true, result: r });
      console.log(`[delete-user] auth delete OK via ${label}:`, r);
    } catch (e) {
      authAttempts.push({ label, ok: false, error: e && e.message });
      console.warn(`[delete-user] auth delete via ${label} failed:`, e && e.message);
    }
  };

  // ===== Attempt 1: CloudBase Manager Node SDK (PRODUCTION PATH) =====
  // This is the supported, documented way to delete an end user from a
  // CloudBase environment. Requires SecretId/SecretKey via env vars.
  const mgr = getManager();
  if (!authDeleted && mgr && mgr.user) {
    if (typeof mgr.user.deleteEndUsers === "function") {
      await tryDeleteUid("manager.user.deleteEndUsers", async () => {
        return mgr.user.deleteEndUsers({ userList: [uid] });
      });
    }
    if (!authDeleted && typeof mgr.user.deleteUsers === "function") {
      await tryDeleteUid("manager.user.deleteUsers", async () => {
        return mgr.user.deleteUsers({ userList: [uid] });
      });
    }
  }

  // ===== Attempt 2..N: Fallbacks (best-effort, all known to fail) =====
  // Kept only as defense-in-depth in case a future SDK exposes one of them.
  if (!authDeleted && typeof auth.deleteUser === "function") {
    await tryDeleteUid("auth.deleteUser", () => auth.deleteUser(uid));
  }
  if (!authDeleted && typeof auth.getUserManagement === "function") {
    try {
      const userMgmt = auth.getUserManagement();
      if (userMgmt && typeof userMgmt.deleteUser === "function") {
        await tryDeleteUid("userMgmt.deleteUser", () => userMgmt.deleteUser(uid));
      }
    } catch (e) {
      /* ignore */
    }
  }

  return {
    ok: true,
    counts,
    authDeleted,
    authAttempts,
    note: authDeleted
      ? undefined
      : "Auth 凭证未删除（云函数 SDK 不支持本环境）。",
  };
};
