"use client";

/**
 * Supabase-compatible adapter backed by Tencent CloudBase.
 *
 * Why: our app (chat / trade / party / member list) was written against the
 * Supabase JS client API. CloudBase v2 SDK has a near-identical Auth API and
 * a similar database+realtime API, so we wrap it once and the rest of the
 * app keeps working unchanged.
 *
 * Coverage:
 *  - auth.signInWithPassword / signUp / signOut / getSession / onAuthStateChange
 *  - from(table).select(...).eq/gt/...().order().limit() → Promise<{data, error}>
 *  - from(table).insert(row).select().single() → {data, error}
 *  - from(table).update({...}).eq(...) → {data, error}
 *  - from(table).delete().eq(...) → {data, error}
 *  - channel(name).on('postgres_changes', {table, filter, event}, cb).subscribe()
 *  - channel(name, {config:{presence:{key}}}).on('presence', ..., cb)
 *      .track(state) / .presenceState()  (best-effort heartbeat-based presence)
 *  - removeChannel(ch)
 */

import { app, auth, db, dbCmd, ensureAuthForRealtime } from "@/lib/cloudbase";
import type { ICollection } from "@/lib/types";

// ============================================================
// Helpers
// ============================================================

// Generic result type for Supabase-compatible queries.
// Uses Record<string, unknown> as base type instead of `any` for better type safety.
// Real row typing is enforced via the generic T parameter at call sites.
type Result<T> = { data: T | null; error: { message: string } | null };

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}

function err(message: string): Result {
  return { data: null, error: { message } };
}

function uuid(): string {
  // Tiny RFC4122-v4 generator (not crypto-grade but fine for record ids).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Parse a Supabase-style filter string like `channel_id=eq.foo`
 * Returns { field: 'channel_id', op: 'eq', value: 'foo' } or null on failure.
 */
function parseFilter(s: string): { field: string; op: string; value: string } | null {
  const m = s.match(/^([\w.-]+)=(eq|gt|gte|lt|lte|neq)\.(.+)$/);
  if (!m) return null;
  return { field: m[1], op: m[2], value: m[3] };
}

/**
 * Strip CloudBase's `_id` and surface our own `id`. CloudBase auto-creates
 * `_id`; we always carry our own UUID `id` in inserts.
 */
function normalize<T extends Record<string, unknown>>(doc: T): T {
  if (!doc) return doc;
  // If our row had an explicit id, prefer it; otherwise fall back to _id.
  if (!("id" in doc) && "_id" in doc) {
    return { ...doc, id: (doc as Record<string, unknown>)._id } as unknown as T;
  }
  return doc;
}

// ============================================================
// Query builder (from('table'))
// ============================================================

type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

/** Generic query builder with Supabase-compatible API */
class TableQuery<T extends Record<string, unknown> = Record<string, unknown>> implements PromiseLike<Result<T>> {
  private collection: string;
  private filters: { field: string; op: Op; value: unknown }[] = [];
  private orderField?: string;
  private orderDirection: "asc" | "desc" = "asc";
  private limitCount?: number;
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: unknown = null;
  private wantSingle = false;

  constructor(collection: string) {
    this.collection = collection;
  }

  // -- builder API matching Supabase ----------------------------

  select(_fields?: string) {
    // CRITICAL: don't clobber an in-progress insert/update/delete mode.
    // Supabase chains `.insert(row).select().single()` to mean "do the
    // write, then return what was written". If we reset mode here, the
    // shim treats it as a plain SELECT and never executes the write —
    // returning whatever the first row in the collection happens to be.
    if (this.mode === "select") {
      // first .select() in the chain — already in select mode, no-op
      this.mode = "select";
    }
    // For insert/update/delete: leave mode alone; execute() will return
    // the affected rows in normalized form.
    return this;
  }

  insert(row: Partial<T> | Partial<T>[]) {
    this.mode = "insert";
    if (Array.isArray(row)) {
      this.payload = row.map((r) => ({ id: (r as { id?: string }).id ?? uuid(), ...r }));
    } else {
      this.payload = { id: (row as { id?: string }).id ?? uuid(), ...row };
    }
    return this;
  }

  update(patch: Partial<T>) {
    this.mode = "update";
    this.payload = patch;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, op: "eq", value });
    return this;
  }
  neq(field: string, value: unknown) {
    this.filters.push({ field, op: "neq", value });
    return this;
  }
  gt(field: string, value: unknown) {
    this.filters.push({ field, op: "gt", value });
    return this;
  }
  gte(field: string, value: unknown) {
    this.filters.push({ field, op: "gte", value });
    return this;
  }
  lt(field: string, value: unknown) {
    this.filters.push({ field, op: "lt", value });
    return this;
  }
  lte(field: string, value: unknown) {
    this.filters.push({ field, op: "lte", value });
    return this;
  }
  /**
   * Supabase-style `.in(field, [v1, v2, ...])` — match any of the
   * supplied values. Translates to CloudBase's `dbCmd.in(values)` at
   * execution time. Added when callers (last-messages-store) needed
   * a single-shot batched fetch instead of N parallel `.eq()` queries
   * (the previous behaviour was the cause of the "进入服务器一直
   * 转圈" lockup — calling a missing `.in()` threw a TypeError that
   * left the eager-preload promise rejected and silently broken).
   */
  in(field: string, values: unknown[]) {
    this.filters.push({ field, op: "in", value: values });
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field;
    this.orderDirection = options?.ascending === false ? "desc" : "asc";
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  /** Supabase's .single() returns a single object instead of array. */
  single() {
    this.wantSingle = true;
    return this;
  }

  /** Supabase's .maybeSingle() — returns single | null without error if empty */
  maybeSingle() {
    this.wantSingle = true;
    return this;
  }

  // -- Promise interface -----------------------------------------

  /** 8-second guard so a hung CloudBase request never blocks the UI indefinitely. */
  private async execute(): Promise<Result> {
    let tid: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<Result>((_, reject) => {
      tid = setTimeout(
        () => reject(new Error(`CloudBase query timed out (8s): ${this.collection}`)),
        8000,
      );
    });
    try {
      const result = await Promise.race([this._doWork(), guard]);
      clearTimeout(tid);
      return result;
    } catch (e) {
      clearTimeout(tid);
      return err((e instanceof Error ? e.message : String(e)) || "query error");
    }
  }

  then<TR1 = Result, TR2 = never>(
    onfulfilled?:
      | ((value: Result) => TR1 | PromiseLike<TR1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TR2 | PromiseLike<TR2>)
      | undefined
      | null,
  ): PromiseLike<TR1 | TR2> {
    return this.execute().then(onfulfilled as never, onrejected as never);
  }

  private async _doWork(): Promise<Result> {
    try {
      // Intentionally NOT calling ensureAuthForRealtime() here.
      //
      // Doing so can force an anonymous sign-in that overrides the real
      // signed-in user's _openid for a split second, which breaks writes
      // against a row the real user owns (e.g. their own profile). CRUD
      // operations should run with whatever auth context is active; if the
      // user is genuinely logged out, CloudBase will return its own error.
      //
      // Anonymous fallback is only needed for realtime watch() — handled in
      // subscribe() below.

      if (this.mode === "insert") {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted: Record<string, unknown>[] = [];
        for (const row of rows as Record<string, unknown>[]) {
          await db.collection(this.collection).add(row);
          inserted.push(row);
        }
        if (this.wantSingle) {
          return ok(normalize(inserted[0]));
        }
        return ok(inserted);
      }

      // Build CloudBase query for select/update/delete with filters.
      const whereObj: Record<string, unknown> = {};
      for (const f of this.filters) {
        const v = f.value;
        if (f.op === "eq") {
          whereObj[f.field] = v;
        } else if (f.op === "neq") {
          whereObj[f.field] = dbCmd.neq(v);
        } else if (f.op === "gt") {
          whereObj[f.field] = dbCmd.gt(v);
        } else if (f.op === "gte") {
          whereObj[f.field] = dbCmd.gte(v);
        } else if (f.op === "lt") {
          whereObj[f.field] = dbCmd.lt(v);
        } else if (f.op === "lte") {
          whereObj[f.field] = dbCmd.lte(v);
        } else if (f.op === "in") {
          // CloudBase exposes `dbCmd.in(values)` for the same role
          // Postgres' `IN (…)` plays. Empty arrays would match
          // nothing — short-circuit the whole query rather than
          // hand CloudBase an empty list (which some SDK builds
          // treat as "match all").
          const arr = Array.isArray(v) ? v : [v];
          if (arr.length === 0) {
            return ok<T[]>([]);
          }
          whereObj[f.field] = dbCmd.in(arr);
        }
      }

      let q: ICollection = db.collection(this.collection);
      if (Object.keys(whereObj).length > 0) {
        q = q.where(whereObj);
      }

      if (this.mode === "update") {
        await q.update(this.payload as Record<string, unknown>);
        // If the caller chained `.update().eq(...).select().single()` we need
        // to fetch the updated row and return it, otherwise wantSingle gets
        // an empty array and downstream code thinks the row vanished.
        if (this.wantSingle) {
          try {
            const after = await db
              .collection(this.collection)
              .where(whereObj)
              .limit(1)
              .get();
            const docs = (after?.data || []).map((d: Record<string, unknown>) =>
              normalize(d),
            );
            return ok(docs[0] ?? null);
          } catch {
            return ok(null);
          }
        }
        return ok([]);
      }

      if (this.mode === "delete") {
        // Two-step delete for single-id filters:
        // 1. Try where({ id: val }) — works when the doc has an explicit `id` field.
        // 2. If deleted=0, fall back to where({ _id: val }) — works when CloudBase's
        //    auto-generated `_id` was surfaced as `id` by normalize() and there is
        //    no separate `id` field in the stored document.
        // This covers both document shapes without requiring callers to know which
        // variant they're dealing with.
        const idFilters = this.filters.filter((f) => f.field === "id" && f.op === "eq");
        if (idFilters.length === 1 && this.filters.length === 1) {
          const val = idFilters[0].value as string;
          let res = await db.collection(this.collection).where({ id: val }).remove();
          let deleted: number = res?.deleted ?? (res as { result?: { deleted?: number } }).result?.deleted ?? -1;
          if (deleted === 0 || deleted === -1) {
            // Fallback: target CloudBase primary key directly.
            res = await db.collection(this.collection).where({ _id: val }).remove();
            deleted = res?.deleted ?? (res as { result?: { deleted?: number } }).result?.deleted ?? -1;
          }
          
          if (deleted === 0 || deleted === -1) {
            // Final fallback: cloud function bypasses CloudBase security rules.
            // Required when the collection's delete rule blocks client-side ops
            // (e.g. "doc._openid == auth.openid" with a mismatched session).
            try {
              const appWithCallFn = app as { callFunction?: <R>(options: { name: string; data?: Record<string, unknown> }) => Promise<R> };
              if (appWithCallFn && typeof appWithCallFn.callFunction === "function") {
                const fnRes = await appWithCallFn.callFunction({
                  name: "delete-listing",
                  data: { collection: this.collection, docId: val, force: true },
                });
                const inner = (fnRes as { result?: { ok?: boolean; error?: string } } | null) as { result?: { ok?: boolean; error?: string } } | null;
                if (inner?.result?.ok) {
                  console.log(`[cb-shim] delete-listing CF: ok for ${this.collection} id=${val}`);
                  return ok<T[]>([]);
                }
                return err(`删除失败（云函数）：${inner?.result?.error ?? "未知错误"}`);
              }
            } catch (cfErr) {
              const msg = cfErr instanceof Error ? cfErr.message : String(cfErr);
              return err(`删除失败（云函数异常）：${msg}`);
            }
            return err(`删除失败：未匹配到记录（id=${val}，deleted=0）`);
          }
          console.log(`[cb-shim] delete ${this.collection} id=${val} → deleted=${deleted}`);
          return ok<T[]>([]);
        }
        const res = await q.remove();
        const deleted: number = res?.deleted ?? (res as { result?: { deleted?: number } }).result?.deleted ?? -1;
        
        console.log(`[cb-shim] where().remove() on ${this.collection} → deleted=${deleted}`, res);
        if (deleted === 0) {
          return err(`删除失败：未匹配到记录（deleted=0）`);
        }
        return ok<T[]>([]);
      }

      // select
      if (this.orderField) {
        q = q.orderBy(this.orderField, this.orderDirection);
      }
      if (this.limitCount) {
        q = q.limit(this.limitCount);
      }
      const res = await q.get();
      const docs = (res.data || []).map((d: Record<string, unknown>) =>
        normalize(d),
      );
      if (this.wantSingle) {
        return ok(docs[0] ?? null);
      }
      return ok(docs);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(message);
    }
  }
}

// ============================================================
// Realtime channel adapter
// ============================================================

/** Callback for realtime document change events */
type RealtimeCallback = (payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}) => void;

/** Configuration for postgres_changes subscription */
type PostgresChangesConfig = {
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema?: string;
  table: string;
  filter?: string;
};

/** Configuration for presence subscription */
type PresenceConfig = { event?: "sync" | "join" | "leave" };
type PresenceCallback = () => void;

/** Listener unsubscribe function returned by CloudBase watch() */
interface CloudBaseListener {
  close(): void;
}

class RealtimeChannel {
  private listener: CloudBaseListener | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // Exponential backoff for the heartbeat. When the network drops we
  // don't want to keep firing the failed update every 12s — that just
  // floods the console and burns request quota. After each failure we
  // skip the next N beats; on the first success the counter resets.
  // Sequence: 0 (first fail) → skip 1 → skip 2 → skip 4 → cap at 8
  // beats (~96s of cooldown), which lines up with how long a typical
  // wi-fi reconnect takes.
  private heartbeatFailures = 0;
  private heartbeatSkipRemaining = 0;
  // Poll fallback timer — runs alongside `watch()` so the UI keeps moving
  // even when CloudBase realtime drops (we've seen "initWatch success"
  // get retried dozens of times without ever delivering an event). Both
  // sources feed the same callbacks; the consumers de-dup by row id, so
  // duplicate paths are harmless.
  // We use a self-rescheduling setTimeout so the interval can adapt to
  // visibility / focus state on every cycle.
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollFn: (() => Promise<void>) | null = null;
  // External listeners we register on window — kept here so unsubscribe()
  // can detach them.
  private windowListeners: { type: string; handler: EventListenerOrEventListenerObject }[] = [];
  // For postgres_changes table polling: ids we've already emitted as
  // INSERT, so we don't re-emit them on every poll cycle.
  private knownTableIds: Set<string> = new Set();
  // True after the initial select() has completed. Prior rows are
  // considered "history" — we don't fake INSERT events for them.
  private tablePollSeeded = false;
  private _presenceState: Record<string, Record<string, unknown>[]> = {};
  private presenceKey?: string;
  private presenceCallbacks: { event: string; cb: PresenceCallback }[] = [];
  // The CloudBase auto-assigned _id of the presence row we wrote on
  // track(). Used by the heartbeat / unsubscribe to update / delete the
  // exact same doc, instead of re-querying by a custom field which might
  // never match (older rows may not have the same `id` shape).
  private presenceDocId: string | null = null;
  // The last state we tracked — used by the heartbeat to re-add a row
  // if it disappeared (e.g. another tab cleaned it as stale).
  private lastTrackState: Record<string, unknown> | null = null;
  // True once unsubscribe() has run. Every async branch (subscribe init,
  // track, heartbeat, poll) checks this before doing work so a teardown
  // can't leak zombie rows / timers / DB writes after the channel is gone.
  private disposed = false;
  /** All postgres_changes handlers registered on this channel. Supabase
   *  channels routinely register one .on(INSERT) AND one .on(UPDATE) on
   *  the same table; the original single-slot design silently dropped the
   *  first call when the second one arrived (root cause of '消息不实时'). */
  private pgHandlers: { config: PostgresChangesConfig; cb: RealtimeCallback }[] = [];

  constructor(
    public name: string,
    private opts?: { config?: { presence?: { key?: string } } },
  ) {
    this.presenceKey = opts?.config?.presence?.key;
  }

  on(type: "postgres_changes", config: PostgresChangesConfig, cb: RealtimeCallback): RealtimeChannel;
  on(type: "presence", config: PresenceConfig, cb: PresenceCallback): RealtimeChannel;
  on(type: string, config: PostgresChangesConfig | PresenceConfig, cb: RealtimeCallback | PresenceCallback): RealtimeChannel {
    if (type === "postgres_changes") {
      this.pgHandlers.push({
        config: config as PostgresChangesConfig,
        cb: cb as RealtimeCallback,
      });
    } else if (type === "presence") {
      this.presenceCallbacks.push({
        event: (config as PresenceConfig).event || "sync",
        cb: cb as PresenceCallback,
      });
    }
    return this;
  }

  /**
   * Pre-seed the known-IDs set from the caller's own initial history load.
   * Normally the first poll cycle (800 ms after subscribe) seeds the set,
   * meaning any message that arrives in that window is silently skipped.
   * Calling seedIds() right after the history fetch eliminates that gap:
   * the first poll immediately looks for *new* rows instead of wasting a
   * seeding cycle.
   */
  seedIds(ids: string[]): this {
    if (this.disposed) return this;
    for (const id of ids) this.knownTableIds.add(id);
    if (ids.length > 0) this.tablePollSeeded = true;
    return this;
  }

  subscribe(
    statusCallback?: (status: string) => void | Promise<void>,
  ): RealtimeChannel {
    // Run async setup in the background, but return `this` synchronously
    // so callers can stash it and call removeChannel() immediately, matching
    // the Supabase SDK shape.
    void (async () => {
      // Auth is critical — if it fails, nothing else can work.
      try {
        await ensureAuthForRealtime();
      } catch (e) {
         
        console.warn("[cb-rt] auth init failed:", e);
        if (statusCallback && !this.disposed)
          await statusCallback("CHANNEL_ERROR");
        return;
      }
      if (this.disposed) return;

      // Each subsystem (watch + presence-watch) is wrapped independently
      // so a failure in one doesn't block the other. The ALL-IMPORTANT
      // statusCallback("SUBSCRIBED") must fire so the caller's `track()`
      // (in usePresence) actually runs and the user appears online —
      // even if our optional realtime watch is broken upstream.
      if (this.pgHandlers.length > 0) {
        try {
          this.startTableWatch();
        } catch (e) {
           
          console.warn("[cb-rt] startTableWatch threw:", e);
        }
      }
      if (this.disposed) return;

      if (this.presenceKey) {
        try {
          await this.startPresenceWatch();
        } catch (e) {
           
          console.warn("[cb-rt] startPresenceWatch threw:", e);
        }
      }
      if (this.disposed) return;

      if (statusCallback) {
        try {
          await statusCallback("SUBSCRIBED");
        } catch (e) {
           
          console.warn("[cb-rt] statusCallback threw:", e);
        }
      }
    })();
    return this;
  }

  private startTableWatch() {
    if (this.pgHandlers.length === 0) return;
    // All handlers on a single channel must target the same table — that's
    // how Supabase channels work in practice (one channel per table). We
    // build the where clause from the FIRST handler's filter; mismatched
    // filters across handlers on the same channel are not supported and
    // would have been broken under the old single-slot design too.
    const cfg = this.pgHandlers[0].config;

    let whereObj: Record<string, unknown> | undefined;
    if (cfg.filter) {
      const f = parseFilter(cfg.filter);
      if (f && f.op === "eq") {
        whereObj = { [f.field]: f.value };
      }
    }

    let q: ICollection = db.collection(cfg.table);
    if (whereObj) q = q.where(whereObj);

    let watchEmitCount = 0;
    this.listener = q.watch({
      onChange: (snapshot: { docChanges?: Array<{ dataType?: string; doc?: Record<string, unknown> }> }) => {
        const changes = snapshot.docChanges || [];
        // One-time visibility into what CloudBase actually delivers. If we
        // only ever see "init" / "limit" we know the WS path is silent and
        // the poll is doing all the work (=> realtime feel limited by poll
        // cadence). Logged ONCE per channel to avoid spam.
        if (watchEmitCount === 0 && changes.length > 0) {
          console.log(
            `[cb-rt watch] ${cfg.table} first snapshot — types:`,
            changes.map((c) => c.dataType).join(","),
          );
        }
        for (const change of changes) {
          // 'init' fires once with full state; we usually load via select() so skip it.
          if (change.dataType === "init" || change.dataType === "limit") continue;
          let eventType: "INSERT" | "UPDATE" | "DELETE";
          if (change.dataType === "add") eventType = "INSERT";
          else if (change.dataType === "update") eventType = "UPDATE";
          else if (change.dataType === "remove") eventType = "DELETE";
          else continue;
          const newDoc = change.doc ? normalize(change.doc) : null;
          // Track ids the watch has already emitted so the poll fallback
          // doesn't double-fire on the same row.
          if (newDoc && (newDoc as { id?: string }).id) {
            this.knownTableIds.add((newDoc as { id: string }).id);
          }
          // Dispatch to every handler whose event filter matches.
          let dispatched = false;
          for (const h of this.pgHandlers) {
            if (h.config.event && h.config.event !== "*" && h.config.event !== eventType) continue;
            h.cb({ eventType, new: newDoc, old: newDoc });
            dispatched = true;
          }
          if (dispatched) {
            watchEmitCount++;
            console.log(
              `[cb-rt watch] ${cfg.table} ${eventType} #${watchEmitCount}`,
              (newDoc as { id?: string } | null)?.id,
            );
          }
        }
      },
      onError: (e: { message?: string }) => {
        // CloudBase SDK sometimes emits a SYS_ERR on brand-new / empty
        // collections that self-heals a moment later. Log as warn to avoid
        // scaring users but keep visibility for debugging.
        const msg = e?.message || String(e);
        if (msg.includes("Cannot read property 'code' of undefined")) {
          console.warn(
            `[cb-rt] ${cfg.table}: SDK init hiccup (safe to ignore; falling back to poll)`,
          );
          return;
        }
        console.warn(`[cb-rt] watch error on ${cfg.table}:`, e);
      },
    });

    // Poll fallback — adaptive cadence (1s focused / 3s blurred / 15s
    // hidden) so the UI feels real-time when the user is looking but we
    // don't burn API calls when they're not. CloudBase's realtime watch
    // is unreliable in production (see logs: "initWatch success" repeats
    // dozens of times without ever delivering an event), so this poll
    // guarantees the UI catches up even when the WS subscription is
    // silently broken.
    //
    // IMPORTANT: we build a fresh query object here instead of reusing
    // `q`. After `.watch()` is invoked on `q`, the SDK may hold internal
    // state on that object; calling `.limit().get()` on the same instance
    // can silently return stale / empty results. A fresh query also lets
    // us add `.orderBy('created_at','desc')` so we always see the NEWEST
    // rows first — without ordering, CloudBase returns some internal order
    // and channels with >50 historical messages never surface new rows.
    let firstPollLogged = false;
    const pollOnce = async () => {
      try {
        let pollQ: ICollection = db.collection(cfg.table);
        if (whereObj) pollQ = pollQ.where(whereObj);
        // Try ordered query first. If CloudBase rejects orderBy on this
        // collection (missing index, etc.) fall back to unordered which
        // at least returns SOME docs — better than zero events forever.
        let res: { data?: Record<string, unknown>[] } | undefined;
        try {
          res = await pollQ.orderBy("created_at", "desc").limit(20).get();
        } catch (orderErr) {
          if (!firstPollLogged) {
            console.warn(
              `[cb-rt] ${cfg.table}: orderBy(created_at) failed, retrying without order`,
              orderErr,
            );
          }
          let bareQ: ICollection = db.collection(cfg.table);
          if (whereObj) bareQ = bareQ.where(whereObj);
          res = await bareQ.limit(50).get();
        }
        const docs: Record<string, unknown>[] = res?.data || [];
        if (!firstPollLogged) {
          firstPollLogged = true;
           
          console.log(
            `[cb-rt] ${cfg.table} poll alive — ${docs.length} doc(s), seeded=${this.tablePollSeeded}, known=${this.knownTableIds.size}`,
          );
        }
        if (!this.tablePollSeeded) {
          for (const d of docs) {
            const id = (d.id as string) || (d._id as string);
            if (id) this.knownTableIds.add(id);
          }
          this.tablePollSeeded = true;
          return;
        }
        let emitted = 0;
        const pollIds = new Set<string>();
        for (const d of docs) {
          const id = (d.id as string) || (d._id as string);
          if (!id) continue;
          pollIds.add(id);
          if (this.knownTableIds.has(id)) continue;
          this.knownTableIds.add(id);
          const newDoc = normalize(d);
          // Dispatch to every handler that wants INSERTs.
          for (const h of this.pgHandlers) {
            if (h.config.event && h.config.event !== "*" && h.config.event !== "INSERT") continue;
            h.cb({ eventType: "INSERT", new: newDoc, old: newDoc });
            emitted++;
          }
        }
        if (emitted > 0) {
           
          console.log(`[cb-rt] ${cfg.table} poll: emitted ${emitted} new INSERT(s)`);
        }
        // DELETE detection: only when poll returned fewer docs than the limit
        // (means we have the complete set — any knownId absent is truly deleted).
        // Skipped when docs.length === limit to avoid false DELETEs due to truncation.
        if (docs.length < 50) {
          const toDelete: string[] = [];
          for (const knownId of this.knownTableIds) {
            if (!pollIds.has(knownId)) toDelete.push(knownId);
          }
          for (const deletedId of toDelete) {
            this.knownTableIds.delete(deletedId);
            const ghost = { id: deletedId } as unknown as Record<string, unknown>;
            for (const h of this.pgHandlers) {
              if (h.config.event && h.config.event !== "*" && h.config.event !== "DELETE") continue;
              h.cb({ eventType: "DELETE", new: ghost, old: ghost });
            }
          }
          if (toDelete.length > 0) {
             
            console.log(`[cb-rt] ${cfg.table} poll: emitted ${toDelete.length} DELETE(s)`);
          }
        }
      } catch (e) {
         
        console.warn(`[cb-rt] ${cfg.table}: poll fallback failed`, e);
      }
    };
    this.startAdaptivePoll(pollOnce);
  }

  // -- Presence (heartbeat-based) -------------------------------

  private async startPresenceWatch() {
    // Watch the `presence` collection scoped to this channel.
    const q: ICollection = db.collection("presence").where({ room: this.name });

    const refreshState = (docs: Record<string, unknown>[]) => {
      const now = Date.now();
      const state: Record<string, Record<string, unknown>[]> = {};
      for (const d of docs) {
        const expiresAt = (d.expires_at as number) || 0;
        if (expiresAt && expiresAt < now) continue;
        const key = (d.presence_key as string) || (d.id as string);
        if (!state[key]) state[key] = [];
        state[key].push(normalize(d));
      }
      this._presenceState = state;
      for (const { event, cb } of this.presenceCallbacks) {
        if (event === "sync") cb();
      }
    };

    // Initial load — fire-and-forget so this never blocks
    // statusCallback("SUBSCRIBED"). The adaptive poll below is the
    // real steady-state source; this is just a fast-path pre-seed.
    // Awaiting it was the root cause of "用户在线卡住": if CloudBase
    // hung here, SUBSCRIBED never fired, the optimistic self-inject
    // never ran, and the poll never started.
    q.limit(500).get()
      .then((initial: { data?: Record<string, unknown>[] }) => {
        if (!this.disposed) refreshState(initial.data || []);
      })
      .catch((e: unknown) => {
        console.warn("[cb-rt] presence initial load failed:", e);
      });

    // Live updates.
    this.listener = q.watch({
      onChange: async (snapshot: { docs?: Record<string, unknown>[] }) => {
        refreshState(snapshot.docs || []);
      },
      onError: (e: Error) => {
        console.warn("[cb-rt] presence watch error:", e);
      },
    });

    // Poll fallback — adaptive cadence (1s focused / 3s blurred / 15s
    // hidden). Watch is unreliable in production (auto-reconnects without
    // delivering events), so we always poll. refreshState() filters
    // expired entries by `expires_at` so stale rows naturally drop off.
    const presencePoll = async () => {
      try {
        // IMPORTANT: build a FRESH query — do NOT reuse `q` after
        // .watch() has been called on it. The SDK holds internal watch
        // state on that object; calling .limit().get() on the same
        // instance can silently hang, which freezes the tick loop and
        // stops all future presence polls. (Same pattern as pollOnce in
        // startTableWatch().) This was the confirmed root cause of
        // "用户在线还是卡住的".
        const freshQ: ICollection = db.collection("presence").where({ room: this.name });
        const res = await freshQ.limit(500).get();
        const docs = res?.data || [];
        // Log when poll returns suspiciously few results (could indicate
        // a security-rule misconfiguration that silently limits reads).
        if (docs.length === 0 && !this.disposed) {
          // eslint-disable-next-line no-console
          console.debug("[cb-rt] presence poll: 0 docs — check CloudBase security rules for the `presence` collection (read should be `true`)");
        }
        refreshState(docs);
      } catch (e) {
        console.warn("[cb-rt] presence poll FAILED (check security rules):", e);
      }
    };
    this.startAdaptivePoll(presencePoll);
    // NOTE: a `presence_pings` broadcast notification layer was
    // briefly attempted here (additional `q.watch()` on a sibling
    // collection that fired `presencePoll()` whenever any client
    // wrote a state-change ping). It interacted badly with
    // CloudBase's watch — possibly an infinite re-emit loop on the
    // writer's own snapshot — and froze the UI for the user. The
    // simpler 500 ms poll cadence (plus the existing presence watch)
    // is sufficient and has been restored. If we want sub-200ms
    // latency later we should investigate a true WebSocket broadcast
    // channel, not a DB-row notification scheme.
  }

  /**
   * Schedule `fn` to run at an interval that adapts to the page's
   * visibility / focus state:
   *   - tab hidden            → 15s (background, save quota)
   *   - tab visible, blurred  → 3s  (user is on another window)
   *   - tab visible + focused → 1s  (active conversation)
   *
   * Also re-fires immediately when the user comes back to the tab so the
   * UI feels instant on focus.
   */
  private startAdaptivePoll(fn: () => Promise<void>) {
    if (typeof window === "undefined") return;
    this.pollFn = fn;

    const computeInterval = (): number => {
      if (typeof document === "undefined") return 3_000;
      // Hidden tab — save API quota aggressively, the user isn't
      // watching anyway. Heartbeat TTL (45s) is sized to survive.
      if (document.visibilityState === "hidden") return 15_000;
      // Visible-but-blurred — 800ms. Keeps a second window/tab from
      // adding significant DB load while still feeling live if the
      // user glances at it.
      if (document.hasFocus && !document.hasFocus()) return 800;
      // Foreground active — 300ms. Combined with the zero-debounce
      // server/voice transition track(), this keeps enter/exit
      // visibility at ~500-700ms end-to-end (write latency + one poll).
      // API cost: ~3 req/s per focused tab, acceptable for a chat app.
      return 300;
    };

    const tick = async () => {
      if (!this.pollFn) return;
      try {
        // Hard-cap each poll tick at 10s. A hung CloudBase request
        // must not block the setTimeout at the end of tick() — if it
        // does, all subsequent polls silently stop (the timer is never
        // re-armed). This guard ensures the loop always advances.
        const pollTimeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("poll tick timed out (10s)")), 10_000),
        );
        await Promise.race([this.pollFn(), pollTimeout]);
      } catch {
        /* swallow — fn already logs its own errors */
      }
      // pollFn may have been cleared (channel unsubscribed) during await.
      if (!this.pollFn) return;
      this.pollTimer = setTimeout(tick, computeInterval());
    };
    // Initial tick after a short delay so the channel's other init
    // (initial select / heartbeat) has time to run, but not so long
    // that a newly-subscribed observer has to wait a full poll cycle
    // before seeing any presence data.
    this.pollTimer = setTimeout(tick, 80);

    // When the user comes back to the tab, fire immediately so they don't
    // have to wait for the next scheduled tick.
    const refire = () => {
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollTimer = setTimeout(tick, 0);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refire();
    };
    const onFocus = () => refire();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    this.windowListeners.push({ type: "focus", handler: onFocus });
    this.windowListeners.push({
      type: "visibilitychange",
      handler: onVisibility,
    });
  }

  /**
   * Fire-and-forget broadcast: write a tiny row into `presence_pings`
   * so other clients listening on the same room get realtime
   * notification of "something interesting changed in `presence`,
   * refresh now". Also opportunistically deletes our own old pings
   * (>60s) to keep the collection from growing unbounded — we only
   * GC our own rows so concurrent writers don't fight over deletes.
   *
   * Intentionally NOT awaited by `track()` so a slow ping write
   * never blocks the user-visible "I'm online now" path.
   */
  private fireBroadcastPing(): void {
    if (this.disposed || !this.presenceKey) return;
    const ts = Date.now();
    const row = {
      room: this.name,
      presence_key: this.presenceKey,
      ts,
    };
    db.collection("presence_pings")
      .add(row)
      .catch((e: unknown) => {
        // Collection might not exist yet (CloudBase auto-creates on
        // first write). If even the add() fails we just fall back to
        // poll cadence — non-fatal.
        // eslint-disable-next-line no-console
        console.debug("[cb-rt] presence_ping write failed:", e);
      });
    // Best-effort GC of our own old pings. Throttled so we only do
    // it once every ~30s per channel instance — otherwise every
    // status flip triggers another sweep.
    const last = (this as unknown as { _lastPingGc?: number })
      ._lastPingGc ?? 0;
    if (ts - last < 30_000) return;
    (this as unknown as { _lastPingGc?: number })._lastPingGc = ts;
    db.collection("presence_pings")
      .where({
        room: this.name,
        presence_key: this.presenceKey,
        ts: dbCmd.lt(ts - 60_000),
      })
      .limit(50)
      .get()
      .then(async (res: { data?: Record<string, unknown>[] }) => {
        for (const d of res?.data || []) {
          const id = (d._id as string) || (d.id as string);
          if (!id) continue;
          await db.collection("presence_pings").doc(id).remove().catch(() => {});
        }
      })
      .catch(() => {});
  }

  /** Update / insert this client's presence state. */
  async track(
    state: Record<string, unknown>,
    /** Override TTL for this beat. Used by the visibilitychange→hidden
     *  path to refresh with a long expiry that survives background
     *  setInterval throttling (Chrome/Edge cap hidden tabs to ~1 tick
     *  per minute, sometimes longer). Defaults to 45s for foreground. */
    ttlMs: number = 45_000,
  ): Promise<void> {
    if (this.disposed || !this.presenceKey) return;
    this.lastTrackState = state;
    const now = Date.now();
    // The default 45s TTL survives one 30s-clamped cycle and the
    // pagehide listener proactively deletes the row on tab close.
    // For hidden tabs, callers pass a longer TTL so the user doesn't
    // false-disappear from the online list while their browser is
    // backgrounded (per user report: "挂机几分钟切到后台就消失").
    const expires = now + ttlMs;

    const baseDoc = {
      // Keep the legacy custom `id` field for backwards compat; we no
      // longer rely on it for read-back, but old rows may use it and
      // some debug tooling references it.
      id: `${this.name}__${this.presenceKey}`,
      room: this.name,
      presence_key: this.presenceKey,
      ...state,
      online_at: now,
      expires_at: expires,
    };

    // Strategy: on FIRST track() in this channel's lifetime, sweep our
    // EXPIRED rows for this room only. We deliberately do NOT touch our
    // own alive rows because the same user might have multiple sibling
    // channels in the same page (e.g. page.tsx top-level + MemberList
    // + DmSidebar all subscribing to presence:${room}); deleting their
    // alive rows would cause a ping-pong: their heartbeats would get
    // updated:0, self-heal by re-adding rows, the new sibling's cleanup
    // would delete those, and so on forever, leaving the room in a
    // perpetual race with hundreds of expired rows piling up.
    try {
      if (!this.presenceDocId) {
        // PARALLELISE the stale-row sweep and the fresh add(). The
        // sweep is best-effort GC and doesn't have to finish before
        // our row exists — the only thing add() needs is `baseDoc`,
        // which is already constructed. Doing them sequentially was
        // adding ~1 network round-trip (~200-600ms) to the user-
        // visible online lag on every fresh login, which together
        // with poll cadence produced the "上线后要5秒才刷新到用户
        // 列表" complaint. The sweep result is discarded the moment
        // it lands — we don't need to wait on it.
        const sweepPromise = (async () => {
          try {
            const stale = await db
              .collection("presence")
              .where({ room: this.name })
              .limit(500)
              .get();
            if (this.disposed) return;
            const mine: Record<string, unknown>[] = (
              stale?.data || []
            ).filter((d: Record<string, unknown>) => {
              if ((d.presence_key as string) !== this.presenceKey)
                return false;
              const exp = (d.expires_at as number) || 0;
              // Only delete rows whose TTL clearly elapsed (10s
              // grace), so concurrent sibling channels' alive rows
              // stay safe.
              return exp < now - 10_000;
            });
            for (const d of mine) {
              const id = (d._id as string) || (d.id as string);
              if (!id) continue;
              try {
                await db.collection("presence").doc(id).remove();
              } catch {
                /* not ours, skip */
              }
            }
          } catch {
            /* cleanup is best-effort, ignore */
          }
        })();
        // Don't await sweepPromise — let add() race ahead. We still
        // bind a noop catch so an unhandled rejection doesn't blow
        // the console; functional correctness doesn't depend on it.
        sweepPromise.catch(() => {});

        if (this.disposed) return;

        // Create a fresh row and remember its _id.
        const added = await db.collection("presence").add(baseDoc);
        if (this.disposed) {
          // Channel was torn down while we were writing. Roll back so the
          // row doesn't sit there until TTL expiry.
          const id =
            (added?._id as string) || (added?.id as string) || null;
          if (id) {
            db.collection("presence")
              .doc(id)
              .remove()
              .catch(() => {});
          }
          return;
        }
        this.presenceDocId =
          (added?._id as string) || (added?.id as string) || null;
        // Broadcast: tell every other client in this room that
        // (presence_pings broadcast was disabled — see
        // startPresenceWatch comment for why. Other clients pick
        // this row up via the 500ms presence poll instead.)
      } else {
        // Update the row we wrote earlier in this session.
        await db
          .collection("presence")
          .doc(this.presenceDocId)
          .update({
            ...state,
            online_at: now,
            expires_at: expires,
          });
        // (presence_pings broadcast disabled — see comment above.)
      }
    } catch (e) {
       
      console.warn("[cb-rt] presence track failed:", e);
    }

    // Heartbeat to keep alive — uses the cached _id so it never has to
    // re-query and never accidentally updates a sibling/stale row.
    //
    // TTL is 90s and we beat every 12s on the foreground tab. Background
    // tabs get throttled by the browser (Chrome / Edge / Firefox all
    // clamp setInterval to 1 Hz or even 1/min for hidden tabs), so the
    // 90s TTL is sized to survive ONE missed minute-long throttle cycle
    // without falsely flipping the user offline.
    //
    // We also wire focus / visibilitychange listeners below to fire an
    // immediate beat the moment the tab regains attention, so users who
    // come back after a few minutes don't have to wait up to 12s before
    // their row's expires_at is bumped.
    // Keep these in sync with the initial TTL set in `track()` above.
    // 45s TTL / 12s heartbeat = 3 heartbeats fit inside the window.
    const TTL_MS = 45_000;
    const BEAT_MS = 12_000;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const beat = async () => {
      if (this.disposed) return;
      // Apply backoff: while skipRemaining > 0, decrement and bail.
      // This caps post-failure write attempts at ~once per 24/48/96s
      // instead of once per 12s, so a flaky network or wi-fi handoff
      // doesn't pin one CPU core writing failed updates.
      if (this.heartbeatSkipRemaining > 0) {
        this.heartbeatSkipRemaining -= 1;
        return;
      }
      // Snapshot the docId BEFORE the await — otherwise a concurrent
      // unsubscribe() / track() could null this.presenceDocId mid-flight
      // and we'd log "row null no longer exists" (the noisy warning that
      // appeared in production logs).
      const docId = this.presenceDocId;
      if (!docId) return;
      const t = Date.now();
      try {
        const res = await db
          .collection("presence")
          .doc(docId)
          .update({ online_at: t, expires_at: t + TTL_MS });
        if (this.disposed) return;
        // Success — clear backoff so we resume normal cadence.
        this.heartbeatFailures = 0;
        this.heartbeatSkipRemaining = 0;
        const updated =
          (res?.updated as number) ??
          (res?.stats?.updated as number) ??
          undefined;
        if (updated === 0) {
          // Row got cleaned up out from under us (another tab, or expired
          // GC). Re-create on next track call by clearing the cache —
          // but only if nothing else has replaced it while we were
          // awaiting (otherwise we'd stomp the new docId).
           
          console.warn(
            `[cb-rt] heartbeat: row ${docId} no longer exists, will re-add`,
          );
          if (this.presenceDocId === docId) this.presenceDocId = null;
          if (this.lastTrackState) await this.track(this.lastTrackState);
        }
      } catch (e) {
        // Network down / CloudBase rate-limited / temporary blip.
        // Bump failure counter and schedule a longer skip before the
        // next attempt. Cap at 8 skips (~96s) to avoid pathological
        // multi-minute outages where we'd never recover.
        this.heartbeatFailures = Math.min(this.heartbeatFailures + 1, 4);
        this.heartbeatSkipRemaining = Math.min(
          1 << (this.heartbeatFailures - 1),
          8,
        );
         
        console.warn(
          `[cb-rt] presence heartbeat failed (skipping next ${this.heartbeatSkipRemaining} beat(s)):`,
          e,
        );
      }
    };
    this.heartbeatTimer = setInterval(beat, BEAT_MS);

    // Also beat immediately when the tab regains focus / becomes visible,
    // so users who left their browser in the background for a while get
    // their `expires_at` refreshed within ~100ms of returning instead of
    // up to 12s later. We register these via this.windowListeners so
    // unsubscribe() tears them down with everything else.
    if (typeof window !== "undefined") {
      const refire = () => {
        // User just gave the tab attention — clear backoff so the beat
        // actually fires this tick, regardless of any prior failures.
        this.heartbeatSkipRemaining = 0;
        void beat();
      };
      // Long-TTL refresh used right before the tab goes background.
      // 10 minutes is plenty to survive Chrome/Edge's most aggressive
      // hidden-tab throttling (which can pause setInterval entirely
      // after ~5 min). When the user comes back, the visibilitychange
      // → visible branch immediately fires a normal beat which resets
      // expires_at to the standard 45s window.
      const HIDDEN_TTL_MS = 10 * 60_000;
      const beatHidden = async () => {
        if (this.disposed) return;
        if (!this.presenceDocId || !this.lastTrackState) return;
        try {
          await this.track(this.lastTrackState, HIDDEN_TTL_MS);
        } catch {
          /* best-effort: tab is going to sleep anyway */
        }
      };
      const onFocus = () => refire();
      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          // Tab regained focus — regular short-TTL beat, brings the
          // row back into the standard heartbeat cadence.
          refire();
        } else {
          // Tab going hidden — write a long-TTL row so background
          // throttling can't strand us as "expired".
          void beatHidden();
        }
      };
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
      this.windowListeners.push({ type: "focus", handler: onFocus });
      this.windowListeners.push({
        type: "visibilitychange",
        handler: onVisibility,
      });

      // Proactive cleanup on tab-close. React's effect cleanups don't run
      // when the browser tab is killed (user closed the window / navigated
      // away hard / device slept), so the presence row would otherwise sit
      // there until TTL expiry (45s). We listen to `pagehide` — the one
      // event browsers fire reliably on every type of tab-teardown — and
      // fire a fire-and-forget DELETE. The async call isn't guaranteed to
      // complete (browser may kill the page before the request flushes),
      // but in practice it succeeds most of the time because it's queued
      // on the same event loop as pagehide itself. The TTL is our fallback
      // when it doesn't.
      const onPagehide = (e: Event) => {
        // `event.persisted` is true when the page is entering the bfcache
        // (back/forward cache) and may be restored later. In that case we
        // want to keep the row so the user doesn't briefly appear offline
        // while they're actually paused; the TTL will handle eventual
        // cleanup if they never come back.
        const pageEvent = e as PageTransitionEvent;
        if (pageEvent.persisted) return;
        const id = this.presenceDocId;
        const key = this.presenceKey;
        if (!id) return;
        this.presenceDocId = null;

        // Preferred path: navigator.sendBeacon to a dedicated cloud
        // function HTTP trigger. Browsers GUARANTEE the request is
        // flushed even on tab teardown, which is the one thing the
        // SDK's regular fetch can't promise. Configure the URL via
        // `NEXT_PUBLIC_DELETE_PRESENCE_URL` (see cloud-functions/
        // delete-presence/index.js for setup). If that's not set, we
        // fall back to the SDK's best-effort async delete.
        const beaconUrl =
          (typeof process !== "undefined" &&
            process.env &&
            process.env.NEXT_PUBLIC_DELETE_PRESENCE_URL) ||
          "";
        let beaconSent = false;
        if (beaconUrl && key && typeof navigator !== "undefined" && navigator.sendBeacon) {
          try {
            const blob = new Blob(
              [JSON.stringify({ docId: id, presenceKey: key })],
              { type: "application/json" },
            );
            beaconSent = navigator.sendBeacon(beaconUrl, blob);
          } catch {
            beaconSent = false;
          }
        }

        if (beaconSent) return;
        // Fallback: regular async delete. May or may not actually fire.
        try {
          db.collection("presence")
            .doc(id)
            .remove()
            .catch(() => {
              /* best-effort; tab is gone */
            });
        } catch {
          /* ignore */
        }
      };
      window.addEventListener("pagehide", onPagehide);
      this.windowListeners.push({ type: "pagehide", handler: onPagehide });
    }
  }

  presenceState<T = Record<string, unknown>>(): Record<string, T[]> {
    return this._presenceState as Record<string, T[]>;
  }

  unsubscribe() {
    // Mark disposed FIRST so any in-flight async work (subscribe init,
    // track, heartbeat, poll) bails out before mutating state or the DB.
    this.disposed = true;
    if (this.listener && typeof this.listener.close === "function") {
      try {
        this.listener.close();
      } catch {
        // ignore
      }
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // Stop the adaptive poll: clear the pending timer AND null out the
    // function so any in-flight `tick()` await doesn't reschedule.
    this.pollFn = null;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Detach window listeners we registered for focus-driven refresh.
    if (typeof window !== "undefined") {
      for (const l of this.windowListeners) {
        if (l.type === "visibilitychange") {
          document.removeEventListener(l.type, l.handler);
        } else {
          window.removeEventListener(l.type, l.handler);
        }
      }
    }
    this.windowListeners = [];
    // Best-effort cleanup of our presence row using the stored _id.
    if (this.presenceDocId) {
      const id = this.presenceDocId;
      this.presenceDocId = null;
      db.collection("presence")
        .doc(id)
        .remove()
        .catch(() => {
          /* ignore */
        });
    }
  }
}

// ============================================================
// Public Supabase-shaped client
// ============================================================

export const supabase = {
  auth,
  from<T extends Record<string, unknown> = Record<string, unknown>>(table: string) {
    return new TableQuery<T>(table);
  },
  channel(name: string, opts?: { config?: { presence?: { key?: string } } }) {
    return new RealtimeChannel(name, opts);
  },
  removeChannel(ch: RealtimeChannel) {
    ch.unsubscribe();
  },
};

// ============================================================
// Re-export DB types for backward compatibility
// ============================================================
export type {
  DbServer,
  DbChannel,
  DbServerMember,
  DbMessage,
  DbReaction,
  DbDmThread,
  DbDmMessage,
  DbUserProfile,
  DbFriendRequest,
  DbFriendship,
  DbTradeListing,
  DbTradeTransaction,
  DbParty,
  DbPartyMember,
  DbBan,
  DbMute,
  DbReport,
  DbRole,
  DbNotification,
} from "@/lib/types";
