/**
 * delete-presence — fast best-effort removal of a presence row.
 *
 * Why this exists:
 *  Browsers kill background fetches when a tab closes, so the
 *  `db.collection("presence").doc(id).remove()` we fire from `pagehide`
 *  succeeds maybe ~90% of the time. The remaining ~10% leaves the row
 *  sitting around until its TTL (45s) expires, during which the user still
 *  appears online to everyone else.
 *
 *  `navigator.sendBeacon()` is the ONE network primitive browsers
 *  *guarantee* will be flushed even on tab teardown. It can only POST to
 *  a regular HTTP endpoint, not to the CloudBase SDK. So we ship a tiny
 *  cloud function with an HTTP trigger that just deletes one row.
 *
 * Trust model:
 *  We don't have access to the caller's CloudBase identity over the HTTP
 *  trigger (no auth header travels with sendBeacon). Instead we rely on
 *  the doc id being unguessable (CloudBase auto-id, ~96 bits of entropy)
 *  AND verify that the row's `presence_key` matches the value the client
 *  sent in the body. An attacker who doesn't know both of those values
 *  for the victim cannot delete it. Worst-case forgery just makes the
 *  victim briefly appear offline — they'll re-appear within 1-3s as the
 *  next heartbeat re-creates the row. Acceptable.
 *
 * Deployment:
 *  1. Deploy as a normal cloud function in your CloudBase env.
 *  2. Open the function settings → "触发器/触发管理/HTTP 触发器".
 *     Add a path like `/delete-presence`. CloudBase will print a URL like
 *       https://<env>-<id>.service.tcloudbase.com/delete-presence
 *  3. Copy that URL into `.env.local` as
 *       NEXT_PUBLIC_DELETE_PRESENCE_URL=https://...
 *     and rebuild. The frontend will then sendBeacon to it on pagehide.
 *  4. If the URL isn't set, the frontend silently falls back to the
 *     existing best-effort SDK delete.
 */

"use strict";

const tcb = require("@cloudbase/node-sdk");
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const db = app.database();

// CORS preflight + actual response headers for the browser sendBeacon.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function ok(payload) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}
function bad(status, msg) {
  return {
    statusCode: status,
    headers: CORS_HEADERS,
    body: JSON.stringify({ ok: false, error: msg }),
  };
}

exports.main = async (event /* , context */) => {
  // CORS preflight (in case the browser sends OPTIONS).
  if (event && event.httpMethod === "OPTIONS") {
    return ok({ ok: true, preflight: true });
  }

  // The function is invokable in two ways:
  //  1. via SDK (`app.callFunction({ name, data })`) — `event` IS the data
  //  2. via HTTP trigger (sendBeacon / fetch) — `event.body` is a JSON string
  let payload = event || {};
  if (typeof payload.body === "string") {
    try {
      payload = JSON.parse(payload.body);
    } catch {
      return bad(400, "invalid JSON body");
    }
  }

  const docId = payload.docId;
  const presenceKey = payload.presenceKey;
  if (!docId || typeof docId !== "string" || !presenceKey || typeof presenceKey !== "string") {
    return bad(400, "missing docId or presenceKey");
  }

  try {
    // Verify the row's presence_key matches what the client claims it owns.
    // If the row is already gone, treat as success — the goal was reached.
    let row = null;
    try {
      const got = await db.collection("presence").doc(docId).get();
      // CloudBase doc().get() shape varies; handle both.
      if (got && got.data) {
        row = Array.isArray(got.data) ? got.data[0] : got.data;
      }
    } catch (e) {
      // doc not found → fall through, treat as already gone.
      if (e && /not found|不存在|DATABASE_DOC/i.test(e.message || "")) {
        return ok({ ok: true, alreadyGone: true });
      }
      throw e;
    }
    if (!row) return ok({ ok: true, alreadyGone: true });

    if (row.presence_key !== presenceKey) {
      return bad(403, "presence_key mismatch");
    }

    await db.collection("presence").doc(docId).remove();
    return ok({ ok: true, deleted: true });
  } catch (e) {
    console.error("[delete-presence] failed:", e && e.message);
    return bad(500, e && e.message ? e.message : "internal error");
  }
};
