"use client";

import cloudbase from "@cloudbase/js-sdk";
import type { ICloudBaseApp, IDatabase, IDatabaseCommand, IAuth } from "@/lib/types";

const ENV_ID = process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID || "fl-platform-d9ggvxhq738a2a52a";

const isBrowser = typeof window !== "undefined";

/**
 * Silence a specific noisy CloudBase SDK log: `[realtime] no realtime
 * listener found responsible for watchId ...`
 *
 * Context: CloudBase's websocket client logs this via `console.error`
 * whenever an event arrives for a watch channel whose listener was
 * already torn down — which happens routinely during React effect
 * re-runs, React strict mode double-mounts, and ordinary teardown.
 * It is **not** an actionable error.
 *
 * Why we patch console.error: Next.js dev mode wraps every
 * `console.error` with `intercept-console-error.ts`, which funnels
 * them into the dev error overlay (the "N issues" badge). CloudBase
 * emits dozens of these per minute, which spams the overlay to the
 * point where React's main-thread gets bogged down rendering error
 * counters — reported as "服务器栏卡死" etc.
 *
 * We downgrade the specific message to `console.debug` so it's still
 * visible if needed but no longer hits the error overlay. All other
 * `console.error` calls flow through unchanged.
 */
if (isBrowser && !(globalThis as { __fl_cb_console_patched?: boolean }).__fl_cb_console_patched) {
  (globalThis as { __fl_cb_console_patched?: boolean }).__fl_cb_console_patched = true;
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string") {
      if (first.startsWith("[realtime] no realtime listener found responsible")) {
        // eslint-disable-next-line no-console
        console.debug("[cb-rt silenced]", ...args);
        return;
      }
    }
    // Silence CloudBase SDK's "network request error" — transient WebSocket
    // reconnect noise; non-fatal because the poll fallback is the real path.
    const msg = args.map(String).join(" ");
    if (msg.includes("network request error")) {
      // eslint-disable-next-line no-console
      console.debug("[cb-rt silenced network]", ...args);
      return;
    }
    origError(...args);
  };

  // CloudBase's websocket client prints `nextevent N ignored` (one per
  // active watch, per event — easily 4-8x amplification) plus
  // `[realtime listener] event received is out of order` and
  // `internal non-fatal error: unexpected message received while
  // REBUILDING` whenever the WS reconnects. None of these are
  // actionable — the SDK is just narrating its internal multiplexing.
  // Down-rank to console.debug so the verbose filter still shows them
  // for diagnostics but they don't drown the dev console.
  const origLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    const first = args[0];
    // Pattern A — joined string: console.log("nextevent N ignored", obj)
    if (typeof first === "string") {
      if (
        /^nextevent \d+ ignored\b/.test(first) ||
        first.startsWith("[realtime listener] event received is out of order") ||
        first.startsWith("[realtime listener] internal non-fatal error: unexpected message received while REBUILDING") ||
        first.startsWith("[realtime] rebuildWatch success") ||
        first.startsWith("[realtime] initWatch success")
      ) {
        // eslint-disable-next-line no-console
        console.debug("[cb-rt silenced]", ...args);
        return;
      }
    }
    // Pattern B — separate args: console.log("nextevent", N, "ignored", obj)
    // (CloudBase SDK's actual call shape — the trailing "Object" in browser
    //  logs is the obj rendered as a separate arg.)
    if (
      first === "nextevent" &&
      typeof args[1] === "number" &&
      args[2] === "ignored"
    ) {
      // eslint-disable-next-line no-console
      console.debug("[cb-rt silenced]", ...args);
      return;
    }
    origLog(...args);
  };

  // CloudBase realtime SDK actually emits "nextevent N ignored" via
  // console.warn (the source map points at the SDK's warn() helper).
  // Mirror the log() patch onto warn() so those messages don't bypass
  // our silencing layer and flood the console N×watches per event.
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string") {
      if (
        /^nextevent \d+ ignored\b/.test(first) ||
        first.startsWith("[realtime listener] event received is out of order") ||
        first.startsWith("[realtime listener] internal non-fatal error: unexpected message received while REBUILDING") ||
        first.startsWith("[realtime] rebuildWatch success") ||
        first.startsWith("[realtime] initWatch success")
      ) {
        // eslint-disable-next-line no-console
        console.debug("[cb-rt silenced]", ...args);
        return;
      }
    }
    if (
      first === "nextevent" &&
      typeof args[1] === "number" &&
      args[2] === "ignored"
    ) {
      // eslint-disable-next-line no-console
      console.debug("[cb-rt silenced]", ...args);
      return;
    }
    origWarn(...args);
  };
}

/**
 * Build a Proxy that throws on any property access. We return this on the
 * server (during the static-export prerender) so that simply importing this
 * module never blows up.
 */
function makeStub<T = unknown>(label: string): T {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        // Allow benign symbol introspection (e.g. console.log of the proxy).
        if (typeof prop === "symbol") return undefined;
        // The realtime watch result must have `close()` etc.; return a no-op.
        if (prop === "close" || prop === "remove" || prop === "unsubscribe") {
          return () => {};
        }
        throw new Error(
          `[cloudbase stub] called ${label}.${String(prop)} but ` +
            (isBrowser
              ? "NEXT_PUBLIC_CLOUDBASE_ENV_ID is not set"
              : "this is a server-side prerender; CloudBase is browser-only"),
        );
      },
      apply() {
        throw new Error(`[cloudbase stub] cannot call ${label}`);
      },
    },
  ) as T;
}

const canInit = isBrowser && ENV_ID.length > 0;

if (isBrowser && !ENV_ID) {
   
  console.warn(
    "[cloudbase] NEXT_PUBLIC_CLOUDBASE_ENV_ID is not set. " +
      "CloudBase calls will throw. Set it in .env.local or your hosting env.",
  );
}

let _app: ICloudBaseApp | null = null;
if (canInit) {
  try {
    _app = cloudbase.init({ env: ENV_ID });
  } catch (e) {
     
    console.error("[cloudbase] init failed:", e);
  }

  // CloudBase SDK internally rejects a promise with a SYS_ERR payload when a
  // watch init hiccups (see `Cannot read property 'code' of undefined`). The
  // rejection happens deep inside the SDK's WebSocket handler, so we can't
  // wrap it with a try/catch at our call sites. Instead, register a
  // window-level handler that swallows just this specific message so the
  // DevTools console isn't spammed. Other rejections propagate normally.
  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (ev) => {
      const msg = (reason as { message?: string })?.message || String(reason || "");
      if (
        msg.includes("Cannot read property 'code' of undefined") ||
        msg.includes("SYS_ERR")
      ) {
        ev.preventDefault();
      }
    });
  }
}

export const app: ICloudBaseApp | null = _app;
export const auth: IAuth = _app
  ? _app.auth({ persistence: "local" }) as unknown as IAuth
  : makeStub<IAuth>("auth");
export const db: IDatabase = _app 
  ? _app.database() as unknown as IDatabase 
  : makeStub<IDatabase>("db");
export const dbCmd: IDatabaseCommand = _app 
  ? _app.database().command as unknown as IDatabaseCommand 
  : makeStub<IDatabaseCommand>("dbCmd");

// Warm-up: fire a minimal probe query immediately so the CloudBase HTTP
// connection (TCP + TLS handshake, ~200–500 ms) is established before the
// user clicks any channel. The query is intentionally tiny (limit 1) and
// fire-and-forget — errors are silently swallowed.
if (canInit) {
  setTimeout(() => {
    try {
      db.collection("messages").limit(1).get().catch(() => {});
    } catch {
      /* warm-up probe — ignore all errors */
    }
  }, 0);
}

// Dev convenience: expose `db` on window so you can paste cleanup snippets in
// the F12 Console without bundling new code. Only runs in the browser; safe
// because all operations still go through CloudBase's permission rules
// (you can only delete docs you own).
if (typeof window !== "undefined" && _app) {
  // Dev tools exposed on window for F12 console debugging
  const devTools: {
    db: IDatabase;
    dbCmd: IDatabaseCommand;
    auth: IAuth;
    clearMyDocs: (collection: string) => Promise<number>;
    cleanAllReactions: () => Promise<number>;
    cleanAllMyServers: () => Promise<{ servers: number; members: number }>;
    help: () => void;
  } = {
    db,
    dbCmd,
    auth,
    db,
    dbCmd,
    auth,
    /**
     * Delete every doc the current user owns in the given collection,
     * page by page. Use sparingly — there is no confirmation prompt.
     * Returns the number of docs removed.
     */
    async clearMyDocs(collection: string): Promise<number> {
      let total = 0;
      // CloudBase get() is paginated at ~20 by default; loop until empty.
      // We only see docs we own (per the read rule) and can only remove
      // those (per the write rule), so this naturally scopes to "mine".
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await db.collection(collection).limit(100).get();
        const rows = res?.data || [];
        if (rows.length === 0) break;
        for (const row of rows) {
          try {
            await db.collection(collection).doc(row._id).remove();
            total++;
          } catch {
            /* not mine, skip */
          }
        }
         
        console.log(`[__fl.clearMyDocs] ${collection}: removed ${total}`);
        if (rows.length < 100) break;
      }
      return total;
    },

    /**
     * Drop every reaction the current user has placed on any message.
     * Useful when iterating on the reaction set during dev.
     */
    async cleanAllReactions(): Promise<number> {
      // Use the SAME id source as the rest of the app (auth-store /
      // supabase shim). CloudBase's raw getLoginState() returns user.uid
      // which has historically diverged from the shim's user.id in some
      // SDK builds — using the zustand store guarantees alignment.
      const { useAuth } = await import("@/lib/auth-store");
      const myId = useAuth.getState().user?.id;
      if (!myId) {
        console.warn("[__fl.cleanAllReactions] not logged in");
        return 0;
      }
      let total = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await db
          .collection("message_reactions")
          .where({ user_id: myId })
          .limit(100)
          .get();
        const rows = res?.data || [];
        if (rows.length === 0) break;
        for (const row of rows) {
          try {
            await db.collection("message_reactions").doc(row._id).remove();
            total++;
          } catch {
            /* skip */
          }
        }
         
        console.log(`[__fl.cleanAllReactions] removed ${total}`);
        if (rows.length < 100) break;
      }
      return total;
    },

    /**
     * Disband every user-owned server I created (servers + memberships).
     * Won't touch the platform-shipped official servers (they don't live in
     * the `servers` collection).
     */
    async cleanAllMyServers(): Promise<{ servers: number; members: number }> {
      const { useAuth } = await import("@/lib/auth-store");
      const myId = useAuth.getState().user?.id;
      if (!myId) {
        console.warn("[__fl.cleanAllMyServers] not logged in");
        return { servers: 0, members: 0 };
      }
      let serverCount = 0;
      let memberCount = 0;
      const owned = await db
        .collection("servers")
        .where({ creator_id: myId })
        .limit(200)
        .get();
      const rows = owned?.data || [];
      for (const s of rows) {
        try {
          // Best-effort: remove every membership row (only mine will succeed
          // under default `auth != null` write rule unless you wired up a
          // cloud function to allow creators to delete others).
          const memberRes = await db
            .collection("server_members")
            .where({ server_id: s.id })
            .limit(500)
            .get();
          for (const m of memberRes?.data || []) {
            try {
              await db.collection("server_members").doc(m._id).remove();
              memberCount++;
            } catch {
              /* not mine, skip */
            }
          }
          await db.collection("servers").doc(s._id).remove();
          serverCount++;
        } catch (e) {
           
          console.warn("[__fl.cleanAllMyServers] skip", s.id, e);
        }
      }
       
      console.log(
        `[__fl.cleanAllMyServers] servers=${serverCount} members=${memberCount}`,
      );
      return { servers: serverCount, members: memberCount };
    },

    /** Print every collection cell currently used. */
    help(): void {
      console.log(
        "[__fl] Dev tools:\n" +
          "  __fl.db / __fl.dbCmd / __fl.auth — raw CloudBase handles\n" +
          "  __fl.clearMyDocs(name)           — remove every doc I own in `name`\n" +
          "  __fl.cleanAllReactions()         — undo all my emoji reactions\n" +
          "  __fl.cleanAllMyServers()         — disband every server I created",
      );
    },
  };
  (window as unknown as { __fl: typeof devTools }).__fl = devTools;
}

/**
 * CloudBase requires an authenticated session before realtime watch() works.
 * If the user isn't logged in yet, fall back to anonymous sign-in so that
 * read-only views (browsing trade listings before logging in) still work.
 */
let anonPromise: Promise<void> | null = null;
export async function ensureAuthForRealtime(): Promise<void> {
  if (!canInit) return;
  if (anonPromise) return anonPromise;

  anonPromise = (async () => {
    try {
      const state = await auth.getLoginState();
      if (state) return;
       
      console.log("[cloudbase] no login state, signing in anonymously");
      await auth.signInAnonymously();
    } catch (e) {
       
      console.warn("[cloudbase] anonymous sign-in failed:", e);
      anonPromise = null;
      throw e;
    }
  })();

  return anonPromise;
}
