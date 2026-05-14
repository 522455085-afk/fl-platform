"use client";

/**
 * Direct-message thread index. Lets users see their past conversations
 * (with anyone — friend or not) persistently, and powers the unread badge.
 *
 * Model: every 1:1 conversation has TWO rows in `dm_threads`, one per
 * participant. Row id is deterministic: `${user_id}__${partner_id}`. Owner
 * of the row is `user_id`. This avoids messy OR queries and lets each user
 * fetch their own thread list with a single `where user_id = me`.
 *
 * CloudBase collection: `dm_threads`
 * Recommended rules (self-read, loose-write so the sender can update the
 * recipient's mirror row on message send):
 *   read:  "auth.openid == doc.user_id"
 *   write: "auth != null"
 *
 * The write rule is intentionally permissive — a misbehaving client could
 * spam-write fake preview text into your list, but they can't read it, and
 * they can't read your private messages. Good enough for now; tighten via a
 * cloud function later if abuse appears.
 */

import { create } from "zustand";
import { useEffect } from "react";
import { db, dbCmd } from "@/lib/cloudbase";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";

// Module-level throttle for refresh(). Coalesces rapid focus / visibility
// events so we don't issue 3 identical queries in 100ms. The 8s scheduled
// poll is unaffected because 8000 > MIN_MS.
let dmRefreshInFlight = false;
let dmLastRefreshAt = 0;
const DM_REFRESH_MIN_MS = 1500;

// Module-level dedup of incoming DM ids that have already gone
// through `noteIncomingDm`. Outlives the polling closure (which has
// its own per-mount Set) so realtime + poll don't double-count.
const noteIncomingSeen = new Set<string>();

export type DmThreadRow = {
  /** Composite primary key: `${user_id}__${partner_id}`. NOT named `id`
   *  to avoid collision with CloudBase's internal `_id` system field, which
   *  caused `where({id: ...})` lookups to silently return zero matches and
   *  spawn a duplicate row on every send. */
  thread_key: string;
  user_id: string;
  partner_id: string;
  partner_name: string;
  partner_avatar: string;
  partner_color: string;
  /** Uploaded image avatar URL for the partner; null = use letter tile. */
  partner_avatar_url?: string | null;
  last_message_at: string;
  last_preview: string;
  unread_count: number;
  hidden?: boolean;
  created_at: string;
};

type DmState = {
  threads: DmThreadRow[];
  loading: boolean;

  refresh: () => Promise<void>;
  markRead: (partnerId: string) => Promise<void>;
  hideThread: (partnerId: string) => Promise<void>;
  /**
   * Called by ChatView after a DM message is successfully sent. Upserts both
   * sides of the thread (me and partner), incrementing partner's unread.
   */
  touch: (params: {
    partner: {
      user_id: string;
      username: string;
      avatar: string;
      avatar_color: string;
      avatar_url?: string | null;
    };
    preview: string;
    ts: string;
    incrementPartnerUnread: boolean;
  }) => Promise<void>;
  /**
   * Called by the receiver-side bootstrap when we observe an incoming DM
   * message addressed to us in the `messages` collection. We can't rely on
   * the sender writing our `dm_threads` mirror row (CloudBase write rules
   * usually reject cross-user writes), so the receiver writes its own row
   * and bumps its own unread counter. This is what powers the red dot for
   * non-friend DMs (and friends too — same code path).
   */
  noteIncomingDm: (msg: {
    id: string;
    author_id: string;
    author_name: string;
    author_avatar: string;
    author_color: string;
    author_avatar_url?: string | null;
    content: string;
    created_at: string;
  }) => Promise<void>;
};

export const useDmThreads = create<DmState>()((set, get) => ({
  threads: [],
  loading: false,

  refresh: async () => {
    const me = useAuth.getState().user;
    if (!me) {
      set({ threads: [], loading: false });
      return;
    }
    if (dmRefreshInFlight) return;
    if (Date.now() - dmLastRefreshAt < DM_REFRESH_MIN_MS) return;
    dmRefreshInFlight = true;
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from("dm_threads")
        .select("*")
        .eq("user_id", me.id)
        .order("last_message_at", { ascending: false });
      if (error) throw new Error(error.message);
      const all = ((data as DmThreadRow[] | null) || []).filter(
        (t) => !t.hidden,
      );
      // Defensive de-dup: if older buggy versions left multiple rows for
      // the same partner, keep only the most-recently-touched one.
      const byPartner = new Map<string, DmThreadRow>();
      for (const r of all) {
        const cur = byPartner.get(r.partner_id);
        if (!cur || (r.last_message_at || "") > (cur.last_message_at || "")) {
          byPartner.set(r.partner_id, r);
        }
      }
      const rows = [...byPartner.values()].sort((a, b) =>
        (b.last_message_at || "").localeCompare(a.last_message_at || ""),
      );
       
      console.debug(
        `[dm-threads] refresh: ${rows.length} rows for user_id=${me.id}`,
        rows.map((r) => ({ partner: r.partner_name, unread: r.unread_count })),
      );
      set({ threads: rows, loading: false });
    } catch (e) {
       
      console.warn("[dm-threads] refresh failed:", e);
      set({ loading: false });
    } finally {
      dmRefreshInFlight = false;
      dmLastRefreshAt = Date.now();
    }
  },

  markRead: async (partnerId) => {
    const me = useAuth.getState().user;
    if (!me) return;
    const thread_key = `${me.id}__${partnerId}`;

    // Optimistic local update.
    set({
      threads: get().threads.map((t) =>
        t.partner_id === partnerId ? { ...t, unread_count: 0 } : t,
      ),
    });

    try {
      await db
        .collection("dm_threads")
        .where({ thread_key })
        .update({ unread_count: 0 });
    } catch (e) {
       
      console.warn("[dm-threads] markRead failed:", e);
    }
  },

  hideThread: async (partnerId) => {
    const me = useAuth.getState().user;
    if (!me) return;
    const thread_key = `${me.id}__${partnerId}`;

    // Remove from local list.
    set({
      threads: get().threads.filter((t) => t.partner_id !== partnerId),
    });

    try {
      await db
        .collection("dm_threads")
        .where({ thread_key })
        .update({ hidden: true });
    } catch (e) {
       
      console.warn("[dm-threads] hide failed:", e);
    }
  },

  touch: async ({ partner, preview, ts, incrementPartnerUnread }) => {
    const me = useAuth.getState().user;
    if (!me) return;
     
    console.log("[dm-threads] touch", {
      me: me.id,
      partner: partner.user_id,
      incrementPartnerUnread,
    });

    const shortPreview = preview.length > 80 ? preview.slice(0, 80) + "…" : preview;

    // Two rows: my side, partner's side. Each identified by `thread_key`
    // (NOT `id` — see DmThreadRow type comment).
    const mySide = {
      thread_key: `${me.id}__${partner.user_id}`,
      user_id: me.id,
      partner_id: partner.user_id,
      partner_name: partner.username,
      partner_avatar: partner.avatar,
      partner_color: partner.avatar_color,
      partner_avatar_url: partner.avatar_url ?? null,
    };
    const partnerSide = {
      thread_key: `${partner.user_id}__${me.id}`,
      user_id: partner.user_id,
      partner_id: me.id,
      partner_name: me.username,
      partner_avatar: me.avatar,
      partner_color: me.avatarColor,
      partner_avatar_url: me.avatarUrl ?? null,
    };

    // Optimistic local merge — the sender expects to see their new
    // thread surface in the 私信 list IMMEDIATELY after firing off
    // the first message. Previously the list only refreshed via the
    // 8s polling tick, which is what produced the ~5s "ghost" delay
    // the user reported (image 1).
    set((s) => {
      const idx = s.threads.findIndex((t) => t.partner_id === partner.user_id);
      const merged: DmThreadRow = {
        ...mySide,
        last_message_at: ts,
        last_preview: shortPreview,
        unread_count: 0,
        hidden: false,
      } as DmThreadRow;
      const next =
        idx >= 0
          ? s.threads.map((t, i) =>
              i === idx ? { ...t, ...merged } : t,
            )
          : [merged, ...s.threads];
      // Keep the list sorted by most-recent activity so the new
      // thread bubbles to the top.
      next.sort((a, b) =>
        (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""),
      );
      return { threads: next };
    });

    await Promise.all([
      upsertRow(mySide, {
        last_message_at: ts,
        last_preview: shortPreview,
        unread_count: 0,
        hidden: false,
      }),
      upsertRow(
        partnerSide,
        incrementPartnerUnread
          ? {
              last_message_at: ts,
              last_preview: shortPreview,
              // Use atomic inc so concurrent sends don't clobber each other.
              unread_count: dbCmd.inc(1),
              hidden: false,
            }
          : {
              last_message_at: ts,
              last_preview: shortPreview,
              hidden: false,
            },
      ),
    ]);
  },

  noteIncomingDm: async (msg) => {
    const me = useAuth.getState().user;
    if (!me) return;
    if (msg.author_id === me.id) return; // never note our own outgoing

    // Session-wide dedup. Two paths now feed this: the realtime fast
    // path in MentionWatcher and the 8s pollIncomingDms backup. If
    // both deliver the same row id we'd fire the toast / sound twice
    // and add two inbox entries. Bump the cap small — DM volume per
    // session is low.
    if (noteIncomingSeen.has(msg.id)) return;
    noteIncomingSeen.add(msg.id);
    if (noteIncomingSeen.size > 500) {
      const it = noteIncomingSeen.values();
      noteIncomingSeen.delete(it.next().value as string);
    }

    const preview = (msg.content || "").slice(0, 80);
     
    console.log("[dm-threads] noteIncomingDm from", msg.author_name, msg.id);

    // Fire side-effects (sound, OS notification, inbox entry, bottom-
    // right popup). Suppressed when the user is currently viewing
    // THIS dm thread — they're already looking at it, no need to
    // bother them. We read the active-dm marker that page.tsx pushes
    // to window so we don't introduce a circular store dep.
    const activePartnerId =
      typeof window !== "undefined"
        ? (window as unknown as { __flActiveDmPartnerId?: string })
            .__flActiveDmPartnerId
        : undefined;
    if (activePartnerId !== msg.author_id) {
      try {
        const { useDmToastStore } = await import("@/lib/dm-toast-store");
        useDmToastStore.getState().push({
          partnerId: msg.author_id,
          partnerName: msg.author_name,
          partnerAvatar: msg.author_avatar,
          partnerColor: msg.author_color,
          partnerAvatarUrl: msg.author_avatar_url ?? null,
          preview,
        });
        const { useNotifications } = await import("@/lib/notifications-store");
        useNotifications.getState().add({
          kind: "dm",
          title: `${msg.author_name} 发来私信`,
          body: preview,
          avatarText: msg.author_avatar,
          avatarColor: msg.author_color,
          partnerId: msg.author_id,
          partnerName: msg.author_name,
          partnerAvatar: msg.author_avatar,
          partnerColor: msg.author_color,
          partnerAvatarUrl: msg.author_avatar_url ?? null,
        });
        const { notifyMention } = await import("@/lib/browser-notify");
        void notifyMention({
          title: `${msg.author_name} 发来私信`,
          body: preview,
        });
      } catch (e) {
        console.warn("[dm-threads] notification fan-out failed:", e);
      }
    }

    // Skip incrementing unread_count when the user is already
    // viewing this DM — ChatView will mark it read immediately, and
    // racing the inc(1) against that reset produced phantom "1"
    // badges that stuck around for an 8s poll cycle.
    const viewingNow = activePartnerId === msg.author_id;
    await upsertRow(
      {
        thread_key: `${me.id}__${msg.author_id}`,
        user_id: me.id,
        partner_id: msg.author_id,
        partner_name: msg.author_name,
        partner_avatar: msg.author_avatar,
        partner_color: msg.author_color,
        partner_avatar_url: msg.author_avatar_url ?? null,
      },
      viewingNow
        ? {
            last_message_at: msg.created_at,
            last_preview: preview,
            hidden: false,
          }
        : {
            last_message_at: msg.created_at,
            last_preview: preview,
            // Atomic inc so concurrent receives don't clobber.
            unread_count: dbCmd.inc(1),
            hidden: false,
          },
    );
  },
}));

/**
 * Upsert helper: writes the stable identity fields on insert, only the
 * volatile fields on update. Uses CloudBase directly so we can pass
 * `dbCmd.inc(1)` through without the Supabase-adapter flattening it.
 */
async function upsertRow(
  identity: {
    thread_key: string;
    user_id: string;
    partner_id: string;
    partner_name: string;
    partner_avatar: string;
    partner_color: string;
    partner_avatar_url?: string | null;
  },
  volatile: Record<string, unknown>,
): Promise<void> {
  try {
    const existing = await db
      .collection("dm_threads")
      .where({ thread_key: identity.thread_key })
      .get();
    if (existing.data && existing.data.length > 0) {
      const res = await db
        .collection("dm_threads")
        .where({ thread_key: identity.thread_key })
        .update({
          // Refresh partner display fields in case they renamed or
          // changed their avatar.
          partner_name: identity.partner_name,
          partner_avatar: identity.partner_avatar,
          partner_color: identity.partner_color,
          partner_avatar_url: identity.partner_avatar_url ?? null,
          ...volatile,
        });
       
      console.log("[dm-threads] upsert UPDATE", identity.thread_key, res);
    } else {
      const res = await db.collection("dm_threads").add({
        ...identity,
        created_at: new Date().toISOString(),
        unread_count: 0,
        hidden: false,
        last_message_at: new Date().toISOString(),
        last_preview: "",
        ...volatile,
      });
       
      console.log("[dm-threads] upsert ADD", identity.thread_key, res);
    }
  } catch (e) {
     
    console.warn("[dm-threads] upsertRow failed for", identity.thread_key, e);
  }
}

// ============================================================
// Hooks
// ============================================================

/** Convenience: total unread across all threads. */
export function useTotalDmUnread(): number {
  const threads = useDmThreads((s) => s.threads);
  let total = 0;
  for (const t of threads) total += t.unread_count || 0;
  return total;
}

/**
 * Bootstrap: on login fetches once, then subscribes to realtime changes on
 * `dm_threads` filtered to the current user. Also refetches on window focus
 * as a safety net. Mount once at app root in AuthBootstrap.
 */
export function useDmThreadsBootstrap() {
  const user = useAuth((s) => s.user);
  const refresh = useDmThreads((s) => s.refresh);

  useEffect(() => {
    if (!user) {
      useDmThreads.setState({ threads: [], loading: false });
      return;
    }
    refresh();

    // Per-session de-dup of incoming DM messages we've already credited
    // to a thread. Reset every time the effect remounts (i.e. every login
    // session). On the FIRST poll we only seed this set without firing
    // notifications — otherwise every login would replay all backlog DMs
    // as fresh red dots.
    const seenIncomingMsgIds = new Set<string>();
    let incomingSeeded = false;
    const myId = user.id;

    /**
     * Poll for DMs sent TO me by anyone (friend or not). The sender's
     * mirror-row write into `dm_threads` is silently rejected by the
     * default CloudBase write rule (`auth.uid == doc._openid`), so the
     * receiver has to upsert their own row to surface the conversation
     * + unread count. We scan recent rows in `messages` (last 5 min) and
     * filter client-side for dm channels containing my id.
     */
    const pollIncomingDms = async () => {
      try {
        const cutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("messages")
          .select("*")
          .gt("created_at", cutoffIso)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error || !data) return;
        const incoming = (data as Array<{ channel_id?: string; author_id?: string; id?: string }>).filter((m) => {
          const cid: string | undefined = m.channel_id;
          if (!cid || !cid.startsWith("dm:")) return false;
          // Format: dm:${a}:${b} where a,b are sorted user ids.
          const parts = cid.split(":");
          if (parts.length !== 3) return false;
          const a = parts[1];
          const b = parts[2];
          if (a !== myId && b !== myId) return false;
          if (m.author_id === myId) return false;
          return true;
        });

        if (!incomingSeeded) {
          // First poll just remembers what's already there so we don't
          // pop a flood of red dots for old messages on login.
          for (const m of incoming) seenIncomingMsgIds.add(m.id);
          incomingSeeded = true;
          return;
        }

        let touched = false;
        for (const m of incoming) {
          if (seenIncomingMsgIds.has(m.id)) continue;
          seenIncomingMsgIds.add(m.id);
          touched = true;
          await useDmThreads.getState().noteIncomingDm({
            id: m.id,
            author_id: m.author_id,
            author_name: m.author_name,
            author_avatar: m.author_avatar,
            author_color: m.author_color,
            author_avatar_url: m.author_avatar_url ?? null,
            content: m.content,
            created_at: m.created_at,
          });
        }
        // If we wrote any thread rows above, refresh local state so the
        // sidebar's red dot updates without waiting for the next 8s tick.
        if (touched) await refresh();
      } catch (e) {
         
        console.warn("[dm-threads] pollIncomingDms failed:", e);
      }
    };

    // We intentionally DO NOT open a realtime watch on dm_threads. CloudBase
    // watch on this collection emits an uncaught SYS_ERR from deep inside
    // the SDK and reconnects in a noisy loop. Instead we poll every 8 s
    // (small table → cheap) and force a fresh fetch whenever the tab
    // becomes visible or the window regains focus, so the unread badge
    // updates within seconds of the user looking at the page again.
    const pollId = setInterval(() => {
      refresh();
      void pollIncomingDms();
    }, 15_000);
    // Kick off the incoming-DM poll once immediately so the seed runs at
    // login time, not 8s later.
    void pollIncomingDms();

    const onFocus = () => {
      refresh();
      void pollIncomingDms();
    };
    const onVisibility = () => {
      if (!document.hidden) {
        refresh();
        void pollIncomingDms();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, refresh]);
}
