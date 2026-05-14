"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePresence, type PresenceUser } from "@/lib/use-presence";
import { useAuth } from "@/lib/auth-store";
import {
  useFriendStatusFor,
  useIsBlocked,
  useSocial,
} from "@/lib/social-store";
import { cn } from "@/lib/utils";
import { displayUsername } from "@/lib/deleted-user";
import { MemberListSkeleton } from "@/components/Skeleton";
import { db, dbCmd } from "@/lib/cloudbase";
import Avatar from "@/components/Avatar";
import { servers as MOCK_SERVERS } from "@/lib/mock-data";
import {
  isAnyStaffId,
  getStaffTier,
  canMuteInServer,
  canBanUsers,
} from "@/lib/roles";
import { getActiveMuteFor, revokeMutesFor, type MuteRow } from "@/lib/mute-store";
import { recordAuditEvent } from "@/lib/audit-log";
import { supabase } from "@/lib/supabase";
import StaffBadge, { staffNameClass } from "@/components/AdminBadge";
import MuteDialog from "@/components/MuteDialog";
import BanDialog from "@/components/BanDialog";
import { alert } from "@/lib/confirm-store";

export type MemberSeed = {
  user_id: string;
  username: string;
  avatar: string;
  avatar_color: string;
  avatar_url?: string | null;
};

/**
 * Roster entry resolved from `server_members` + `profiles`. Used for the
 * offline section — for online members we always prefer the live presence
 * payload (fresher status, latest avatar).
 */
type RosterMember = {
  user_id: string;
  username: string;
  avatar: string;
  avatar_color: string;
  avatar_url?: string | null;
  /** KOOK / Discord style role grouping. Defaults to "member" when the
   *  `server_members` row has no role field (legacy data). */
  role: "creator" | "admin" | "member";
};

type RoleKey = "creator" | "admin" | "member";

const ROLE_LABEL: Record<RoleKey, string> = {
  creator: "领主",
  admin: "主教",
  member: "成员",
};

const ROLE_COLOR: Record<RoleKey, string> = {
  creator: "var(--warning)",    // gold-ish for founder
  admin: "var(--accent)",       // platform accent (purple) for admins
  member: "var(--text-muted)",  // neutral for members
};

const ROLE_ORDER: RoleKey[] = ["creator", "admin", "member"];

export default function MemberList({
  room = "global",
  onOpenDm,
  onOpenProfileCard,
}: {
  room?: string;
  /** Optional handler fired when a non-self member row is left-clicked. */
  onOpenDm?: (user: PresenceUser) => void;
  /** Optional handler to surface the floating profile card at given screen point. */
  onOpenProfileCard?: (target: MemberSeed, anchor: { x: number; y: number }) => void;
}) {
  // KOOK / Discord-style: read GLOBAL presence (any logged-in user)
  // and cross-reference with this server's roster (server_members).
  // The result: this server's online members appear in the "在线"
  // section regardless of which channel they're currently viewing,
  // and members not currently logged in show in the "离线" section.
  // `room` here is the server id, used only to fetch the roster.
  // Pass `room` as currentServerId so this client broadcasts which server
  // it's currently viewing — official-server panels filter by this field.
  const presenceUsers = usePresence("global", room !== "global" ? room : undefined);
  const { user: me } = useAuth();
  const blockedIds = useSocial((s) => s.blockedIds);
  const blockedSet = new Set(blockedIds);
  const [menu, setMenu] = useState<{ x: number; y: number; user: PresenceUser } | null>(null);
  // Hysteresis for the mock-server `current_server_id === room`
  // filter. CloudBase's presence poll occasionally returns a stale
  // snapshot where a user's `current_server_id` flips back to an old
  // value for one tick before snapping forward again — visible as
  // users "blinking in and out" of the right-side member panel
  // ("用户在闪现"). We stabilize by maintaining a separate
  // `stablePresenceUsers` state that retains a user for up to 5s
  // after their last "pass" of the filter, even if subsequent ticks
  // claim they aren't here. The retention is updated in a useEffect
  // (post-render side effect) so we never read refs / call Date.now()
  // during render — keeping the component compatible with React's
  // pure-render rules.
  const filterPassAtRef = useRef<Map<string, number>>(new Map());
  const [stablePresenceUsers, setStablePresenceUsers] =
    useState<PresenceUser[]>([]);
  // Staff dialogs are lifted up here (out of ContextMenu) so the menu's
  // own click-outside handler can't accidentally close the dialog
  // before it's interactive. They render as siblings of the menu in the
  // aside, which gives them their own stacking context.
  const [muteTarget, setMuteTarget] = useState<PresenceUser | null>(null);
  const [banTarget, setBanTarget] = useState<PresenceUser | null>(null);

  // Full roster (online + offline) for the active server, resolved from
  // `server_members` + `profiles`. Bundled with its `room` key so the
  // byRole memo can detect when it's for a DIFFERENT server than the
  // one currently displayed (happens during the render between a
  // `room` prop change and the effect running).
  //
  // Before this was bundled, a `room` change produced a stale render
  // where `roster` still held the PREVIOUS server's members but
  // `rosterFetched` was still true — the memo believed it had fresh
  // data and went into the custom-server branch, flashing the old
  // server's members in the new server's panel for ~1 frame.
  type RosterBundle = { room: string; members: RosterMember[] };
  const [rosterBundle, setRosterBundle] = useState<RosterBundle | null>(
    null,
  );
  // Derived: is the bundle valid for the currently-rendered room?
  // Consumed by the byRole memo to decide lobby-view vs custom-view.
  const rosterReady = rosterBundle?.room === room;
  const roster: RosterMember[] = rosterReady ? rosterBundle!.members : [];
  const rosterFetched = rosterReady;

  useEffect(() => {
    let cancelled = false;
    // Skip DB fetch for the global lobby and mock/official servers
    // (no server_members rows exist for them). Querying them caused
    // the skeleton to stay permanently on slow or failed requests.
    const isMock = !room || room === "global" || MOCK_SERVERS.some((s) => s.id === room);
    if (isMock) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setRosterBundle({ room, members: [] });
      });
      return () => {
        cancelled = true;
      };
    }
    // Safety net: if CloudBase hangs without rejecting, resolve after 6s
    // so the skeleton doesn't stay forever on flaky connections.
    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timeoutId = null;
      if (cancelled) return;
      console.warn("[member-list] roster fetch timed out, showing empty roster");
      setRosterBundle({ room, members: [] });
    }, 6000);
    const clearTO = () => {
      if (timeoutId != null) { clearTimeout(timeoutId); timeoutId = null; }
    };
    (async () => {
      try {
        // 1) Membership rows for this server.
        const memRes = await db
          .collection("server_members")
          .where({ server_id: room })
          .limit(500)
          .get();
        const members = (memRes.data || []) as Array<{
          user_id: string;
          user_name?: string;
          role?: "creator" | "admin" | "member";
        }>;
        if (members.length === 0) {
          clearTO();
          if (!cancelled) setRosterBundle({ room, members: [] });
          return;
        }
        // 2) Batch profile fetch so offline rows have a real avatar.
        const ids = members.map((m) => m.user_id);
        const profRes = await db
          .collection("profiles")
          .where({ id: dbCmd.in(ids) })
          .limit(500)
          .get();
        const profiles = (profRes.data || []) as Array<{
          id: string;
          username?: string;
          avatar?: string;
          avatar_color?: string;
          avatar_url?: string | null;
        }>;
        const profById = new Map(profiles.map((p) => [p.id, p]));
        const merged: RosterMember[] = members.map((m) => {
          const p = profById.get(m.user_id);
          const username = p?.username ?? m.user_name ?? "未知用户";
          return {
            user_id: m.user_id,
            username,
            avatar: p?.avatar ?? username.slice(0, 1),
            avatar_color: p?.avatar_color ?? "#555",
            avatar_url: p?.avatar_url ?? null,
            role: m.role ?? "member",
          };
        });
        clearTO();
        if (!cancelled) setRosterBundle({ room, members: merged });
      } catch (e) {
        clearTO();
        console.warn("[member-list] roster fetch failed:", e);
        if (!cancelled) setRosterBundle({ room, members: [] });
      }
    })();
    return () => {
      cancelled = true;
      clearTO();
    };
  }, [room]);

  // Loading skeleton: shown for at least 400ms after every `room`
  // change so the right-panel transition feels consistent with
  // ChatView's message skeleton on the left and ChannelSidebar's
  // channel skeleton in the middle. ALSO shown until the roster
  // bundle resolves for this room AND we have non-empty presence
  // (covers genuine cold-load latency for custom servers). The
  // 400ms timer is the floor; data-driven conditions can extend it.
  const [skelTimerActive, setSkelTimerActive] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSkelTimerActive(true);
    const t = setTimeout(() => setSkelTimerActive(false), 400);
    return () => clearTimeout(t);
  }, [room]);
  const isRosterLoading = !rosterFetched;
  // Removed `isPresenceLoading` (presenceUsers.length === 0) from this
  // gate: an empty presence list is a *valid* steady state (no one
  // online), not a loading state. Keeping it caused the skeleton to
  // show indefinitely after a dev-server restart or slow WS reconnect,
  // hiding the member list even when the user themselves were online.
  const showLoadingSkeleton = skelTimerActive || isRosterLoading;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // Compute role-grouped online buckets + a single flat offline list.
  // - For CUSTOM servers (we have a roster from server_members):
  //   - "onlineByRole[role]" = roster members of that role who are
  //     currently in global presence, merged with their fresh presence
  //     fields (status/avatar/device_type/activity).
  //   - "offline" = roster − presence, collapsed across roles (Discord
  //     does the same — offline section isn't subdivided by role).
  // - For the GLOBAL lobby (no roster, room === "global"): fall back
  //   to the legacy "show every globally-online user" under the
  //   "member" bucket so rendering code stays uniform.
  const { onlineByRole, offline, totalOnline } = useMemo(() => {
    const presenceById = new Map(presenceUsers.map((u) => [u.user_id, u]));
    const byRole: Record<RoleKey, (PresenceUser & { role: RoleKey })[]> = {
      creator: [],
      admin: [],
      member: [],
    };
    // Official / mock servers have no server_members rows — use presence
    // filtered by current_server_id. Custom servers use the DB roster.
    //
    // While the roster fetch is still in flight for a custom server,
    // we *also* take the presence-only path below as a temporary view.
    // This is what makes the right sidebar show people INSTANTLY on
    // server switch (vs. waiting 1-2s for the roster query). When the
    // roster lands, the memo re-runs and upgrades to the full
    // role-grouped + offline view.
    const isMockServer = !room || room === "global" || MOCK_SERVERS.some((s) => s.id === room);
    const useLobbyView = isMockServer || !rosterFetched;
    if (useLobbyView) {
      // Official / mock server: show only users currently viewing this server
      // (matched via current_server_id broadcast in their presence state).
      // True lobby (no room): show everyone.
      //
      // Platform admins (NEXT_PUBLIC_ADMIN_USER_IDS) get split into their
      // own "主教" bucket above "成员" so they're visually distinct
      // from regular users in official channels too — matching the
      // role-group layout that custom servers already have.
      // Offline members are intentionally NOT shown for mock/official
      // servers: these aren't real rosters (everyone is implicitly a
      // member), so an "offline — 1000" list would be meaningless.
      // Always include the local user: `use-presence`'s effect #2 takes
      // ~1s to rebroadcast their current_server_id after a server
      // switch, and filtering by stale current_server_id would pop the
      // user out of "their own" server's member list for that window.
      // Since MemberList is mounted with `room=X`, by definition we
      // ARE on X, so self qualifies regardless of what presence says.
      // Filtering rules:
      //   - Global lobby (no `room` / room === "global"): show every
      //     logged-in user.
      //   - Mock / official server: show only users currently viewing
      //     this server (`current_server_id === room`).
      //   - Custom server WHILE roster is still fetching: show every
      //     logged-in user as a broad preview. Non-members may briefly
      //     appear, but this beats showing an empty sidebar for 1–3s
      //     while the server_members + profiles queries round-trip.
      //     Once `rosterFetched` flips true, the custom-server branch
      //     below replaces this view with the authoritative roster.
      //   - Either way, ALWAYS include the local user — their
      //     `current_server_id` broadcast takes ~1s to catch up after
      //     a server switch and we don't want to pop them out of
      //     their own member list in the meantime.
      // Use the hysteresis-stabilized list (see effect below). The
      // filtering policy itself ("only users whose current_server_id
      // matches this room, plus self") lives in that effect; here we
      // only need to drop blocked users and sort.
      const sorted = stablePresenceUsers
        .filter((u) => !blockedSet.has(u.user_id))
        .sort((a, b) => {
          if (a.user_id === me?.id) return -1;
          if (b.user_id === me?.id) return 1;
          return a.username.localeCompare(b.username);
        });
      for (const u of sorted) {
        // Map platform staff tier to the correct role bucket so the
        // section label matches the badge:
        //   founder        → "creator"  bucket (label: 领主, 金冠)
        //   admin / mod    → "admin"    bucket (label: 主教, 盾 / 书记官, 星)
        //   regular player → "member"   bucket (label: 成员)
        // Previously EVERY staff tier went to "admin", so founders in
        // official servers got listed under 主教 — which contradicted
        // their 👑 badge / 领主 title.
        const tier = getStaffTier(u.user_id);
        const bucket: RoleKey =
          tier === "founder" ? "creator" : tier ? "admin" : "member";
        byRole[bucket].push({ ...u, role: bucket });
      }
      return {
        onlineByRole: byRole,
        offline: [] as RosterMember[],
        totalOnline: sorted.length,
      };
    }
    // Custom server: group by role, with fresh presence data merged in.
    // Platform-level admins (NEXT_PUBLIC_ADMIN_USER_IDS) are forcibly
    // promoted to the "admin" bucket regardless of their server_members
    // role. Site-wide staff should always be visible as such in any
    // server they visit — even if the server owner gave them only the
    // default "member" role.
    const visibleRoster = roster.filter((m) => !blockedSet.has(m.user_id));
    const addedIds = new Set<string>();
    for (const m of visibleRoster) {
      const p = presenceById.get(m.user_id);
      if (!p) continue;
      const effectiveRole: RoleKey =
        m.role === "creator"
          ? "creator"
          : isAnyStaffId(m.user_id)
            ? "admin"
            : m.role;
      byRole[effectiveRole].push({
        user_id: m.user_id,
        username: p.username || m.username,
        avatar: p.avatar || m.avatar,
        avatar_color: p.avatar_color || m.avatar_color,
        avatar_url: p.avatar_url ?? m.avatar_url ?? null,
        status: p.status,
        device_type: p.device_type,
        activity: p.activity,
        online_at: p.online_at,
        role: m.role,
      });
      addedIds.add(m.user_id);
    }
    // Sort each bucket: self first, then alphabetical.
    for (const k of ROLE_ORDER) {
      byRole[k].sort((a, b) => {
        if (a.user_id === me?.id) return -1;
        if (b.user_id === me?.id) return 1;
        return a.username.localeCompare(b.username);
      });
    }
    const offlineList = visibleRoster
      .filter((m) => !presenceById.has(m.user_id))
      // Preserve role ordering in offline too so structure feels
      // consistent with the online buckets above.
      .sort((a, b) => {
        const roleDelta = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
        if (roleDelta !== 0) return roleDelta;
        return a.username.localeCompare(b.username);
      });
    const total =
      byRole.creator.length + byRole.admin.length + byRole.member.length;
    return {
      onlineByRole: byRole,
      offline: offlineList,
      totalOnline: total,
    };
    // blockedSet is a fresh object each render — depend on the source array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceUsers, stablePresenceUsers, roster, rosterFetched, me?.id, blockedIds, room]);

  // Hysteresis driver: rebuild `stablePresenceUsers` from the live
  // `presenceUsers` whenever it ticks. Users whose
  // `current_server_id` matches this `room` (or who are self) get a
  // fresh "last passed" timestamp; others stay in the list as long
  // as their last-pass was within HYSTERESIS_MS, then get evicted.
  // This smooths out single-tick CloudBase poll jitter where a
  // user's `current_server_id` momentarily flips back to a stale
  // value, which used to manifest as visible blinking in the panel.
  useEffect(() => {
    const HYSTERESIS_MS = 1_500;
    const now = Date.now();
    const passMap = filterPassAtRef.current;
    // Update timestamps for live presence rows that pass the filter.
    for (const u of presenceUsers) {
      const passes =
        !room ||
        room === "global" ||
        u.current_server_id === room ||
        u.user_id === me?.id;
      if (passes) passMap.set(`${room}|${u.user_id}`, now);
    }
    // Drop expired entries (truly gone for >HYSTERESIS_MS).
    for (const [k, t] of passMap) {
      if (now - t > HYSTERESIS_MS) passMap.delete(k);
    }
    // Final list = live presence rows whose key is still in passMap
    // (either passed this tick or recently within hysteresis window).
    const next = presenceUsers.filter((u) => {
      if (!room || room === "global") return true;
      return passMap.has(`${room}|${u.user_id}`);
    });
    setStablePresenceUsers(next);
  }, [presenceUsers, room, me?.id]);

  const openContextMenu = (e: React.MouseEvent, user: PresenceUser) => {
    e.preventDefault();
    e.stopPropagation();
    // Clamp menu within viewport (menu ~200x230)
    const x = Math.min(e.clientX, window.innerWidth - 210);
    const y = Math.min(e.clientY, window.innerHeight - 240);
    setMenu({ x, y, user });
  };

  return (
    <aside className="w-[324px] shrink-0 bg-[var(--bg-darker)] overflow-y-auto py-4">
      {/* Skeleton — replaces the entire list (not overlaid) so a
          server-switch always shows the placeholder for the
          guaranteed 400ms window even when the previous server's
          stale presence rows haven't been filtered out yet. */}
      {showLoadingSkeleton ? <MemberListSkeleton /> : null}
      {!showLoadingSkeleton && totalOnline === 0 && offline.length === 0 && (
        <div className="px-4 py-2 text-sm text-[var(--text-muted)] italic">
          无人在线…
        </div>
      )}
      {!showLoadingSkeleton && ROLE_ORDER.map((roleKey) => {
        const bucket = onlineByRole[roleKey];
        if (bucket.length === 0) return null;
        return (
          <section key={roleKey} className="mb-3">
            <h3
              className="px-4 mb-1 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: ROLE_COLOR[roleKey] }}
            >
              {ROLE_LABEL[roleKey]} — {bucket.length}
            </h3>
            <ul>
              {bucket.map((m) => {
                const isMe = m.user_id === me?.id;
                return (
                  <MemberRow
                    key={`on-${m.user_id}`}
                    userId={m.user_id}
                    name={displayUsername(m.username)}
                    avatar={m.avatar}
                    color={m.avatar_color}
                    avatarUrl={m.avatar_url ?? null}
                    status={m.status === "away" ? "away" : "online"}
                    isMe={isMe}
                    isAdmin={isAnyStaffId(m.user_id)}
                    mobile={m.device_type === "app"}
                    activity={m.activity}
                    roleColor={ROLE_COLOR[roleKey]}
                    // Left-click opens the floating profile card so users
                    // can preview each other before deciding to DM. The
                    // "发起私信" button now lives in that card and the
                    // right-click menu, mirroring Discord/KOOK conventions.
                    onClick={
                      !isMe && onOpenProfileCard
                        ? (e) =>
                            onOpenProfileCard(
                              {
                                user_id: m.user_id,
                                username: m.username,
                                avatar: m.avatar,
                                avatar_color: m.avatar_color,
                                avatar_url: m.avatar_url ?? null,
                              },
                              { x: e.clientX, y: e.clientY },
                            )
                        : undefined
                    }
                    onContextMenu={
                      isMe
                        ? (e) => e.preventDefault()
                        : (e) => openContextMenu(e, m)
                    }
                  />
                );
              })}
            </ul>
          </section>
        );
      })}

      {!showLoadingSkeleton && offline.length > 0 && (
        <section>
          <h3 className="px-4 mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            离线 — {offline.length}
          </h3>
          <ul>
            {offline.map((m) => {
              const seedUser: PresenceUser = {
                user_id: m.user_id,
                username: m.username,
                avatar: m.avatar,
                avatar_color: m.avatar_color,
                avatar_url: m.avatar_url ?? null,
                online_at: "",
              };
              return (
                <MemberRow
                  key={`off-${m.user_id}`}
                  userId={m.user_id}
                  name={displayUsername(m.username)}
                  avatar={m.avatar}
                  color={m.avatar_color}
                  avatarUrl={m.avatar_url ?? null}
                  status="offline"
                  isMe={false}
                  isAdmin={isAnyStaffId(m.user_id)}
                  roleColor={ROLE_COLOR[m.role]}
                  onClick={
                    onOpenProfileCard
                      ? (e) =>
                          onOpenProfileCard(seedUser, {
                            x: e.clientX,
                            y: e.clientY,
                          })
                      : undefined
                  }
                  onContextMenu={(e) => openContextMenu(e, seedUser)}
                />
              );
            })}
          </ul>
        </section>
      )}

      {menu && (
        <ContextMenu
          target={menu.user}
          x={menu.x}
          y={menu.y}
          serverId={room ?? null}
          onOpenDm={onOpenDm}
          onOpenProfileCard={onOpenProfileCard}
          onClose={() => setMenu(null)}
          onRequestMute={(t) => {
            setMenu(null);
            setMuteTarget(t);
          }}
          onRequestBan={(t) => {
            setMenu(null);
            setBanTarget(t);
          }}
        />
      )}
      {muteTarget && (
        <MuteDialog
          targetUserId={muteTarget.user_id}
          targetUserName={muteTarget.username}
          serverId={room ?? null}
          onClose={() => setMuteTarget(null)}
        />
      )}
      {banTarget && (
        <BanDialog
          targetUserId={banTarget.user_id}
          targetUserName={banTarget.username}
          onClose={() => setBanTarget(null)}
        />
      )}
    </aside>
  );
}

// ============================================================
// Right-click menu (extracted so it can call hooks)
// ============================================================
function ContextMenu({
  target,
  x,
  y,
  serverId,
  onOpenDm,
  onOpenProfileCard,
  onClose,
  onRequestMute,
  onRequestBan,
}: {
  target: PresenceUser;
  x: number;
  y: number;
  /** Current server id (`null` for global lobby). Used to gate the
   *  staff actions — mods can only mute within the official server. */
  serverId: string | null;
  onOpenDm?: (user: PresenceUser) => void;
  onOpenProfileCard?: (
    seed: { user_id: string; username: string; avatar: string; avatar_color: string },
    anchor: { x: number; y: number },
  ) => void;
  onClose: () => void;
  /** Bubble staff-action requests up to MemberList so it can render
   *  the dialogs in its own stacking context (not nested inside this
   *  menu). Without this, the menu's window-level click handler races
   *  with the dialog's mount and the dialog never becomes interactive. */
  onRequestMute: (target: PresenceUser) => void;
  onRequestBan: (target: PresenceUser) => void;
}) {
  const me = useAuth((s) => s.user);
  const { status: friendStatus } = useFriendStatusFor(target.user_id);
  const isBlocked = useIsBlocked(target.user_id);
  const { sendFriendRequest, blockUser, unblockUser } = useSocial();
  const [busy, setBusy] = useState(false);
  // Staff cannot moderate themselves — silently hide the buttons in
  // that case rather than letting them try and fail at write time.
  const isSelf = me?.id === target.user_id;
  const isTargetStaff = isAnyStaffId(target.user_id);
  const canMute =
    !!me && !isSelf && !isTargetStaff && canMuteInServer(me.id, serverId);
  const canBan = !!me && !isSelf && !isTargetStaff && canBanUsers(me.id);

  // Look up whether the target currently has an active mute, so the
  // menu can offer "解除禁言" instead of (and disable) "临时禁言…".
  // Best-effort: a missing collection or transient failure simply
  // leaves the toggle in its default "not muted" state.
  const [targetMute, setTargetMute] = useState<MuteRow | null>(null);
  useEffect(() => {
    if (!canMute) return;
    let cancelled = false;
    void (async () => {
      const row = await getActiveMuteFor(target.user_id);
      if (!cancelled) setTargetMute(row);
    })();
    return () => {
      cancelled = true;
    };
  }, [canMute, target.user_id]);

  const handleRevokeMute = async () => {
    if (!me || !targetMute) return;
    setBusy(true);
    const res = await revokeMutesFor(target.user_id);
    setBusy(false);
    if (!res.ok) {
      void alert("解除禁言失败：" + res.message);
      return;
    }
    // Force the target's client to refresh their useMute state so the
    // composer unlocks within seconds (vs waiting on the 60s polling
    // fallback). Same channel as MuteDialog uses for issue.
    void supabase.from("kick_signals").insert({
      target_user_id: target.user_id,
      target_channel_id: null,
      issued_by: me.id,
      issued_by_name: me.username,
      issued_at: new Date().toISOString(),
      reason: "mute-changed",
    });
    recordAuditEvent({
      actor_id: me.id,
      actor_name: me.username,
      action: "revoke_mute",
      target_type: "user",
      target_id: target.user_id,
      target_label: `${target.username} / 解除前剩余 ${Math.max(
        1,
        Math.round(
          (new Date(targetMute.expires_at).getTime() - Date.now()) / 60_000,
        ),
      )} 分钟`,
    });
    setTargetMute(null);
    onClose();
  };

  const seed = {
    user_id: target.user_id,
    username: target.username,
    avatar: target.avatar,
    avatar_color: target.avatar_color,
    avatar_url: target.avatar_url ?? null,
  };

  const friendBtn = (() => {
    switch (friendStatus) {
      case "accepted":
        return { label: "已是好友", disabled: true };
      case "pending_outgoing":
        return { label: "请求已发出", disabled: true };
      case "pending_incoming":
        return { label: "接受好友请求", disabled: false };
      default:
        return { label: "加好友", disabled: false };
    }
  })();

  const handleFriend = async () => {
    if (friendBtn.disabled) return;
    setBusy(true);
    if (friendStatus === "pending_incoming") {
      // accept via store; need friendship id — easiest: re-find it
      const fs = useSocial.getState().friendships.find(
        (f) =>
          (f.requester_id === target.user_id && f.status === "pending"),
      );
      if (fs) await useSocial.getState().acceptFriendRequest(fs.id);
    } else {
      await sendFriendRequest(seed);
    }
    setBusy(false);
    onClose();
  };

  const handleBlockToggle = async () => {
    setBusy(true);
    if (isBlocked) await unblockUser(target.user_id);
    else await blockUser(seed);
    setBusy(false);
    onClose();
  };

  return (
    <div
      className="fixed z-50 min-w-[200px] rounded-md border border-[var(--bg-mid)] bg-[var(--bg-darker)] shadow-2xl py-1 text-sm"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--bg-mid)]/60 truncate">
        {target.username}
      </div>
      <MenuItem
        label="查看资料"
        disabled={!onOpenProfileCard}
        onClick={() => {
          if (onOpenProfileCard) onOpenProfileCard(seed, { x, y });
          onClose();
        }}
      />
      <MenuItem
        label="发起私信"
        disabled={!onOpenDm}
        onClick={() => {
          if (onOpenDm) onOpenDm(target);
          onClose();
        }}
      />
      <MenuItem
        label={friendBtn.label}
        disabled={busy || friendBtn.disabled}
        onClick={handleFriend}
      />
      <MenuItem
        label="复制名字"
        onClick={() => {
          navigator.clipboard?.writeText(target.username).catch(() => {});
          onClose();
        }}
      />
      <MenuItem
        label="@ 提及"
        onClick={() => {
          document.dispatchEvent(
            new CustomEvent("fl:mention", {
              detail: { username: target.username },
              bubbles: true,
            }),
          );
          onClose();
        }}
      />
      <div className="my-1 border-t border-[var(--bg-mid)]/60" />
      <MenuItem
        label={isBlocked ? "解除屏蔽" : "屏蔽用户"}
        danger={!isBlocked}
        warning={isBlocked}
        disabled={busy}
        onClick={handleBlockToggle}
      />
      {/* Staff actions — only render the section if at least one is
          available. Keeps the menu clean for regular players. */}
      {(canMute || canBan) && (
        <>
          <div className="my-1 border-t border-[var(--bg-mid)]/60" />
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            主教操作
          </div>
          {canMute &&
            (targetMute ? (
              // Already muted → offer revoke instead of stacking another
              // mute on top. Stacking would be confusing for the target
              // user and lead to "为什么主教一直禁我" reports.
              <MenuItem
                label={busy ? "解除中…" : "解除禁言"}
                warning
                disabled={busy}
                onClick={handleRevokeMute}
              />
            ) : (
              <MenuItem
                label="临时禁言…"
                warning
                onClick={() => onRequestMute(target)}
              />
            ))}
          {canBan && (
            <MenuItem
              label="永久封禁…"
              danger
              onClick={() => onRequestBan(target)}
            />
          )}
        </>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  disabled,
  danger,
  warning,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  warning?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        danger
          ? "text-[var(--danger)] hover:bg-[var(--danger)]/10"
          : warning
            ? "text-[var(--warning)] hover:bg-[var(--warning)]/10"
            : "text-[var(--text-normal)] hover:bg-[var(--bg-mid)]",
      )}
    >
      {label}
    </button>
  );
}

function MemberRow({
  userId,
  name,
  avatar,
  color,
  avatarUrl,
  status,
  isMe,
  isAdmin,
  mobile,
  activity,
  roleColor,
  onClick,
  onContextMenu,
}: {
  /** CloudBase user id. Passed down so the badge can look up which
   *  staff tier this user belongs to (founder/admin/mod). Required
   *  whenever `isAdmin` is true. */
  userId: string;
  name: string;
  avatar: string;
  color: string;
  avatarUrl?: string | null;
  status?: "online" | "away" | "offline";
  isMe: boolean;
  /** Show staff badge after the name. Badge style auto-picks by tier. */
  isAdmin?: boolean;
  /** User is online via mobile App. Shown as a phone overlay on avatar. */
  mobile?: boolean;
  /** Free-form activity ("正在玩三角洲行动") — shown as small subline. */
  activity?: string;
  /** Name color — tints the username to match the member's server role. */
  roleColor?: string;
  /** Receives the originating MouseEvent so the caller can position
   *  popovers (e.g., the profile card) next to the cursor. */
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const interactive = !!onClick;
  const offline = status === "offline";
  const dotClass =
    status === "away"
      ? "bg-[var(--warning)]"
      : status === "offline"
        ? "bg-[var(--text-muted)]"
        : "bg-[var(--success)]";
  const dotTitle =
    status === "away" ? "离开" : status === "offline" ? "离线" : "在线";
  return (
    <li
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={
        interactive
          ? activity
            ? `${name} — ${activity}\n(右键更多)`
            : `与 ${name} 私信（右键更多）`
          : undefined
      }
      className={cn(
        "mx-2 px-2 py-2 rounded flex items-center gap-2.5 transition-colors",
        interactive
          ? "cursor-pointer hover:bg-[var(--bg-mid)]"
          : "cursor-default",
        offline && "opacity-60",
      )}
    >
      <div className="relative shrink-0">
        <Avatar
          text={avatar}
          color={color}
          url={avatarUrl}
          size={36}
          mobile={!!mobile && !offline}
          className={cn(offline && "grayscale")}
        />
        {/* Status dot: hide when we're showing the phone badge in the
            same corner so they don't overlap. Mobile users' "I'm online"
            signal is the phone icon itself. */}
        {!(mobile && !offline) && (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[var(--bg-darker)]",
              dotClass,
            )}
            title={dotTitle}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-[15px] font-medium truncate flex items-center gap-1",
            offline && "text-[var(--text-muted)]",
            // Platform admins render with the shared red-name class —
            // it trumps the per-server roleColor so platform staff are
            // recognizable regardless of whatever color a server owner
            // assigned to the "admin" role in that specific server.
            // Staff names adopt the tier-specific color (red/orange/
            // yellow); we read it from `staffNameClass(userId)` which
            // covers all three tiers, overriding per-server roleColor.
            !offline && isAdmin && staffNameClass(userId),
          )}
          style={
            offline || isAdmin
              ? undefined
              : { color: roleColor || "var(--text-normal)" }
          }
        >
          <span className="truncate">{name}</span>
          {isMe && (
            <span className="ml-1.5 text-[10px] text-[var(--accent)] font-normal">
              （你）
            </span>
          )}
        </div>
        {activity && !offline && (
          <div
            className="text-[10px] text-[var(--text-muted)] truncate leading-tight"
            title={activity}
          >
            {activity}
          </div>
        )}
      </div>
      {/* Staff badge — pinned to the END of the row (right edge) so
          all rows visually align on the badge column, mirroring
          Discord's role-icon convention. */}
      {isAdmin && (
        <StaffBadge userId={userId} size={14} className="shrink-0 ml-1" />
      )}
    </li>
  );
}
