"use client";

/**
 * Real `servers` collection — user-created guilds/clubs that live alongside
 * the platform-shipped official servers (mock-data.ts).
 *
 * Storage: CloudBase collection `servers`
 *   { id, name, icon_text, icon_color, creator_id, creator_name,
 *     member_count, is_official, created_at }
 *
 * Recommended permission rules:
 *   read:  "auth != null"
 *   write: "auth != null"   // tighten later via cloud function for
 *                              membership-only writes
 *
 * On bootstrap we fetch every `server_members` row owned by the current
 * user, then load the matching `servers` rows. Custom servers are merged
 * with the hardcoded MOCK_SERVERS list when the UI asks for "all servers
 * I belong to".
 */

import { create } from "zustand";
import { useEffect } from "react";
import { db, dbCmd } from "@/lib/cloudbase";
import { useAuth } from "@/lib/auth-store";
import {
  servers as MOCK_SERVERS,
  type Server,
  type ChannelCategory,
} from "@/lib/mock-data";
import { useServerRoles } from "@/lib/server-roles-store";
import { genVanityId } from "@/lib/vanity-id";

// Module-level throttle for refresh(). Prevents focus+visibility+poll
// triggers from piling up into 3 simultaneous fetches.
let serversRefreshInFlight = false;
let serversLastRefreshAt = 0;
const SERVERS_REFRESH_MIN_MS = 1500;

export type ServerDocRow = {
  id: string;
  name: string;
  icon_text: string;
  icon_color: string;
  creator_id: string;
  creator_name: string;
  member_count: number;
  is_official?: boolean;
  /**
   * Public servers show up in the "发现公会" browse list and can be
   * joined by anyone with the invite code OR via the discover page.
   * Private servers are invite-code-only.
   */
  is_public?: boolean;
  /**
   * 6-character human-readable invite code (no confusing 0/O/1/I/L).
   * Anyone with this code can join via the JoinServerModal or invite link.
   */
  invite_code?: string;
  /** Optional uploaded image (dataURL or http URL). Overrides icon_text when present. */
  icon_url?: string | null;
  /** 8-digit human-readable 公会号 (vanity id). */
  numeric_id?: string | null;
  /**
   * Optional admin-edited channel layout. JSON-serialised because
   * CloudBase stores arbitrary nested objects/arrays just fine. When
   * present, ChannelSidebar renders these instead of the global mock
   * `channelCategories`. Keep the array small (< 20 categories,
   * < 50 channels each) to stay under CloudBase's per-doc cap.
   */
  channels?: ChannelCategory[];
  created_at: string;
};

type Store = {
  /** Servers I'm a member of that came from the DB (NOT the mock set). */
  custom: Server[];
  /**
   * CloudBase overrides for hardcoded official servers (name / icon).
   * Keyed by server id. Merged over MOCK_SERVERS in useAllServers().
   */
  officialOverrides: Record<string, Partial<Server>>;
  /**
   * Cache of full server doc rows for servers I belong to — the UI list
   * (`custom`) only carries display fields. Settings / invite features
   * read from this fuller cache.
   */
  customRows: ServerDocRow[];
  /**
   * A non-joined server the user is currently *previewing* (browsed from
   * Discover or opened from an invite link). Appears in `useAllServers()`
   * so the sidebar can show its icon / channels, but `useIsServerMember`
   * returns false so the composer is locked and a "加入" banner renders.
   *
   * Cleared when the user either joins (becomes a real member) or
   * dismisses the preview.
   */
  preview: ServerDocRow | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Enter preview mode for a public server the user hasn't joined yet. */
  setPreview: (row: ServerDocRow | null) => void;
  /** Create a new user-owned server. The current user becomes the creator. */
  createServer: (input: {
    name: string;
    iconText: string;
    iconColor: string;
    isPublic?: boolean;
    /** Optional uploaded server avatar (dataURL). When set, takes priority
     * over the letter+color tile in the icon column. */
    iconUrl?: string | null;
  }) => Promise<{ ok: boolean; error?: string; serverId?: string }>;
  /** Disband — only the creator can call this; deletes the server + members. */
  disbandServer: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Leave a server — removes my own membership row. Creators must transfer first. */
  leaveServer: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Join via 6-char invite code. Returns the joined serverId on success. */
  joinByCode: (
    code: string,
  ) => Promise<{ ok: boolean; error?: string; serverId?: string }>;
  /** Join a public server directly by id (from discover/browse). */
  joinById: (
    serverId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Generate + persist a fresh invite code (creator/admin only). */
  regenerateInviteCode: (
    serverId: string,
  ) => Promise<{ ok: boolean; error?: string; code?: string }>;
  /** Toggle public/private (creator only). */
  setPublic: (
    serverId: string,
    isPublic: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Update display name + icon (creator/admin). */
  updateServer: (
    serverId: string,
    patch: {
      name?: string;
      iconText?: string;
      iconColor?: string;
      /** dataURL / http URL; pass `null` to clear and fall back to iconText. */
      iconUrl?: string | null;
      /** Replace the admin-edited channel layout. Pass `null` to revert. */
      channels?: ChannelCategory[] | null;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Browse all public servers (Discover page). */
  browsePublic: (
    search?: string,
  ) => Promise<ServerDocRow[]>;
  /** Client-side list of server IDs the user has visited. Used to zero out
   * the unread badge in the sidebar without a database round-trip. */
  clearedIds: string[];
  markServerRead: (id: string) => void;
};

function shortId(): string {
  return (
    "cust_" +
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  );
}

/**
 * Generate a 6-character invite code.
 *
 * Charset excludes 0/O/1/I/L because they look identical in many fonts and
 * confuse users typing codes by hand. Codes are upper-case to make them
 * easy to read aloud ("FL-3K7M2N" instead of "fl-3k7m2n").
 *
 * Collision risk: 31^6 ≈ 887M codes. With a few thousand servers the
 * birthday-paradox probability is still ~vanishing, so we don't bother
 * checking the DB before assigning. If we ever do collide, the second
 * server's insert will succeed (we don't enforce uniqueness via index)
 * and joinByCode will pick whichever row CloudBase returns first —
 * regenerate from settings to fix.
 */
function genInviteCode(): string {
  const charset = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += charset[Math.floor(Math.random() * charset.length)];
  }
  return out;
}

const OFFICIAL_IDS = MOCK_SERVERS.map((s) => s.id);

/**
 * Translate raw CloudBase / network errors into something the user can
 * actually act on. Surfacing "permission denied: cannot write to
 * collection server_members" is useless to a non-technical user; we
 * collapse the common families into short Chinese messages.
 */
function friendlyCloudBaseError(rawMsg: string, fallback: string): string {
  const m = rawMsg.toLowerCase();
  if (m.includes("permission") || m.includes("denied") || m.includes("unauthorized")) {
    return "权限不足或未登录，无法完成操作";
  }
  if (m.includes("quota") || m.includes("rate limit") || m.includes("too many")) {
    return "请求过于频繁，请稍后再试";
  }
  if (m.includes("network") || m.includes("timeout") || m.includes("fetch failed") || m.includes("failed to fetch")) {
    return "网络连接异常，请检查网络后重试";
  }
  if (m.includes("not found") || m.includes("does not exist")) {
    return "目标不存在或已被删除";
  }
  if (m.includes("invalid parameter") || m.includes("params error")) {
    return "请求参数有误";
  }
  // Fall back to the raw message if it's short enough to show directly,
  // otherwise use the generic fallback.
  if (rawMsg && rawMsg.length <= 60) return rawMsg;
  return fallback;
}

export const useServers = create<Store>()((set, get) => ({
  custom: [],
  customRows: [],
  officialOverrides: {},
  preview: null,
  loading: false,
  clearedIds: [],
  markServerRead: (id) =>
    set((s) => ({
      clearedIds: s.clearedIds.includes(id)
        ? s.clearedIds
        : [...s.clearedIds, id],
    })),

  setPreview: (row) => set({ preview: row }),

  refresh: async () => {
    const me = useAuth.getState().user;
    if (!me) {
      set({ custom: [], customRows: [] });
      return;
    }
    if (serversRefreshInFlight) return;
    if (Date.now() - serversLastRefreshAt < SERVERS_REFRESH_MIN_MS) return;
    serversRefreshInFlight = true;
    set({ loading: true });
    try {
      // Step 1: which server ids am I a member of?
      const memberRes = await db
        .collection("server_members")
        .where({ user_id: me.id })
        .limit(500)
        .get();
      const ids = ((memberRes.data || []) as { server_id: string }[])
        .map((m) => m.server_id)
        // Filter out hardcoded official servers; those come from mock-data.
        .filter((id) => !MOCK_SERVERS.some((s) => s.id === id));
      if (ids.length === 0) {
        set({ custom: [], customRows: [], loading: false });
        return;
      }

      // Step 2: load those server rows.
      const res = await db
        .collection("servers")
        .where({ id: dbCmd.in(ids) })
        .limit(500)
        .get();
      const rows = (res.data || []) as ServerDocRow[];
      const ui: Server[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        iconText: r.icon_text,
        iconColor: r.icon_color,
        iconUrl: r.icon_url ?? null,
        numericId: r.numeric_id ?? null,
        is_official: !!r.is_official,
        member_count: r.member_count,
        channels: r.channels,
      }));

      // Also load overrides for official (mock) servers so their icon
      // changes saved by the platform admin are reflected in the UI.
      let officialOverrides: Record<string, Partial<Server>> = {};
      try {
        const offRes = await db
          .collection("servers")
          .where({ id: dbCmd.in(OFFICIAL_IDS) })
          .limit(OFFICIAL_IDS.length + 1)
          .get();
        for (const row of (offRes.data || []) as ServerDocRow[]) {
          officialOverrides[row.id] = {
            name: row.name,
            iconText: row.icon_text,
            iconColor: row.icon_color,
            iconUrl: row.icon_url ?? null,
            // Only carry saved channels through; undefined/null means the
            // admin hasn't customised the layout yet, so MOCK channels win.
            ...(row.channels != null ? { channels: row.channels } : {}),
          };
        }
      } catch {
        /* no overrides stored yet — not an error */
      }

      set({ custom: ui, customRows: rows, officialOverrides, loading: false });
    } catch (e) {
       
      console.warn("[servers] refresh failed:", e);
      set({ loading: false });
    } finally {
      serversRefreshInFlight = false;
      serversLastRefreshAt = Date.now();
    }
  },

  createServer: async ({ name, iconText, iconColor, isPublic = true, iconUrl = null }) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "未登录，无法创建服务器" };
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "服务器名称不能为空" };
    if (trimmed.length > 30) return { ok: false, error: "服务器名称最多 30 字" };

    // Each user may own at most 3 servers (creator role).
    const ownedCount = get().customRows.filter(
      (s) => s.creator_id === me.id,
    ).length;
    if (ownedCount >= 3) {
      return { ok: false, error: "每位用户最多掌握 3 个服务器，请先解散一个再创建。" };
    }

    const serverId = shortId();
    const inviteCode = genInviteCode();
    const numericId = genVanityId();
    const nowIso = new Date().toISOString();
    try {
      // Insert the server row.
      // Minimal starter layout: one text channel + one voice channel.
      // Owners can add more from Server Settings → 频道管理.
      const starterChannels = [
        {
          id: `${serverId}-cat-1`,
          name: "频道",
          channels: [
            { id: `${serverId}-ch-text`, name: "聊天室", type: "text" },
            { id: `${serverId}-ch-voice`, name: "语音频道", type: "voice", maxOccupants: 20 },
          ],
        },
      ];
      await db.collection("servers").add({
        id: serverId,
        name: trimmed,
        icon_text: iconText.slice(0, 2) || trimmed.slice(0, 1),
        icon_color: iconColor,
        icon_url: iconUrl || null,
        creator_id: me.id,
        creator_name: me.username,
        member_count: 1,
        is_official: false,
        is_public: isPublic,
        invite_code: inviteCode,
        numeric_id: numericId,
        channels: starterChannels,
        created_at: nowIso,
      });
      // Insert the creator's membership row.
      await db.collection("server_members").add({
        id: `${serverId}__${me.id}`,
        server_id: serverId,
        user_id: me.id,
        user_name: me.username,
        role: "creator",
        joined_at: nowIso,
      });
      // Refresh local stores so the new server pops in immediately.
      await get().refresh();
      await useServerRoles.getState().refresh();
      return { ok: true, serverId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
       
      console.error(
        "[servers] createServer FAILED — common cause: icon_url dataURL " +
          "is larger than CloudBase's 512KB per-doc cap, OR the `servers` " +
          "collection write rule rejected us (check CLOUDBASE_RULES.md #7). " +
          "Raw error:",
        e,
      );
      return { ok: false, error: msg };
    }
  },

  disbandServer: async (serverId) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "未登录" };
    try {
      // Step 1: fetch & remove membership rows individually
      let memberRes = await db
        .collection("server_members")
        .where({ server_id: serverId })
        .limit(200)
        .get();
      console.log("[disband] step1 members:", memberRes?.data?.length ?? "NO_DATA");
      let memberRows = (memberRes?.data || []) as { _id: string }[];
      for (const row of memberRows) {
        try { await db.collection("server_members").doc(row._id).remove(); } catch {}
      }
      // Paginate if >200
      while (memberRows.length >= 200) {
        memberRes = await db
          .collection("server_members")
          .where({ server_id: serverId })
          .skip(memberRows.length)
          .limit(200)
          .get();
        const next = (memberRes?.data || []) as { _id: string }[];
        if (next.length === 0) break;
        for (const row of next) {
          try { await db.collection("server_members").doc(row._id).remove(); } catch {}
        }
        memberRows = next;
      }
      // Step 2: remove the server row by querying first
      const s = await db
        .collection("servers")
        .where({ id: serverId })
        .limit(1)
        .get();
      const serverRows = (s?.data || []) as { _id: string }[];
      for (const row of serverRows) {
        await db.collection("servers").doc(row._id).remove();
      }
      await get().refresh();
      await useServerRoles.getState().refresh();
      return { ok: true };
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: friendlyCloudBaseError(rawMsg, "解散服务器失败") };
    }
  },

  leaveServer: async (serverId) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    try {
      // Guard: creators must transfer ownership first; we can't allow them
      // to silently abandon members + the server doc itself.
      const myRow = await db
        .collection("server_members")
        .where({ server_id: serverId, user_id: me.id })
        .limit(1)
        .get();
      const r = ((myRow.data || []) as { role?: string }[])[0];
      if (r?.role === "creator") {
        return {
          ok: false,
          error: "领主不能直接离开。请先转让领主或解散服务器。",
        };
      }
      await db
        .collection("server_members")
        .where({ server_id: serverId, user_id: me.id })
        .remove();
      await get().refresh();
      await useServerRoles.getState().refresh();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
       
      console.warn("[servers] leaveServer failed:", e);
      return { ok: false, error: msg };
    }
  },

  joinByCode: async (code) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录后再加入服务器" };
    const cleaned = (code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleaned.length !== 6) {
      return { ok: false, error: "邀请码应为 6 位字母数字" };
    }
    try {
      const res = await db
        .collection("servers")
        .where({ invite_code: cleaned })
        .limit(1)
        .get();
      const row = ((res.data || []) as ServerDocRow[])[0];
      if (!row) {
        return { ok: false, error: "邀请码无效或已过期" };
      }
      const joinResult = await get().joinById(row.id);
      if (!joinResult.ok) {
        return { ok: false, error: friendlyCloudBaseError(joinResult.error || "", "加入服务器失败") };
      }
      return { ok: true, serverId: row.id };
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : String(e);
       
      console.warn("[servers] joinByCode failed:", e);
      return { ok: false, error: friendlyCloudBaseError(rawMsg, "加入服务器失败") };
    }
  },

  joinById: async (serverId) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    try {
      // Idempotent: if I'm already a member, just refresh and succeed.
      const existing = await db
        .collection("server_members")
        .where({ server_id: serverId, user_id: me.id })
        .limit(1)
        .get();
      if ((existing.data || []).length > 0) {
        await get().refresh();
        await useServerRoles.getState().refresh();
        return { ok: true };
      }

      // Verify the server actually exists before writing a stray
      // membership row that would point nowhere.
      const serverRes = await db
        .collection("servers")
        .where({ id: serverId })
        .limit(1)
        .get();
      const serverRow = ((serverRes.data || []) as ServerDocRow[])[0];
      if (!serverRow) {
        return { ok: false, error: "服务器不存在或已被解散" };
      }

      const nowIso = new Date().toISOString();
      await db.collection("server_members").add({
        id: `${serverId}__${me.id}`,
        server_id: serverId,
        user_id: me.id,
        user_name: me.username,
        role: "member",
        joined_at: nowIso,
      });
      // Best-effort bump of member_count. May fail under tight permission
      // rules (only creator can update); ignore the error and let a
      // future cloud-function or recount fix it.
      try {
        await db
          .collection("servers")
          .where({ id: serverId })
          .update({ member_count: (serverRow.member_count || 0) + 1 });
      } catch {
        /* ignore — not authoritative anyway */
      }
      // Optimistic local state update — without this, if refresh() fails
      // (CloudBase read-permission rule, transient network error), the
      // user sees a misleading "网络错误" even though the join itself
      // succeeded and their membership row is persisted.
      if (!OFFICIAL_IDS.includes(serverId)) {
        const uiRow: Server = {
          id: serverRow.id,
          name: serverRow.name,
          iconText: serverRow.icon_text,
          iconColor: serverRow.icon_color,
          iconUrl: serverRow.icon_url ?? null,
          numericId: serverRow.numeric_id ?? null,
          is_official: !!serverRow.is_official,
          member_count: (serverRow.member_count || 0) + 1,
          channels: serverRow.channels,
        };
        const bumpedRow: ServerDocRow = { ...serverRow, member_count: uiRow.member_count || 0 };
        const prev = get().custom;
        if (!prev.some((s) => s.id === serverId)) {
          set({
            custom: [...prev, uiRow],
            customRows: [...get().customRows, bumpedRow],
          });
        }
      }
      // Background refresh — don't block the join UI on it. If it fails
      // (e.g. transient network blip), the optimistic state above still
      // renders correctly and a later tick will reconcile.
      void get().refresh();
      void useServerRoles.getState().refresh();
      // If we were previewing this exact server, clear the preview — the
      // user is now a real member and subsequent UI should not render the
      // read-only join banner.
      if (get().preview?.id === serverId) set({ preview: null });
      return { ok: true };
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : String(e);
      const friendly = friendlyCloudBaseError(rawMsg, "加入服务器失败");
       
      console.warn("[servers] joinById failed:", e);
      return { ok: false, error: friendly };
    }
  },

  regenerateInviteCode: async (serverId) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    const code = genInviteCode();
    try {
      await db
        .collection("servers")
        .where({ id: serverId })
        .update({ invite_code: code });
      await get().refresh();
      return { ok: true, code };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },

  updateServer: async (serverId, patch) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    const dbPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (!n) return { ok: false, error: "服务器名称不能为空" };
      if (n.length > 30) return { ok: false, error: "服务器名称最多 30 字" };
      dbPatch.name = n;
    }
    if (patch.iconText !== undefined) {
      dbPatch.icon_text = patch.iconText.slice(0, 2) || "?";
    }
    if (patch.iconColor !== undefined) {
      dbPatch.icon_color = patch.iconColor;
    }
    if (patch.iconUrl !== undefined) {
      dbPatch.icon_url = patch.iconUrl || null;
    }
    if (patch.channels !== undefined) {
      // null === clear (revert to mock layout). Undefined means "leave alone".
      dbPatch.channels = patch.channels === null ? null : patch.channels;
    }
    if (Object.keys(dbPatch).length === 0) {
      return { ok: false, error: "没有需要保存的改动" };
    }
    const isOfficial = OFFICIAL_IDS.includes(serverId);
    // Optimistic update — patch the in-memory copy right away so the UI
    // (sidebar lock icons, channel list, settings modal) reflects the
    // change without waiting for CloudBase + refresh (~1-3s). If the write
    // fails, we roll back to the snapshot below.
    const prevCustom = get().custom;
    const prevOfficialOverrides = get().officialOverrides;
    const uiPatch: Partial<Server> = {};
    if (patch.name !== undefined) uiPatch.name = (dbPatch.name as string);
    if (patch.iconText !== undefined) uiPatch.iconText = (dbPatch.icon_text as string);
    if (patch.iconColor !== undefined) uiPatch.iconColor = (dbPatch.icon_color as string);
    if (patch.iconUrl !== undefined) uiPatch.iconUrl = (dbPatch.icon_url as string | null);
    if (patch.channels !== undefined) {
      // null (reset) becomes undefined on the UI row so downstream code
      // falls back to DEFAULT_CHANNEL_CATEGORIES.
      uiPatch.channels = (dbPatch.channels as Server["channels"] | null) ?? undefined;
    }
    if (isOfficial) {
      set({
        officialOverrides: {
          ...prevOfficialOverrides,
          [serverId]: { ...(prevOfficialOverrides[serverId] || {}), ...uiPatch },
        },
      });
    } else {
      set({
        custom: prevCustom.map((s) =>
          s.id === serverId ? { ...s, ...uiPatch } : s,
        ),
      });
    }
    try {
      if (isOfficial) {
        // Official servers are hardcoded mocks; their CloudBase doc may not
        // exist yet. Do an upsert: update if the row exists, add if not.
        const existing = await db
          .collection("servers")
          .where({ id: serverId })
          .limit(1)
          .get();
        if ((existing.data || []).length === 0) {
          // First time — seed the document from the mock definition.
          const mock = MOCK_SERVERS.find((s) => s.id === serverId);
          await db.collection("servers").add({
            id: serverId,
            name: (dbPatch.name as string) ?? mock?.name ?? serverId,
            icon_text: (dbPatch.icon_text as string) ?? mock?.iconText ?? "",
            icon_color: (dbPatch.icon_color as string) ?? mock?.iconColor ?? "#888",
            icon_url: (dbPatch.icon_url as string | null) ?? null,
            is_official: true,
            member_count: 0,
            channels: dbPatch.channels ?? null,
            created_at: new Date().toISOString(),
          });
        } else {
          await db.collection("servers").where({ id: serverId }).update(dbPatch);
        }
      } else {
        await db.collection("servers").where({ id: serverId }).update(dbPatch);
      }
      // Background-refresh (don't await) so any server-side transforms
      // (e.g. sanitisation / derived fields) eventually reconcile into the
      // UI, without blocking the save dialog from closing.
      void get().refresh();
      return { ok: true };
    } catch (e) {
      // Roll back the optimistic update on failure.
      set({ custom: prevCustom, officialOverrides: prevOfficialOverrides });
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = friendlyCloudBaseError(msg, "保存失败");
      return { ok: false, error: friendly };
    }
  },

  setPublic: async (serverId, isPublic) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    try {
      await db
        .collection("servers")
        .where({ id: serverId })
        .update({ is_public: isPublic });
      await get().refresh();
      return { ok: true };
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: friendlyCloudBaseError(rawMsg, "切换私密状态失败") };
    }
  },

  browsePublic: async (search) => {
    try {
      const res = await db
        .collection("servers")
        .where({ is_public: true })
        .limit(100)
        .get();
      let rows = (res.data || []) as ServerDocRow[];
      const q = (search || "").trim();
      if (q) {
        rows = rows.filter((r) =>
          r.name.toLowerCase().includes(q.toLowerCase()),
        );
      }
      // Sort: most members first, then most recent.
      rows.sort((a, b) => {
        if ((b.member_count || 0) !== (a.member_count || 0)) {
          return (b.member_count || 0) - (a.member_count || 0);
        }
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
      return rows;
    } catch (e) {
       
      console.warn("[servers] browsePublic failed:", e);
      return [];
    }
  },
}));

/** Look up the full DocRow (including invite_code) for a server I'm in. */
export function useMyServerRow(serverId: string | null): ServerDocRow | null {
  return useServers((s) => {
    if (!serverId) return null;
    return s.customRows.find((r) => r.id === serverId) || null;
  });
}

/** Returns the merged list: official mocks + my custom servers + any
 * previewed (non-joined) server. The preview is last so it doesn't
 * accidentally shadow a real joined copy (the `joinById` clears it anyway
 * on success, but a transient race would be benign). */
export function useAllServers(): Server[] {
  const custom = useServers((s) => s.custom);
  const preview = useServers((s) => s.preview);
  const clearedIds = useServers((s) => s.clearedIds);
  const officialOverrides = useServers((s) => s.officialOverrides);
  const base: Server[] = [
    // Apply any CloudBase overrides (icon/name/channels) saved by platform admin.
    ...MOCK_SERVERS.map((s) =>
      officialOverrides[s.id] ? { ...s, ...officialOverrides[s.id] } : s,
    ),
    ...custom,
  ].map((s) =>
    clearedIds.includes(s.id) ? { ...s, unread: 0 } : s,
  );
  if (preview && !base.some((s) => s.id === preview.id)) {
    base.push({
      id: preview.id,
      name: preview.name,
      iconText: preview.icon_text,
      iconColor: preview.icon_color,
      iconUrl: preview.icon_url ?? null,
      numericId: preview.numeric_id ?? null,
      is_official: !!preview.is_official,
      member_count: preview.member_count,
    });
  }
  return base;
}

/**
 * True if the current user is a real member of `serverId`. Official mock
 * servers are always considered "joined" (there's no `server_members` row
 * for them but every logged-in user implicitly has access). For custom
 * servers we check the `custom` list populated by `refresh()`. The preview
 * server explicitly returns false so the UI can lock the composer.
 */
export function useIsServerMember(serverId: string | null | undefined): boolean {
  return useServers((s) => {
    if (!serverId) return false;
    if (MOCK_SERVERS.some((m) => m.id === serverId)) return true;
    return s.custom.some((c) => c.id === serverId);
  });
}

/** Bootstrap hook — wire into AuthBootstrap.
 *
 * Refreshes the server roster:
 *   - immediately on login,
 *   - every 60s while the tab is alive,
 *   - whenever the tab regains focus / visibility.
 *
 * The periodic + focus refresh is what lets channel-level changes (e.g. an
 * admin locking a channel from another tab) reach members within seconds
 * instead of being frozen until the next login. Without this, a member who
 * had the page open before the admin's edit could keep posting in a now-
 * locked channel because their local activeChannel.readonly was stale.
 */
export function useServersBootstrap() {
  const user = useAuth((s) => s.user);
  const refresh = useServers((s) => s.refresh);
  useEffect(() => {
    if (!user) return;
    void refresh();
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) void refresh();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
    }
    let watchMembers: { close: () => void } | null = null;
    let watchServers: { close: () => void } | null = null;
    try {
      watchMembers = db.collection("server_members").where({ user_id: user.id }).watch({
        onChange: () => void refresh(),
        onError: () => {},
      });
      watchServers = db.collection("servers").where({ creator_id: user.id }).watch({
        onChange: () => void refresh(),
        onError: () => {},
      });
    } catch { /* fallback to focus/visibility only */ }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
      }
      try { watchMembers?.close(); } catch { /* ignore */ }
      try { watchServers?.close(); } catch { /* ignore */ }
    };
  }, [user, refresh]);
}
