"use client";
import { confirm } from "@/lib/confirm-store";
import { prompt } from "@/lib/prompt-store";

/**
 * Settings panel for a user-owned (non-official) server.
 *
 * Capabilities by role:
 *   - creator:
 *       - promote a member to admin (until slot cap)
 *       - demote an admin to member
 *       - transfer ownership to any other member
 *       - disband the server entirely
 *   - admin:
 *       - demote (remove) themselves
 *
 * Slot rule (server-roles-store):
 *   max_admins = min(10, 4 + floor(member_count / 5000))
 *
 * UI: a single modal with three sections — 角色 (role list), 添加主教 (search +
 * promote), 危险区 (transfer / disband, creator only).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  Crown,
  Shield,
  UserMinus,
  Search,
  AlertTriangle,
  Copy,
  RefreshCw,
  Check,
  Globe,
  Lock,
  Upload,
  Trash2,
  Loader2,
  Hash,
  Volume2,
  Megaphone,
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  ListTree,
} from "lucide-react";
import Avatar from "@/components/Avatar";
import { processAvatarFile, isAvatarUrl } from "@/lib/avatar-upload";
import { formatVanityId } from "@/lib/vanity-id";
import { db } from "@/lib/cloudbase";
import { useAuth } from "@/lib/auth-store";
import { useServers, useMyServerRow } from "@/lib/servers-store";
import {
  useServerRoles,
  adminSlotsFor,
  type ServerMembershipRow,
  type ServerRole,
} from "@/lib/server-roles-store";
import {
  servers as MOCK_SERVERS,
  channelCategories as DEFAULT_CHANNEL_CATEGORIES,
  type ChannelCategory,
  type Channel,
} from "@/lib/mock-data";
import { isPlatformAdminId, isFounderId } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";

const ICON_COLOR_PRESETS = [
  "#d4a056",
  "#9b6dd9",
  "#7e3a8c",
  "#c9a44c",
  "#5a8c7d",
  "#3a6e9b",
  "#c64b3e",
  "#6db26d",
];

type Props = {
  open: boolean;
  serverId: string | null;
  onClose: () => void;
  /** Called after `disband` so the host can reset its activeServerId. */
  onDisbanded?: () => void;
};

export default function ServerSettingsModal({
  open,
  serverId,
  onClose,
  onDisbanded,
}: Props) {
  const { user: me } = useAuth();
  const backdrop = useDismissOnBackdrop(onClose);
  const customServers = useServers((s) => s.custom);
  const officialOverrides = useServers((s) => s.officialOverrides);
  const refreshServers = useServers((s) => s.refresh);
  const disbandServer = useServers((s) => s.disbandServer);
  const regenerateInviteCode = useServers((s) => s.regenerateInviteCode);
  const setServerPublic = useServers((s) => s.setPublic);
  const refreshRoles = useServerRoles((s) => s.refresh);
  const updateServer = useServers((s) => s.updateServer);
  const fullRow = useMyServerRow(serverId);

  const [members, setMembers] = useState<ServerMembershipRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchUsername, setSearchUsername] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  // Appearance editing — staged values, only persisted when 保存 is clicked.
  const [editName, setEditName] = useState("");
  const [editIconText, setEditIconText] = useState("");
  const [editIconColor, setEditIconColor] = useState(ICON_COLOR_PRESETS[0]);
  // Staged icon image. `undefined` = no change; `null` = remove; string = uploaded.
  const [editIconUrl, setEditIconUrl] = useState<string | null | undefined>(
    undefined,
  );
  const [iconUploading, setIconUploading] = useState(false);
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const iconFileRef = useRef<HTMLInputElement | null>(null);

  // ── Channel manager state ───────────────────────────────────────────
  // Drafts of the channel layout. Seeded from server.channels (admin
  // edits) or DEFAULT_CHANNEL_CATEGORIES (untouched servers) so even
  // brand-new custom servers can be customised right away. The "dirty"
  // flag gates the 保存频道 button so we don't re-write the doc on a
  // no-op open/close.
  const [channelDraft, setChannelDraft] = useState<ChannelCategory[]>([]);
  const [channelsDirty, setChannelsDirty] = useState(false);
  const [channelsBusy, setChannelsBusy] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);

  // Build the default channel layout to seed from. Non-official (user-
  // created) servers don't get stream / trade channels — these are platform-
  // wide marketplace / streaming features that only the official server
  // exposes. We strip both the entire 直播 / 交易 categories and any leftover
  // stream/trade channels nested inside other categories.
  const buildDefaultChannels = useCallback((official: boolean): ChannelCategory[] => {
    const seed: ChannelCategory[] = JSON.parse(JSON.stringify(DEFAULT_CHANNEL_CATEGORIES));
    if (official) return seed;
    return seed
      .filter((cat) => cat.id !== "live" && cat.id !== "trade")
      .map((cat) => ({
        ...cat,
        channels: cat.channels.filter(
          (ch) => ch.type !== "stream" && ch.type !== "trade",
        ),
      }));
  }, []);

  // Fall back to mock (official) servers so the modal works for platform
  // admins managing the official server. Apply officialOverrides so saved
  // name / avatar / channels are reflected rather than the hardcoded mock.
  const server =
    customServers.find((s) => s.id === serverId) ??
    (() => {
      const mock = MOCK_SERVERS.find((s) => s.id === serverId);
      if (!mock || !serverId) return undefined;
      const ov = officialOverrides[serverId];
      return (ov ? { ...mock, ...ov } : mock) as typeof customServers[0];
    })();
  const isOfficial =
    !!server?.is_official ||
    MOCK_SERVERS.some((s) => s.id === serverId && s.is_official);

  const myRow = members.find((m) => m.user_id === me?.id);
  const myRole = myRow?.role;

  const loadMembers = useCallback(async () => {
    if (!serverId) return;
    setLoading(true);
    try {
      const res = await db
        .collection("server_members")
        .where({ server_id: serverId })
        .limit(500)
        .get();
      setMembers((res.data || []) as ServerMembershipRow[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`加载成员失败：${msg}`);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (!open || !serverId) return;
    setError(null);
    loadMembers();
  }, [open, serverId, loadMembers]);

  // Seed appearance editor from the loaded server row whenever the modal
  // opens or the underlying server changes (e.g. another tab updated it).
  useEffect(() => {
    if (!open || !server) return;
    setEditName(server.name);
    setEditIconText(server.iconText);
    setEditIconColor(server.iconColor);
    setEditIconUrl(undefined); // unstage on every (re-)open
    // Seed channel draft. Deep-clone via JSON so mutating draft state in
    // place can't accidentally edit the live server row in the store.
    const seed = (server.channels && server.channels.length > 0
      ? (JSON.parse(JSON.stringify(server.channels)) as ChannelCategory[])
      : buildDefaultChannels(isOfficial));
    setChannelDraft(seed);
    setChannelsDirty(false);
  }, [
    open,
    server?.id,
    server?.name,
    server?.iconText,
    server?.iconColor,
    server?.iconUrl,
    server?.channels,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !serverId || !server) return null;
  // For official servers the creator role is held by the platform admin;
  // fall back so role-gated UI (promote/disband) renders correctly.
  const effectiveRole: typeof myRole = isOfficial
    ? (myRole ?? (me && (isFounderId(me.id) || isPlatformAdminId(me.id)) ? "creator" : undefined))
    : myRole;

  const adminCount = members.filter((m) => m.role === "admin").length;
  const slotCap = adminSlotsFor(server.member_count || members.length);
  const canPromoteMore = effectiveRole === "creator" && adminCount < slotCap;

  const updateRole = async (userId: string, role: ServerRole) => {
    setError(null);
    setBusyId(userId);
    try {
      await db
        .collection("server_members")
        .where({ id: `${serverId}__${userId}` })
        .update({ role });
      await loadMembers();
      await refreshRoles();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`修改角色失败：${msg}`);
    } finally {
      setBusyId(null);
    }
  };

  const promoteByUsername = async () => {
    setError(null);
    const q = searchUsername.trim();
    if (!q) return;
    if (!canPromoteMore) {
      setError(`主教名额已满（${adminCount}/${slotCap}）`);
      return;
    }
    setSearchBusy(true);
    try {
      // Find profile by exact username.
      const res = await db
        .collection("profiles")
        .where({ username: q })
        .limit(1)
        .get();
      const target = (res.data || [])[0] as
        | { id: string; user_id?: string; username: string }
        | undefined;
      if (!target) {
        // Profiles are created on first login, not at signup time. So a
        // brand-new user who hasn't logged in once won't appear in the
        // table yet. Make the hint actionable instead of just "not found".
        setError(
          `找不到用户名为「${q}」的用户。请确认拼写完全一致（区分大小写），且对方至少登录过一次。`,
        );
        return;
      }
      const targetId = (target.user_id || target.id) as string;

      // Already a member?
      const existingRow = members.find((m) => m.user_id === targetId);
      if (existingRow) {
        if (existingRow.role === "admin") {
          setError("该用户已是主教");
          return;
        }
        if (existingRow.role === "creator") {
          setError("领主无法被设为主教");
          return;
        }
        await updateRole(targetId, "admin");
      } else {
        // Add as admin directly.
        await db.collection("server_members").add({
          id: `${serverId}__${targetId}`,
          server_id: serverId,
          user_id: targetId,
          user_name: target.username,
          role: "admin",
          joined_at: new Date().toISOString(),
        });
        await loadMembers();
        await refreshRoles();
      }
      setSearchUsername("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`提升失败：${msg}`);
    } finally {
      setSearchBusy(false);
    }
  };

  const transferOwnership = async (newCreatorId: string) => {
    if (effectiveRole !== "creator" || !me) return;
    if (!(await confirm("确认转让领主？此操作不可撤销，你将变成普通主教。"))) return;
    setError(null);
    setBusyId(newCreatorId);
    try {
      // Demote me first to admin (so we don't briefly have two creators).
      await db
        .collection("server_members")
        .where({ id: `${serverId}__${me.id}` })
        .update({ role: "admin" as ServerRole });
      // Promote target.
      await db
        .collection("server_members")
        .where({ id: `${serverId}__${newCreatorId}` })
        .update({ role: "creator" as ServerRole });
      // Mirror creator_id on the server doc.
      const newCreatorName =
        members.find((m) => m.user_id === newCreatorId)?.user_name || "";
      await db
        .collection("servers")
        .where({ id: serverId })
        .update({ creator_id: newCreatorId, creator_name: newCreatorName });
      await loadMembers();
      await refreshRoles();
      await refreshServers();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`转让失败：${msg}`);
    } finally {
      setBusyId(null);
    }
  };

  // ── Channel manager mutators ───────────────────────────────────────
  // All operate on the local draft only — nothing hits the DB until
  // 保存频道 is clicked. Each one flips the dirty flag so the save
  // button enables.
  const canManageChannels = effectiveRole === "creator" || effectiveRole === "admin";

  const newChannelId = () =>
    "ch-" + Math.random().toString(36).slice(2, 10);
  const newCategoryId = () =>
    "cat-" + Math.random().toString(36).slice(2, 10);

  const addCategory = async () => {
    const name = (await prompt("分类名称", "新分类"))?.trim();
    if (!name) return;
    setChannelDraft((d) => [
      ...d,
      { id: newCategoryId(), name, channels: [] },
    ]);
    setChannelsDirty(true);
  };

  const renameCategory = async (catId: string) => {
    const current = channelDraft.find((c) => c.id === catId);
    const next = (await prompt("重命名分类", current?.name || ""))?.trim();
    if (!next || next === current?.name) return;
    setChannelDraft((d) =>
      d.map((c) => (c.id === catId ? { ...c, name: next } : c)),
    );
    setChannelsDirty(true);
  };

  const removeCategory = async (catId: string) => {
    if (!(await confirm("确认删除该分类及其下所有频道？")))
      return;
    setChannelDraft((d) => d.filter((c) => c.id !== catId));
    setChannelsDirty(true);
  };

  const addChannel = async (catId: string, type: Channel["type"]) => {
    const name = (await prompt(`新${typeLabel(type)}频道名称`, "新频道"))?.trim();
    if (!name) return;
    setChannelDraft((d) =>
      d.map((c) =>
        c.id === catId
          ? {
              ...c,
              channels: [
                ...c.channels,
                { id: newChannelId(), name, type },
              ],
            }
          : c,
      ),
    );
    setChannelsDirty(true);
  };

  const renameChannel = async (catId: string, chId: string) => {
    const cat = channelDraft.find((c) => c.id === catId);
    const ch = cat?.channels.find((x) => x.id === chId);
    const next = (await prompt("重命名频道", ch?.name || ""))?.trim();
    if (!next || next === ch?.name) return;
    setChannelDraft((d) =>
      d.map((c) =>
        c.id === catId
          ? {
              ...c,
              channels: c.channels.map((x) =>
                x.id === chId ? { ...x, name: next } : x,
              ),
            }
          : c,
      ),
    );
    setChannelsDirty(true);
  };

  const setChannelMaxOccupants = (catId: string, chId: string, max: number) => {
    setChannelDraft((d) =>
      d.map((c) =>
        c.id === catId
          ? {
              ...c,
              channels: c.channels.map((x) =>
                x.id === chId ? { ...x, maxOccupants: max } : x,
              ),
            }
          : c,
      ),
    );
    setChannelsDirty(true);
  };

  const toggleChannelReadonly = (catId: string, chId: string) => {
    setChannelDraft((d) =>
      d.map((c) =>
        c.id === catId
          ? {
              ...c,
              channels: c.channels.map((x) =>
                x.id === chId ? { ...x, readonly: !x.readonly } : x,
              ),
            }
          : c,
      ),
    );
    setChannelsDirty(true);
  };

  const removeChannel = async (catId: string, chId: string) => {
    if (!(await confirm("确认删除该频道？历史消息不会被删除。")))
      return;
    setChannelDraft((d) =>
      d.map((c) =>
        c.id === catId
          ? { ...c, channels: c.channels.filter((x) => x.id !== chId) }
          : c,
      ),
    );
    setChannelsDirty(true);
  };

  const saveChannels = async () => {
    if (!serverId) return;
    setChannelsBusy(true);
    setError(null);
    try {
      const res = await updateServer(serverId, { channels: channelDraft });
      if (!res.ok) {
        setError(res.error || "保存频道失败");
      } else {
        setChannelsDirty(false);
      }
    } finally {
      setChannelsBusy(false);
    }
  };

  const resetChannels = async () => {
    if (!serverId) return;
    if (!(await confirm("恢复为默认频道布局？自定义改动将丢失。")))
      return;
    setChannelsBusy(true);
    setError(null);
    try {
      const res = await updateServer(serverId, { channels: null });
      if (!res.ok) {
        setError(res.error || "重置失败");
      } else {
        setChannelDraft(buildDefaultChannels(isOfficial));
        setChannelsDirty(false);
      }
    } finally {
      setChannelsBusy(false);
    }
  };

  const handleDisband = async () => {
    if (effectiveRole !== "creator") return;
    if (!(await confirm(`确认解散服务器「${server.name}」？所有成员关系会被删除，此操作无法撤销。`)))
      return;
    setError(null);
    const res = await disbandServer(serverId);
    if (!res.ok) {
      setError(res.error || "解散失败");
      return;
    }
    onDisbanded?.();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      {...backdrop}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-[var(--bg-darker)] rounded-lg shadow-2xl border border-[var(--bg-mid)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start gap-3 shrink-0">
          <Avatar
            text={server.iconText}
            color={server.iconColor}
            url={server.iconUrl}
            size={40}
            shape="round"
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">
              {server.name}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {isOfficial
                ? "官方服务器·由平台管理"
                : `成员 ${server.member_count || members.length} · 主教 ${adminCount}/${slotCap}`}
            </p>
            {server.numericId && (
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5 font-mono">
                公会号 {formatVanityId(server.numericId)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <X size={16} />
          </button>
        </div>

          <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">
            {/* Appearance section (creator + admin) */}
            {(effectiveRole === "creator" || effectiveRole === "admin") && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  外观
                </h3>
                <div className="flex items-start gap-3">
                  {/* Live preview */}
                  <Avatar
                    text={editIconText || editName}
                    color={editIconColor}
                    url={
                      editIconUrl === undefined
                        ? server.iconUrl ?? null
                        : editIconUrl
                    }
                    size={56}
                    shape="squircle"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      value={editName}
                      maxLength={30}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="服务器名称"
                      className="w-full bg-[var(--bg-darkest)] rounded h-9 px-3 text-sm text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    />
                    <div className="flex gap-2">
                      <input
                        value={editIconText}
                        maxLength={2}
                        onChange={(e) => setEditIconText(e.target.value)}
                        placeholder="图标字"
                        className="flex-1 bg-[var(--bg-darkest)] rounded h-9 px-3 text-sm text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      />
                      <div className="flex items-center gap-1.5">
                        {ICON_COLOR_PRESETS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setEditIconColor(c)}
                            className={cn(
                              "size-6 rounded-full border-2 transition-colors",
                              editIconColor === c
                                ? "border-white"
                                : "border-transparent hover:border-[var(--text-muted)]",
                            )}
                            style={{ background: c }}
                            aria-label={c}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Icon image upload */}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    ref={iconFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      setIconUploading(true);
                      setError(null);
                      const r = await processAvatarFile(f);
                      setIconUploading(false);
                      if (!r.ok) {
                        setError(r.error);
                        return;
                      }
                      setEditIconUrl(r.dataUrl);
                    }}
                  />
                  <button
                    type="button"
                    disabled={iconUploading}
                    onClick={() => iconFileRef.current?.click()}
                    className="h-8 px-3 rounded text-xs bg-[var(--bg-mid)] hover:bg-[var(--bg-mid)]/70 text-white flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {iconUploading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Upload size={12} />
                    )}
                    {iconUploading ? "处理中…" : "上传图片"}
                  </button>
                  {isAvatarUrl(
                    editIconUrl === undefined
                      ? server.iconUrl
                      : editIconUrl,
                  ) && (
                    <button
                      type="button"
                      onClick={() => setEditIconUrl(null)}
                      className="h-8 px-3 rounded text-xs bg-[var(--danger)]/10 hover:bg-[var(--danger)]/20 text-[var(--danger)] flex items-center gap-1.5"
                    >
                      <Trash2 size={12} />
                      移除图片
                    </button>
                  )}
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={
                      appearanceBusy ||
                      !serverId ||
                      (editName === server.name &&
                        editIconText === server.iconText &&
                        editIconColor === server.iconColor &&
                        editIconUrl === undefined)
                    }
                    onClick={async () => {
                      if (!serverId) return;
                      setAppearanceBusy(true);
                      setError(null);
                      const r = await updateServer(serverId, {
                        name: editName,
                        iconText: editIconText,
                        iconColor: editIconColor,
                        iconUrl:
                          editIconUrl !== undefined ? editIconUrl : undefined,
                      });
                      setAppearanceBusy(false);
                      if (!r.ok) setError(r.error || "保存失败");
                      else setEditIconUrl(undefined);
                    }}
                    className="h-8 px-3 rounded text-xs bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {appearanceBusy ? "保存中…" : "保存外观"}
                  </button>
                </div>
              </section>
            )}

            {/* Invite / visibility section (creator + admin) */}
            {(effectiveRole === "creator" || effectiveRole === "admin") && fullRow && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  邀请 / 可见性
                </h3>
                <div className="space-y-2">
                  {/* Invite code row */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-[var(--bg-darkest)] rounded h-9 px-3 flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                        邀请码
                      </span>
                      <span className="font-mono text-base font-semibold text-white tracking-widest">
                        {fullRow.invite_code || "——————"}
                      </span>
                    </div>
                    <button
                      type="button"
                      title="复制邀请码"
                      disabled={!fullRow.invite_code}
                      onClick={async () => {
                        if (!fullRow.invite_code) return;
                        try {
                          await navigator.clipboard.writeText(fullRow.invite_code);
                          setCopied("code");
                          setTimeout(() => setCopied(null), 1500);
                        } catch {
                          /* ignore */
                        }
                      }}
                      className="size-9 grid place-items-center rounded bg-[var(--bg-darkest)] text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)] disabled:opacity-50"
                    >
                      {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    {effectiveRole === "creator" && (
                      <button
                        type="button"
                        title="重生邀请码（旧码会失效）"
                        disabled={regenBusy}
                        onClick={async () => {
                          if (!serverId) return;
                          setRegenBusy(true);
                          setError(null);
                          const r = await regenerateInviteCode(serverId);
                          setRegenBusy(false);
                          if (!r.ok) setError(r.error || "重生失败");
                        }}
                        className="size-9 grid place-items-center rounded bg-[var(--bg-darkest)] text-[var(--text-muted)] hover:text-[var(--warning)] hover:bg-[var(--bg-mid)] disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={regenBusy ? "animate-spin" : ""} />
                      </button>
                    )}
                  </div>

                  {/* Invite link row */}
                  {fullRow.invite_code && (
                    <button
                      type="button"
                      onClick={async () => {
                        const url = `${window.location.origin}/?invite=${fullRow.invite_code}`;
                        try {
                          await navigator.clipboard.writeText(url);
                          setCopied("link");
                          setTimeout(() => setCopied(null), 1500);
                        } catch {
                          /* ignore */
                        }
                      }}
                      className="w-full flex items-center justify-between text-left bg-[var(--bg-darkest)] rounded h-9 px-3 text-xs text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
                    >
                      <span className="truncate font-mono">
                        {typeof window !== "undefined"
                          ? `${window.location.origin}/?invite=${fullRow.invite_code}`
                          : `?invite=${fullRow.invite_code}`}
                      </span>
                      <span className="flex items-center gap-1 ml-2 shrink-0">
                        {copied === "link" ? (
                          <>
                            <Check size={12} /> 已复制
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> 复制链接
                          </>
                        )}
                      </span>
                    </button>
                  )}

                  {/* Visibility toggle (creator only) */}
                  {effectiveRole === "creator" && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={visibilityBusy}
                        onClick={async () => {
                          if (!serverId) return;
                          setVisibilityBusy(true);
                          setError(null);
                          const r = await setServerPublic(
                            serverId,
                            !fullRow.is_public,
                          );
                          setVisibilityBusy(false);
                          if (!r.ok) setError(r.error || "修改失败");
                        }}
                        className={cn(
                          "flex items-center gap-1.5 h-8 px-3 rounded text-xs",
                          fullRow.is_public
                            ? "bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/30"
                            : "bg-[var(--bg-darkest)] text-[var(--text-muted)] border border-[var(--bg-mid)]",
                          "disabled:opacity-50",
                        )}
                      >
                        {fullRow.is_public ? (
                          <>
                            <Globe size={12} /> 公开（点击切为私密）
                          </>
                        ) : (
                          <>
                            <Lock size={12} /> 私密（点击切为公开）
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Promote section (creator only) */}
            {effectiveRole === "creator" && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  添加主教
                </h3>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center bg-[var(--bg-darkest)] rounded h-9 px-2 gap-1.5">
                    <Search size={14} className="text-[var(--text-muted)]" />
                    <input
                      value={searchUsername}
                      onChange={(e) => setSearchUsername(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") promoteByUsername();
                      }}
                      placeholder="输入用户名（精确匹配）"
                      className="flex-1 bg-transparent text-sm text-white placeholder:text-[var(--text-muted)] focus:outline-none min-w-0"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={promoteByUsername}
                    disabled={searchBusy || !canPromoteMore || !searchUsername.trim()}
                    className="h-9 px-3 rounded text-sm bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {searchBusy ? "处理中…" : "设为主教"}
                  </button>
                </div>
                {!canPromoteMore && adminCount >= slotCap && (
                  <p className="mt-2 text-[11px] text-[var(--warning)]">
                    主教名额已满（{adminCount}/{slotCap}）。每 5000 名成员可多设一位，封顶 10 位。
                  </p>
                )}
              </section>
            )}

            {/* Member list */}
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                成员 - {members.length}
              </h3>
              {loading ? (
                <div className="text-sm text-[var(--text-muted)] italic">
                  加载中…
                </div>
              ) : (
                <ul className="divide-y divide-[var(--bg-mid)]/50">
                  {members
                    .slice()
                    .sort((a, b) => {
                      const order = { creator: 0, admin: 1, member: 2 } as const;
                      return order[a.role] - order[b.role];
                    })
                    .map((m) => (
                      <RoleRow
                        key={m.id}
                        row={m}
                        isMe={m.user_id === me?.id}
                        myRole={effectiveRole}
                        busy={busyId === m.user_id}
                        onPromote={() => updateRole(m.user_id, "admin")}
                        onDemote={() => updateRole(m.user_id, "member")}
                        onTransfer={() => transferOwnership(m.user_id)}
                      />
                    ))}
                </ul>
              )}
            </section>

            {/* Channel manager (creator + admin) */}
            {canManageChannels && (
              <section className="pt-2 border-t border-[var(--bg-mid)]/50">
                <button
                  type="button"
                  onClick={() => setChannelsOpen((v) => !v)}
                  className="w-full flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-white"
                >
                  {channelsOpen ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  <ListTree size={12} />
                  频道管理
                  {channelsDirty && (
                    <span className="ml-auto text-[var(--warning)] normal-case">
                      未保存
                    </span>
                  )}
                </button>
                {channelsOpen && (
                  <div className="space-y-2">
                    {channelDraft.length === 0 && (
                      <p className="text-xs text-[var(--text-muted)] italic px-1">
                        暂无分类。点下方按钮新增。
                      </p>
                    )}
                    {channelDraft.map((cat) => (
                      <ChannelCategoryEditor
                        key={cat.id}
                        category={cat}
                        onRenameCategory={() => renameCategory(cat.id)}
                        onDeleteCategory={() => removeCategory(cat.id)}
                        onAddChannel={(t) => addChannel(cat.id, t)}
                        onRenameChannel={(chId) =>
                          renameChannel(cat.id, chId)
                        }
                        onDeleteChannel={(chId) =>
                          removeChannel(cat.id, chId)
                        }
                        onChangeMaxOccupants={(chId, max) =>
                          setChannelMaxOccupants(cat.id, chId, max)
                        }
                        onToggleReadonly={(chId) =>
                          toggleChannelReadonly(cat.id, chId)
                        }
                      />
                    ))}
                    <div className="flex gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={addCategory}
                        className="flex-1 h-8 rounded text-xs text-[var(--accent)] border border-[var(--accent)]/40 hover:bg-[var(--accent)]/10 flex items-center justify-center gap-1"
                      >
                        <Plus size={12} />
                        新建分类
                      </button>
                      <button
                        type="button"
                        onClick={saveChannels}
                        disabled={!channelsDirty || channelsBusy}
                        className="flex-1 h-8 rounded text-xs bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                      >
                        {channelsBusy ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Check size={12} />
                        )}
                        保存频道
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={resetChannels}
                      disabled={channelsBusy}
                      className="w-full text-[10px] text-[var(--text-muted)] hover:text-white py-1 disabled:opacity-50"
                    >
                      恢复默认频道布局
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* Danger zone (creator only) */}
            {effectiveRole === "creator" && !isOfficial && (
              <section className="pt-2 border-t border-[var(--bg-mid)]/50">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--danger)] mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  危险区
                </h3>
                <button
                  type="button"
                  onClick={handleDisband}
                  className="w-full h-9 rounded border border-[var(--danger)]/40 text-[var(--danger)] text-sm hover:bg-[var(--danger)]/10"
                >
                  解散服务器
                </button>
              </section>
            )}

            {error && (
              <div className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded p-2">
                {error}
              </div>
            )}
          </div>
      </div>
    </div>
  );
}

function RoleRow({
  row,
  isMe,
  myRole,
  busy,
  onPromote,
  onDemote,
  onTransfer,
}: {
  row: ServerMembershipRow;
  isMe: boolean;
  myRole: ServerRole | undefined;
  busy: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onTransfer: () => void;
}) {
  const tag = row.user_id.slice(-4);
  const roleLabel =
    row.role === "creator" ? "领主" : row.role === "admin" ? "主教" : "成员";
  const roleIcon =
    row.role === "creator" ? (
      <Crown size={12} className="text-[var(--warning)]" />
    ) : row.role === "admin" ? (
      <Shield size={12} className="text-[var(--accent)]" />
    ) : null;

  return (
    <li className="flex items-center gap-3 px-1 py-2">
      <div className="size-8 rounded-full bg-[var(--bg-mid)] grid place-items-center text-[var(--text-normal)] text-xs font-semibold">
        {(row.user_name || "?").slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate flex items-center gap-1.5">
          {row.user_name || "未知用户"}
          {isMe && (
            <span className="text-[10px] text-[var(--text-muted)]">（你）</span>
          )}
          <span className="text-[var(--text-muted)] text-[11px]">#{tag}</span>
        </div>
        <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
          {roleIcon}
          {roleLabel}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {/* Creator can demote any admin or transfer to anyone non-creator */}
        {myRole === "creator" && !isMe && row.role === "admin" && (
          <button
            type="button"
            onClick={onDemote}
            disabled={busy}
            title="降为普通成员"
            className="h-7 px-2 rounded text-xs text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
          >
            <UserMinus size={12} />
          </button>
        )}
        {myRole === "creator" && !isMe && row.role === "member" && (
          <button
            type="button"
            onClick={onPromote}
            disabled={busy}
            title="提升为主教"
            className="h-7 px-2 rounded text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50"
          >
            <Shield size={12} />
          </button>
        )}
        {myRole === "creator" && !isMe && row.role !== "creator" && (
          <button
            type="button"
            onClick={onTransfer}
            disabled={busy}
            title="转让领主"
            className="h-7 px-2 rounded text-xs text-[var(--warning)] hover:bg-[var(--warning)]/10 disabled:opacity-50"
          >
            <Crown size={12} />
          </button>
        )}
        {/* Admin can demote themselves */}
        {myRole === "admin" && isMe && row.role === "admin" && (
          <button
            type="button"
            onClick={onDemote}
            disabled={busy}
            className="h-7 px-2 rounded text-xs text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
          >
            退出管理
          </button>
        )}
      </div>
    </li>
  );
}

// ── Channel manager helpers ───────────────────────────────────────────

function typeLabel(t: Channel["type"]): string {
  switch (t) {
    case "text":
      return "文字";
    case "announcement":
      return "公告";
    case "voice":
      return "语音";
    case "stream":
      return "直播";
    case "trade":
      return "交易";
    case "party":
      return "组队";
    case "auction":
      return "拍卖";
    case "coins":
      return "金币兑换";
    default:
      return t;
  }
}

function typeIcon(t: Channel["type"]) {
  switch (t) {
    case "voice":
      return <Volume2 size={12} />;
    case "announcement":
      return <Megaphone size={12} />;
    default:
      return <Hash size={12} />;
  }
}

function ChannelCategoryEditor({
  category,
  onRenameCategory,
  onDeleteCategory,
  onAddChannel,
  onRenameChannel,
  onDeleteChannel,
  onChangeMaxOccupants,
  onToggleReadonly,
}: {
  category: ChannelCategory;
  onRenameCategory: () => void;
  onDeleteCategory: () => void;
  onAddChannel: (type: Channel["type"]) => void;
  onRenameChannel: (chId: string) => void;
  onDeleteChannel: (chId: string) => void;
  onChangeMaxOccupants: (chId: string, max: number) => void;
  onToggleReadonly: (chId: string) => void;
}) {
  // Custom servers don't get trade / stream channels (matches the
  // ChannelSidebar filter), so we only expose text / announcement /
  // voice / party in the "add" picker.
  const [addOpen, setAddOpen] = useState(false);
  const ALLOWED_TYPES: Channel["type"][] = [
    "text",
    "announcement",
    "voice",
    "party",
  ];
  return (
    <div className="rounded border border-[var(--bg-mid)]/60 bg-[var(--bg-darkest)]/40 p-2">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="flex-1 text-xs font-semibold text-white truncate">
          {category.name}
        </span>
        <button
          type="button"
          title="重命名分类"
          onClick={onRenameCategory}
          className="size-6 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          title="删除分类"
          onClick={onDeleteCategory}
          className="size-6 grid place-items-center rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
        >
          <Trash2 size={11} />
        </button>
      </div>
      <ul className="space-y-0.5">
        {category.channels.length === 0 && (
          <li className="text-[11px] text-[var(--text-muted)] italic px-1 py-1">
            暂无频道
          </li>
        )}
        {category.channels.map((ch) => (
          <li
            key={ch.id}
            className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-[var(--bg-mid)]/40"
          >
            <span className="text-[var(--text-muted)] shrink-0">
              {typeIcon(ch.type)}
            </span>
            <span className="flex-1 text-xs text-[var(--text-normal)] truncate">
              {ch.name}
            </span>
            {(ch.type === "text" || ch.type === "announcement") && (
              <button
                type="button"
                title={ch.readonly ? "取消只读（成员可发言）" : "设为只读（仅管理员可发言）"}
                onClick={() => onToggleReadonly(ch.id)}
                className={cn(
                  "size-5 grid place-items-center rounded transition-colors",
                  ch.readonly
                    ? "text-[var(--warning)] hover:text-[var(--text-muted)]"
                    : "text-[var(--bg-mid)] hover:text-[var(--warning)] hover:bg-[var(--bg-mid)]",
                )}
              >
                <Lock size={10} />
              </button>
            )}
            {(ch.type === "voice" || ch.type === "stream") ? (
              <div className="flex items-center gap-1 shrink-0" title="最大人数上限">
                <span className="text-[10px] text-[var(--text-muted)]">/</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={ch.maxOccupants ?? 25}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(99, parseInt(e.target.value) || 1));
                    onChangeMaxOccupants(ch.id, v);
                  }}
                  className="w-9 h-5 bg-[var(--bg-mid)] rounded px-1 text-[11px] text-center text-white focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
              </div>
            ) : (
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                {typeLabel(ch.type)}
              </span>
            )}
            <button
              type="button"
              title="重命名"
              onClick={() => onRenameChannel(ch.id)}
              className="size-5 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            >
              <Pencil size={10} />
            </button>
            <button
              type="button"
              title="删除"
              onClick={() => onDeleteChannel(ch.id)}
              className="size-5 grid place-items-center rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
            >
              <Trash2 size={10} />
            </button>
          </li>
        ))}
      </ul>
      <div className="relative mt-1.5">
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="w-full h-7 rounded text-[11px] text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)] flex items-center justify-center gap-1"
        >
          <Plus size={11} />
          添加频道
        </button>
        {addOpen && (
          <div
            className="absolute left-0 right-0 top-full mt-1 z-10 rounded bg-[var(--bg-darkest)] border border-[var(--bg-mid)] shadow-lg py-1"
            onMouseLeave={() => setAddOpen(false)}
          >
            {ALLOWED_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  onAddChannel(t);
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--text-normal)] hover:bg-[var(--bg-mid)]"
              >
                <span className="text-[var(--text-muted)]">{typeIcon(t)}</span>
                {typeLabel(t)}频道
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
