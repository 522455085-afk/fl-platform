/**
 * delete-listing — privileged deletion of a trade_listings or auction_listings row.
 *
 * Why this exists:
 *  CloudBase client-side security rules can block deletes even for the document
 *  owner when the `_openid` stored on the row differs from the current session
 *  (e.g. after a re-login). Cloud functions run with server-side privileges and
 *  bypass all security rules, so they can always delete.
 *
 * Trust model:
 *  - Caller must be authenticated (CloudBase verifies via userInfo).
 *  - Either the caller owns the document (_openid matches) OR `force` is true
 *    (admin force-delist — the client gate already enforces isPlatformAdmin).
 *  - We verify ownership server-side when force=false.
 *
 * Deployment:
 *  1. Deploy as a CloudBase cloud function named "delete-listing".
 *  2. In function settings, set "调用方式" to allow authenticated users.
 *  3. Set NEXT_PUBLIC_DELETE_LISTING_FN=delete-listing in .env.local.
 */

"use strict";

const tcb = require("@cloudbase/node-sdk");
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV });
const db = app.database();

const ALLOWED_COLLECTIONS = new Set(["trade_listings", "auction_listings"]);

exports.main = async (event, context) => {
  const callerOpenid = context?.userInfo?.openId || context?.userInfo?.openid || null;
  if (!callerOpenid) {
    return { ok: false, error: "未登录" };
  }

  const { collection, docId, force } = event || {};
  if (!collection || !ALLOWED_COLLECTIONS.has(collection)) {
    return { ok: false, error: "无效的集合名" };
  }
  if (!docId || typeof docId !== "string") {
    return { ok: false, error: "缺少 docId" };
  }

  // Fetch the document to verify existence and ownership.
  let doc = null;
  try {
    // Try by CloudBase _id first, then by custom id field.
    const byId = await db.collection(collection).where({ id: docId }).limit(1).get();
    if (byId.data && byId.data.length > 0) {
      doc = byId.data[0];
    } else {
      const byCloudId = await db.collection(collection).doc(docId).get();
      if (byCloudId.data) {
        doc = Array.isArray(byCloudId.data) ? byCloudId.data[0] : byCloudId.data;
      }
    }
  } catch (e) {
    // doc not found
  }

  if (!doc) {
    return { ok: false, error: "记录不存在" };
  }

  // Ownership check — skip when force=true (admin action gated client-side).
  if (!force) {
    const docOpenid = doc._openid || doc.seller_openid || null;
    if (docOpenid && docOpenid !== callerOpenid) {
      return { ok: false, error: "无权删除他人的物品" };
    }
  }

  // Delete using the document's CloudBase _id (bypasses security rules).
  try {
    const docCloudId = doc._id;
    if (docCloudId) {
      await db.collection(collection).doc(docCloudId).remove();
    } else {
      // Fallback: delete by custom id field.
      await db.collection(collection).where({ id: docId }).remove();
    }
    return { ok: true, deleted: 1 };
  } catch (e) {
    console.error("[delete-listing] remove failed:", e && e.message);
    return { ok: false, error: e && e.message ? e.message : "删除失败" };
  }
};
