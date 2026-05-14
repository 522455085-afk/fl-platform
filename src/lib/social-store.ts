"use client";

/**
 * Friend + block state for ForgottenLand.
 *
 * Two CloudBase collections (auto-created on first insert):
 *
 *  - friendships: { id, requester_id, requester_name, requester_avatar,
 *                   requester_color, addressee_id, addressee_name,
 *                   addressee_avatar, addressee_color,
 *                   status: "pending"|"accepted", created_at }
 *  - blocks:      { id, blocker_id, blocked_id, blocked_name,
 *                   blocked_avatar, blocked_color, created_at }
 *
 * State is fetched on login, on tab focus and every 30s. CloudBase realtime
 * watch is intentionally NOT used here — these collections are tiny, low
 * change frequency, and avoiding watch keeps the realtime quota for
 * messages/presence which actually need it.
 */

import { create } from "zustand";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/cloudbase";
import { useAuth } from "@/lib/auth-store";
import { useNotifications } from "@/lib/notifications-store";

// Module-level throttle for refresh(). Coalesces rapid focus / visibility
// events so we don't issue 3 identical queries in 100ms.
let socialRefreshInFlight = false;
let socialLastRefreshAt = 0;
const SOCIAL_REFRESH_MIN_MS = 1500;
// Track which pending-incoming request IDs we've already notified about.
const notifiedRequestIds = new Set<string>();

export type FriendshipRow = {
  id: string;
  requester_id: string;
  requester_name: string;
  requester_avatar: string;
  requester_color: string;
  /** Optional uploaded avatar image for the requester. */
  requester_avatar_url?: string | null;
  addressee_id: string;
  addressee_name: string;
  addressee_avatar: string;
  addressee_color: string;
  /** Optional uploaded avatar image for the addressee. */
  addressee_avatar_url?: string | null;
  status: "pending" | "accepted";
  created_at: string;
};

export type FriendSummary = {
  user_id: string;
  username: string;
  avatar: string;
  avatar_color: string;
  avatar_url?: string | null;
  friendship_id: string;
};

export type FriendStatus =
  | "none"
  | "self"
  | "pending_outgoing"
  | "pending_incoming"
  | "accepted";

type SocialState = {
  friendships: FriendshipRow[];
  blockedIds: string[]; // simple array; we re-derive a Set in the hook below
  loading: boolean;

  refresh: () => Promise<void>;

  sendFriendRequest: (target: {
    user_id: string;
    username: string;
    avatar: string;
    avatar_color: string;
    avatar_url?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  acceptFriendRequest: (friendshipId: string) => Promise<{ ok: boolean; error?: string }>;
  declineFriendRequest: (friendshipId: string) => Promise<{ ok: boolean; error?: string }>;
  removeFriend: (friendshipId: string) => Promise<{ ok: boolean; error?: string }>;

  blockUser: (target: {
    user_id: string;
    username: string;
    avatar: string;
    avatar_color: string;
    avatar_url?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  unblockUser: (targetId: string) => Promise<{ ok: boolean; error?: string }>;
};

export const useSocial = create<SocialState>()((set, get) => ({
  friendships: [],
  blockedIds: [],
  loading: false,

  refresh: async () => {
    const me = useAuth.getState().user;
    if (!me) {
      set({ friendships: [], blockedIds: [], loading: false });
      return;
    }
    // Coalesce duplicate calls (rapid focus/visibility flap).
    if (socialRefreshInFlight) return;
    if (Date.now() - socialLastRefreshAt < SOCIAL_REFRESH_MIN_MS) return;
    socialRefreshInFlight = true;
    set({ loading: true });
    try {
      // Fetch friendships in two queries (adapter only supports a single eq
      // filter, no OR). Merge + dedupe on id.
      const [r1, r2, b] = await Promise.all([
        supabase.from("friendships").select("*").eq("requester_id", me.id),
        supabase.from("friendships").select("*").eq("addressee_id", me.id),
        supabase.from("blocks").select("*").eq("blocker_id", me.id),
      ]);

      // Diagnostic: if either query errors, the most likely cause is that
      // the CloudBase `friendships` collection's read rule blocks rows
      // where the current user is the addressee (default rule
      // `auth.uid == doc._openid` only lets the original sender see). The
      // fix is to set the rule to allow either side of the relationship —
      // see DEPLOY_NEXT.md / CLOUDBASE_RULES.md.
      if (r1.error) {
         
        console.error(
          "[social] friendships requester_id query FAILED:",
          r1.error,
        );
      }
      if (r2.error) {
         
        console.error(
          "[social] friendships addressee_id query FAILED — likely a CloudBase read-rule issue. Set the friendships rule to allow rows where requester_id OR addressee_id matches the caller. Error:",
          r2.error,
        );
      }
       
      console.debug(
        `[social] refresh: as_requester=${(r1.data as unknown[] | null)?.length ?? 0} as_addressee=${(r2.data as unknown[] | null)?.length ?? 0} blocks=${(b.data as unknown[] | null)?.length ?? 0}`,
      );

      const all = [
        ...((r1.data as FriendshipRow[] | null) || []),
        ...((r2.data as FriendshipRow[] | null) || []),
      ];
      const map = new Map<string, FriendshipRow>();
      for (const f of all) map.set(f.id, f);
      const dedup = Array.from(map.values());

      const blocked = ((b.data as Array<{ blocked_id: string }> | null) || []).map(
        (x) => x.blocked_id,
      );

      // Fire notification for any new incoming pending requests.
      const myId = me.id;
      const newIncoming = dedup.filter(
        (f) => f.status === "pending" && f.addressee_id === myId && !notifiedRequestIds.has(f.id),
      );
      for (const f of newIncoming) {
        notifiedRequestIds.add(f.id);
        useNotifications.getState().add({
          kind: "system",
          title: `${f.requester_name} 请求添加好友`,
          body: "点击此通知前往好友面板接受或拒绝 →",
          avatarText: f.requester_avatar,
          avatarColor: f.requester_color,
        });
      }

      set({ friendships: dedup, blockedIds: blocked, loading: false });
    } catch (e) {
       
      console.error("[social] refresh failed:", e);
      set({ loading: false });
    } finally {
      socialRefreshInFlight = false;
      socialLastRefreshAt = Date.now();
    }
  },

  sendFriendRequest: async (target) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    if (target.user_id === me.id) return { ok: false, error: "不能加自己为好友" };

    const existing = get().friendships.find(
      (f) =>
        (f.requester_id === me.id && f.addressee_id === target.user_id) ||
        (f.requester_id === target.user_id && f.addressee_id === me.id),
    );
    if (existing) {
      if (existing.status === "accepted") return { ok: false, error: "已经是好友" };
      if (existing.status === "pending") return { ok: false, error: "请求已发出" };
    }

    const { error } = await supabase.from("friendships").insert({
      requester_id: me.id,
      requester_name: me.username,
      requester_avatar: me.avatar,
      requester_color: me.avatarColor,
      requester_avatar_url: me.avatarUrl ?? null,
      addressee_id: target.user_id,
      addressee_name: target.username,
      addressee_avatar: target.avatar,
      addressee_color: target.avatar_color,
      addressee_avatar_url: target.avatar_url ?? null,
      status: "pending",
      created_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    await get().refresh();
    return { ok: true };
  },

  acceptFriendRequest: async (friendshipId) => {
    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", friendshipId);
    if (error) return { ok: false, error: error.message };
    await get().refresh();
    return { ok: true };
  },

  declineFriendRequest: async (friendshipId) => {
    const { error } = await supabase
      .from("friendships")
      .delete()
      .eq("id", friendshipId);
    if (error) return { ok: false, error: error.message };
    await get().refresh();
    return { ok: true };
  },

  removeFriend: async (friendshipId) => {
    const { error } = await supabase
      .from("friendships")
      .delete()
      .eq("id", friendshipId);
    if (error) return { ok: false, error: error.message };
    await get().refresh();
    return { ok: true };
  },

  blockUser: async (target) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    if (target.user_id === me.id) return { ok: false, error: "不能屏蔽自己" };

    if (get().blockedIds.includes(target.user_id)) return { ok: true };

    const { error } = await supabase.from("blocks").insert({
      blocker_id: me.id,
      blocked_id: target.user_id,
      blocked_name: target.username,
      blocked_avatar: target.avatar,
      blocked_color: target.avatar_color,
      created_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };

    set({ blockedIds: [...get().blockedIds, target.user_id] });
    return { ok: true };
  },

  unblockUser: async (targetId) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };

    // Two-eq filter: our adapter combines them into a single CloudBase where().
    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker_id", me.id)
      .eq("blocked_id", targetId);
    if (error) return { ok: false, error: error.message };

    set({ blockedIds: get().blockedIds.filter((id) => id !== targetId) });
    return { ok: true };
  },
}));

// ============================================================
// Convenience hooks
// ============================================================

/** Returns lists of accepted friends, incoming and outgoing pending requests. */
export function useFriends() {
  const me = useAuth((s) => s.user);
  const friendships = useSocial((s) => s.friendships);

  const friends: FriendSummary[] = [];
  const incoming: FriendshipRow[] = [];
  const outgoing: FriendshipRow[] = [];

  if (!me) return { friends, incoming, outgoing };

  for (const f of friendships) {
    if (f.status === "accepted") {
      const other =
        f.requester_id === me.id
          ? {
              user_id: f.addressee_id,
              username: f.addressee_name,
              avatar: f.addressee_avatar,
              avatar_color: f.addressee_color,
              avatar_url: f.addressee_avatar_url ?? null,
            }
          : {
              user_id: f.requester_id,
              username: f.requester_name,
              avatar: f.requester_avatar,
              avatar_color: f.requester_color,
              avatar_url: f.requester_avatar_url ?? null,
            };
      friends.push({ ...other, friendship_id: f.id });
    } else if (f.status === "pending") {
      if (f.addressee_id === me.id) incoming.push(f);
      else if (f.requester_id === me.id) outgoing.push(f);
    }
  }

  // Sort friends alphabetically.
  friends.sort((a, b) => a.username.localeCompare(b.username));

  return { friends, incoming, outgoing };
}

/** Returns the relationship of the current user to a target user id. */
export function useFriendStatusFor(otherId: string | null | undefined): {
  status: FriendStatus;
  friendshipId: string | null;
} {
  const me = useAuth((s) => s.user);
  const friendships = useSocial((s) => s.friendships);
  if (!me || !otherId) return { status: "none", friendshipId: null };
  if (otherId === me.id) return { status: "self", friendshipId: null };

  for (const f of friendships) {
    const isPair =
      (f.requester_id === me.id && f.addressee_id === otherId) ||
      (f.requester_id === otherId && f.addressee_id === me.id);
    if (!isPair) continue;
    if (f.status === "accepted") return { status: "accepted", friendshipId: f.id };
    if (f.status === "pending") {
      return {
        status: f.requester_id === me.id ? "pending_outgoing" : "pending_incoming",
        friendshipId: f.id,
      };
    }
  }
  return { status: "none", friendshipId: null };
}

/** Returns true if `userId` is on the current user's block list. */
export function useIsBlocked(userId: string | null | undefined): boolean {
  const blockedIds = useSocial((s) => s.blockedIds);
  if (!userId) return false;
  return blockedIds.includes(userId);
}

/** Returns the full Set of blocked user ids (stable reference per render). */
export function useBlockedIdsSet(): Set<string> {
  const blockedIds = useSocial((s) => s.blockedIds);
  // Create a fresh Set per render — array is small (< a few hundred).
  return new Set(blockedIds);
}

/**
 * React hook that bootstraps social state alongside auth: loads on login,
 * refetches on focus and every 30s, clears on logout.
 *
 * Mount once at the app root (in AuthBootstrap).
 */
export function useSocialBootstrap() {
  const user = useAuth((s) => s.user);
  const refresh = useSocial((s) => s.refresh);

  useEffect(() => {
    if (!user) {
      useSocial.setState({ friendships: [], blockedIds: [], loading: false });
      return;
    }
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    // Realtime watch via direct CloudBase db.watch() — much lighter than
    // going through the supabase adapter (which adds its own hidden poll).
    // One watch per direction; both share the same throttled refresh().
    const onWatchChange = () => refresh();
    const onWatchError = (e: Error | unknown) => console.warn("[social] watch error:", e);

    let watchAddressee: { close: () => void } | null = null;
    let watchRequester: { close: () => void } | null = null;
    try {
      watchAddressee = db
        .collection("friendships")
        .where({ addressee_id: user.id })
        .watch({ onChange: onWatchChange, onError: onWatchError });
      watchRequester = db
        .collection("friendships")
        .where({ requester_id: user.id })
        .watch({ onChange: onWatchChange, onError: onWatchError });
    } catch (e) {
      console.warn("[social] watch setup failed, falling back to poll:", e);
    }

    // Fallback poll every 30s in case watch drops.
    const interval = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
      try { watchAddressee?.close(); } catch { /* ignore */ }
      try { watchRequester?.close(); } catch { /* ignore */ }
    };
  }, [user, refresh]);
}
