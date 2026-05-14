"use client";

/**
 * Per-server role membership.
 *
 * Storage: CloudBase collection `server_members`
 *   { id, server_id, user_id, user_name, role, joined_at }
 *
 * `id` is the composite key `${server_id}__${user_id}` so we can look up
 * a (server, user) pair in one query.
 *
 * Recommended permission rules:
 *   read:  "auth != null"
 *   write: "auth != null"   // tighten later via cloud function for promote/demote
 *
 * Roles:
 *   - creator: the original founder of the server. Exactly 1 per server.
 *   - admin:   moderator. Capacity = 4 + floor(member_count / 5000).
 *   - member:  default for everyone who joins.
 *
 * This store loads MY membership across all servers on bootstrap so role
 * checks elsewhere (composer gating, future role-management UI) are sync.
 *
 * Official servers (servers.is_official == true) ignore this table entirely
 * and use the platform-wide admin list instead (NEXT_PUBLIC_ADMIN_USER_IDS).
 */

import { create } from "zustand";
import { useEffect } from "react";
import { db } from "@/lib/cloudbase";
import { useAuth } from "@/lib/auth-store";
import { servers as MOCK_SERVERS } from "@/lib/mock-data";
import { isAdminId } from "@/lib/roles";

export type ServerRole = "creator" | "admin" | "member";

export type ServerMembershipRow = {
  id: string;
  server_id: string;
  user_id: string;
  user_name: string;
  role: ServerRole;
  joined_at: string;
};

type Store = {
  /** Map server_id → my role in that server. */
  myRoles: Record<string, ServerRole>;
  loading: boolean;
  refresh: () => Promise<void>;
};

export const useServerRoles = create<Store>()((set) => ({
  myRoles: {},
  loading: false,

  refresh: async () => {
    const me = useAuth.getState().user;
    if (!me) {
      set({ myRoles: {} });
      return;
    }
    set({ loading: true });
    try {
      const res = await db
        .collection("server_members")
        .where({ user_id: me.id })
        .limit(500)
        .get();
      const next: Record<string, ServerRole> = {};
      for (const r of (res.data || []) as ServerMembershipRow[]) {
        next[r.server_id] = r.role;
      }
      set({ myRoles: next, loading: false });
    } catch (e) {
       
      console.warn("[server-roles] refresh failed:", e);
      set({ loading: false });
    }
  },
}));

/** Hook: my role in a given server (undefined = not a member). */
export function useMyServerRole(serverId: string): ServerRole | undefined {
  return useServerRoles((s) => s.myRoles[serverId]);
}

/**
 * Hook: can the current user post in announcement channels of this server?
 * - Official server → only platform admins (env var)
 * - Custom server   → creator or admin role
 */
export function useCanPostAnnouncement(serverId: string): boolean {
  const me = useAuth((s) => s.user);
  const role = useMyServerRole(serverId);
  const server = MOCK_SERVERS.find((s) => s.id === serverId);
  if (!me) return false;
  if (server?.is_official) return isAdminId(me.id);
  return role === "creator" || role === "admin";
}

/**
 * Admin slot capacity for a server given its member count.
 *   base    = 4 admins
 *   bonus   = +1 per full 5000 members
 *   ceiling = 10 (hard cap regardless of size)
 * The creator does NOT count against this cap.
 */
export const ADMIN_SLOT_HARD_CAP = 10;
export function adminSlotsFor(memberCount: number): number {
  return Math.min(
    ADMIN_SLOT_HARD_CAP,
    4 + Math.floor(Math.max(0, memberCount) / 5000),
  );
}

/**
 * Bootstrap hook: refreshes my server roles whenever the auth user changes.
 * Wire into AuthBootstrap so the rest of the app can synchronously read
 * roles via the hooks above without waiting for queries to settle.
 */
export function useServerRolesBootstrap() {
  const user = useAuth((s) => s.user);
  const refresh = useServerRoles((s) => s.refresh);
  useEffect(() => {
    if (user) void refresh();
  }, [user, refresh]);
}
