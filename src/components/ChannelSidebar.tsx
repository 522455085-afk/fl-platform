"use client";

import {
  ChevronDown,
  ChevronRight,
  Hash,
  Megaphone,
  Volume2,
  Radio,
  Coins,
  Users,
  Plus,
  UserPlus,
  Settings,
  X,
  Eye,
  Check,
  Lock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { channelCategories, type Channel } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import UserPanel from "@/components/UserPanel";
import { ChannelListSkeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth-store";
import { useVoice } from "@/lib/voice-store";
import { usePresence, type PresenceUser } from "@/lib/use-presence";
import Avatar from "@/components/Avatar";
import { useChannelUnread, useChannelMention } from "@/lib/unread-store";
import { prefetchChannel } from "@/components/ChatView";
import { useLastMessages } from "@/lib/last-messages-store";
import { toast } from "@/lib/toast-store";

type Props = {
  serverName: string;
  activeChannelId: string;
  onSelect: (channel: Channel) => void;
  onOpenSecurity?: () => void;
  onOpenProfile?: () => void;
  /** Active server id used as the presence room for friend online dots. */
  presenceRoom?: string;
  /** Open a 1:1 DM with the given friend. Required for friend list clicks. */
  onOpenDm?: (target: { user_id: string; username: string; avatar: string; avatar_color: string }) => void;
  /**
   * Server is user-managed (creator/admin can configure it). When true we
   * show the 邀请 / 设置 shortcut buttons in the header.
   */
  manageable?: boolean;
  /**
   * Whether this server is platform-official (e.g. 大殿, 御林骑士团). Custom
   * user-created servers should NOT have the 交易 / 直播 categories
   * because those are platform-wide marketplace / streaming features
   * that don't make sense per-server.
   */
  isOfficial?: boolean;
  /** Override channel categories (admin CRUD). Falls back to the global
   *  `channelCategories` mock when not provided. */
  customCategories?: typeof channelCategories;
  /** Click 邀请伙伴 — jump straight to ServerSettings. */
  onOpenInvite?: () => void;
  /** Click 服务器设置 — same modal, different default focus. */
  onOpenSettings?: () => void;
  /**
   * Invite code for the active server. When present, all members (not just
   * admins) get a copy-link button in the header. Managers still get the full
   * settings-based invite flow via `onOpenInvite`.
   */
  inviteCode?: string;
  /**
   * Whether the current user is already a member of this server. When
   * `false` we render a prominent 加入 banner at the top and all channel
   * clicks still work (preview mode = read-only).
   */
  isMember?: boolean;
  /** Fired when the user clicks the big 加入 button in the preview banner. */
  onJoinServer?: () => void;
  /** Fired when the user dismisses the preview (X button in the banner). */
  onCancelPreview?: () => void;
  /** Open the server context menu (ChevronDown button for non-managers). */
  onOpenServerMenu?: (x: number, y: number) => void;
};

export default function ChannelSidebar({
  serverName,
  activeChannelId,
  onSelect,
  onOpenSecurity,
  onOpenProfile,
  presenceRoom,
  manageable,
  isOfficial = false,
  customCategories,
  onOpenInvite,
  onOpenSettings,
  inviteCode,
  isMember = true,
  onJoinServer,
  onCancelPreview,
  onOpenServerMenu,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [copiedLink, setCopiedLink] = useState(false);
  // Channel-list skeleton: shown for ~400ms after every server
  // switch so the entry transition feels consistent with the
  // ChatView message skeleton and the MemberList right-panel
  // skeleton. Channel data itself is synchronous (mock-data /
  // customCategories prop), so this is purely a UX nicety — without
  // it, server switches feel jarring because the channel list
  // updates instantly while messages and members lag behind.
  const [channelSkelOn, setChannelSkelOn] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChannelSkelOn(true);
    const t = setTimeout(() => setChannelSkelOn(false), 400);
    return () => clearTimeout(t);
  }, [presenceRoom]);
  const joinVoice = useVoice((s) => s.join);
  const voiceCurrent = useVoice((s) => s.current);
  const myUser = useAuth((s) => s.user);

  // Real voice-channel occupancy from presence. Grouped by channel id
  // so each ChannelItem only iterates its own bucket.
  const presenceUsers = usePresence("global", presenceRoom);
  const voiceOccupants = useMemo(() => {
    const map = new Map<string, PresenceUser[]>();
    for (const u of presenceUsers) {
      if (!u.voice_channel_id) continue;
      // Restrict to the active server so a user in another server's voice
      // channel doesn't bleed into this sidebar.
      if (presenceRoom && u.voice_server_id && u.voice_server_id !== presenceRoom) continue;
      // Discard any STALE self-row when the local voice-store
      // disagrees with the presence echo. Two cases to cover:
      //   1) Switched rooms: voiceCurrent points at a different
      //      channel than what presence still reports.
      //   2) LEFT voice entirely: voiceCurrent is null but presence
      //      still has us in the old room (user-reported "退出后
      //      仍然停留在原房间"). Without this branch the sidebar
      //      kept showing self until the next presence heartbeat.
      if (myUser && u.user_id === myUser.id) {
        if (!voiceCurrent) continue;
        if (u.voice_channel_id !== voiceCurrent.channelId) continue;
      }
      const arr = map.get(u.voice_channel_id) ?? [];
      arr.push(u);
      map.set(u.voice_channel_id, arr);
    }
    // Inject self into the current voice channel bucket immediately if
    // the presence echo hasn't landed yet, so the sidebar updates the
    // moment we double-click join.
    if (
      myUser &&
      voiceCurrent &&
      (!presenceRoom || voiceCurrent.serverId === presenceRoom)
    ) {
      const bucket = map.get(voiceCurrent.channelId) ?? [];
      if (!bucket.some((u) => u.user_id === myUser.id)) {
        bucket.unshift({
          user_id: myUser.id,
          username: myUser.username,
          avatar: myUser.avatar,
          avatar_color: myUser.avatarColor,
          avatar_url: myUser.avatarUrl ?? null,
          voice_channel_id: voiceCurrent.channelId,
          voice_server_id: voiceCurrent.serverId,
          online_at: new Date().toISOString(),
        });
        map.set(voiceCurrent.channelId, bucket);
      }
    }
    return map;
  }, [presenceUsers, presenceRoom, voiceCurrent, myUser]);

  const [invitePopoverOpen, setInvitePopoverOpen] = useState(false);
  const [copiedVariant, setCopiedVariant] = useState<"link" | "code" | null>(null);
  const inviteBtnRef = useRef<HTMLButtonElement | null>(null);
  const invitePopRef = useRef<HTMLDivElement | null>(null);

  const copyInviteLink = () => {
    if (!inviteCode) return;
    const url = `${window.location.origin}/?invite=${inviteCode}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopiedLink(true);
        setCopiedVariant("link");
        setTimeout(() => { setCopiedLink(false); setCopiedVariant(null); }, 1800);
        toast.success("已复制邀请链接");
      })
      .catch(() => toast.error("复制失败"));
    setInvitePopoverOpen(false);
  };
  const copyInviteCode = () => {
    if (!inviteCode) return;
    navigator.clipboard
      .writeText(inviteCode)
      .then(() => {
        setCopiedLink(true);
        setCopiedVariant("code");
        setTimeout(() => { setCopiedLink(false); setCopiedVariant(null); }, 1800);
        toast.success("已复制邀请码");
      })
      .catch(() => toast.error("复制失败"));
    setInvitePopoverOpen(false);
  };
  const onInviteButtonClick = () => {
    if (!inviteCode) { onOpenInvite?.(); return; } // generate a code first
    setInvitePopoverOpen((v) => !v);
  };

  // Close popover on outside click / Esc.
  useEffect(() => {
    if (!invitePopoverOpen) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (invitePopRef.current?.contains(target)) return;
      if (inviteBtnRef.current?.contains(target)) return;
      setInvitePopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInvitePopoverOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [invitePopoverOpen]);

  // Resolve which categories to render. Custom (user-created) servers
  // never get the 交易 (id="trade") or 直播 (id="live") categories,
  // and the legacy 综合 group has a `trade-talk` channel that's also
  // marketplace-only — we strip it from custom servers too. Admin CRUD
  // can override the entire list via `customCategories`.
  const categoriesToRender = useMemo(() => {
    const source =
      customCategories && customCategories.length > 0
        ? customCategories
        : channelCategories;
    if (isOfficial) return source;
    // Non-official (user-created) servers never get 交易 / 直播 categories
    // or trade/stream channels, regardless of whether the source is the
    // global mock or a per-server custom list.
    return source
      .filter((cat) => cat.id !== "live" && cat.id !== "trade")
      .map((cat) => ({
        ...cat,
        channels: cat.channels.filter(
          (ch) => ch.type !== "trade" && ch.type !== "stream",
        ),
      }))
      .filter((cat) => cat.channels.length > 0);
  }, [isOfficial, customCategories]);

  // Listen for fl:collapse-all and fl:expand-all CustomEvents dispatched by
  // the server right-click menu. We don't tie the event to a specific
  // server id because the channel list is keyed only on the active server
  // anyway — collapsing here always targets what's visible.
  useEffect(() => {
    const setAll = (value: boolean) => {
      setCollapsed(
        Object.fromEntries(categoriesToRender.map((c) => [c.id, value])),
      );
    };
    const onCollapse = () => setAll(true);
    const onExpand = () => setAll(false);
    document.addEventListener("fl:collapse-all", onCollapse);
    document.addEventListener("fl:expand-all", onExpand);
    return () => {
      document.removeEventListener("fl:collapse-all", onCollapse);
      document.removeEventListener("fl:expand-all", onExpand);
    };
  }, [categoriesToRender]);

  const previewing = !isMember;

  return (
    <aside className="w-[324px] shrink-0 bg-[var(--bg-darker)] flex flex-col">
      {/* Server header */}
      <div className="h-14 px-4 flex items-center gap-2 border-b border-black/30 shadow-sm">
        <span className="font-semibold text-white truncate flex-1 min-w-0 text-[18px]">
          {serverName}
        </span>
        {previewing ? (
          <button
            type="button"
            title="关闭预览"
            onClick={onCancelPreview}
            className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <X size={15} />
          </button>
        ) : manageable ? (
          <>
            <InviteButton
              inviteBtnRef={inviteBtnRef}
              invitePopRef={invitePopRef}
              open={invitePopoverOpen}
              copiedVariant={copiedVariant}
              hasCode={!!inviteCode}
              inviteCode={inviteCode}
              onButtonClick={onInviteButtonClick}
              onCopyLink={copyInviteLink}
              onCopyCode={copyInviteCode}
            />
            <button
              type="button"
              title="服务器设置"
              onClick={onOpenSettings}
              className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            >
              <Settings size={14} />
            </button>
          </>
        ) : isMember && inviteCode ? (
          <>
            <InviteButton
              inviteBtnRef={inviteBtnRef}
              invitePopRef={invitePopRef}
              open={invitePopoverOpen}
              copiedVariant={copiedVariant}
              hasCode={true}
              inviteCode={inviteCode}
              onButtonClick={onInviteButtonClick}
              onCopyLink={copyInviteLink}
              onCopyCode={copyInviteCode}
            />
            <button
              type="button"
              title="服务器菜单"
              onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onOpenServerMenu?.(r.left, r.bottom); }}
              className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            >
              <ChevronDown size={18} />
            </button>
          </>
        ) : (
          <button
            type="button"
            title="服务器菜单"
            onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onOpenServerMenu?.(r.left, r.bottom); }}
            className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <ChevronDown size={18} />
          </button>
        )}
      </div>

      {/* Preview banner — shown only when the user isn't a member yet. */}
      {previewing && (
        <div className="m-2 p-3 rounded-md border border-[var(--accent)]/50 bg-[var(--accent)]/10">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--accent)] mb-1">
            <Eye size={12} />
            <span className="font-semibold uppercase tracking-wider">预览模式</span>
          </div>
          <p className="text-[12px] text-[var(--text-normal)] leading-relaxed mb-2">
            你正在浏览 <span className="font-semibold text-white">{serverName}</span>
            。加入后即可在频道内发送消息、接收通知。
          </p>
          <button
            type="button"
            onClick={onJoinServer}
            className="w-full h-8 rounded bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            加入公会
          </button>
        </div>
      )}

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {channelSkelOn && <ChannelListSkeleton />}
        {!channelSkelOn && categoriesToRender.map((cat) => {
          const isCollapsed = collapsed[cat.id];
          return (
            <div key={cat.id} className="mb-3">
              <button
                onClick={() => setCollapsed((c) => ({ ...c, [cat.id]: !isCollapsed }))}
                className="w-full flex items-center gap-1 px-1 mb-1 text-[16px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-white transition-colors group"
              >
                <ChevronDown
                  size={12}
                  className={cn("transition-transform", isCollapsed && "-rotate-90")}
                />
                <span className="flex-1 text-left">{cat.name}</span>
                <Plus size={14} className="opacity-0 group-hover:opacity-100" />
              </button>
              {!isCollapsed &&
                cat.channels.map((ch) => (
                  <ChannelItem
                    key={ch.id}
                    channel={ch}
                    serverId={presenceRoom}
                    active={ch.id === activeChannelId}
                    occupants={voiceOccupants.get(ch.id)}
                    connectedHere={
                      voiceCurrent?.channelId === ch.id &&
                      (ch.type === "voice" || ch.type === "stream")
                    }
                    onMouseEnter={() => {
                      if (ch.type === "text" || ch.type === "announcement") {
                        prefetchChannel(ch.id);
                      }
                    }}
                    onClick={() => onSelect(ch)}
                    onJoinVoice={
                      ch.type === "voice" || ch.type === "stream"
                        ? () => {
                            onSelect(ch);
                            joinVoice({
                              serverId: presenceRoom ?? "global",
                              channelId: ch.id,
                              channelName: ch.name,
                            });
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            );
          })}
      </div>
      {/* User panel — hidden on desktop; full-width bottom bar replaces it */}
      <div className="md:hidden">
        <UserPanel onOpenSecurity={onOpenSecurity} onOpenProfile={onOpenProfile} />
      </div>
    </aside>
  );
}

// NOTE: the in-sidebar "房间" recruitment widget was removed at user
// request — it overlapped with the party channels and had no other UI
// entry left. The `rooms-store` itself is still consumed by PartyView
// for its recruitment slots, so the store stays alive.

function ChannelIcon({ type }: { type: Channel["type"] }) {
  switch (type) {
    case "voice":
      return <Volume2 size={20} className="shrink-0 opacity-80" />;
    case "stream":
      return <Radio size={20} className="shrink-0 opacity-80" />;
    case "trade":
      return <Coins size={20} className="shrink-0 opacity-80" />;
    case "party":
      return <Users size={20} className="shrink-0 opacity-80" />;
    case "announcement":
      return <Megaphone size={20} className="shrink-0 opacity-80 text-[var(--accent)]" />;
    default:
      return <Hash size={20} className="shrink-0 opacity-80" />;
  }
}

function ChannelItem({
  channel,
  serverId,
  active,
  occupants,
  connectedHere = false,
  onClick,
  onJoinVoice,
  onMouseEnter,
}: {
  channel: Channel;
  /** Used to derive the canonical `${serverId}:${channelId}` key for
   *  the last-message preview store. Optional because legacy callers
   *  (DM / preview / discover) don't pass it. */
  serverId?: string;
  active: boolean;
  occupants?: PresenceUser[];
  /** When true, the local user is already in this voice channel. Single-
   *  click switches to its chat instead of requiring a double-click
   *  (which would re-join). */
  connectedHere?: boolean;
  onClick: () => void;
  onJoinVoice?: () => void;
  onMouseEnter?: () => void;
}) {
  const isVoice = channel.type === "voice" || channel.type === "stream";
  const hasOccupants = isVoice && !!occupants && occupants.length > 0;
  // Per user request: announcement + regular text channels render at
  // roughly 2× voice-row height so they read as "primary" rows in
  // the sidebar. Voice / stream / party / trade keep the compact
  // layout because there can be many of them per server.
  const isTextLike =
    channel.type === "text" || channel.type === "announcement";
  // Per user request, party rows (组队大厅) should match the visual
  // weight of text/announcement rows. We keep `isTextLike` as the
  // gate for the two-line preview layout (party rooms don't have
  // messages, so the subtitle slot stays empty), but use this
  // separate `isLargeText` flag purely for the size class so 组队
  // 大厅 reads at the same text-[19px] / py-2 as 公告 / 聊天.
  const isLargeText = isTextLike || channel.type === "party" ||
    channel.type === "trade" || channel.type === "auction" || channel.type === "coins";
  // Look up the most-recent message for this channel so the
  // text/announcement row can show "author: text" as a subtitle.
  // Key matches what `messages.channel_id` holds — see
  // ChatView's send/insert (`${activeServerId}:${activeChannel.id}`).
  const previewKey = serverId ? `${serverId}:${channel.id}` : "";
  const preview = useLastMessages((s) =>
    previewKey ? s.byChannel[previewKey] : undefined,
  );
  const isUnread = useChannelUnread(channel.id);
  const isMention = useChannelMention(channel.id);
  // Default expanded; auto-expand when someone joins.
  const [expanded, setExpanded] = useState(true);
  const prevCountRef = useRef(occupants?.length ?? 0);
  useEffect(() => {
    const cur = occupants?.length ?? 0;
    if (cur > prevCountRef.current) setExpanded(true);
    prevCountRef.current = cur;
  }, [occupants?.length]);

  return (
    <div className="mb-0.5">
      <div className="flex items-center group/row">
        {/* Chevron — only for voice/stream channels */}
        {isVoice ? (
          <button
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); if (hasOccupants) setExpanded((v) => !v); }}
            className={cn(
              "w-5 h-full flex items-center justify-center shrink-0 text-[var(--text-muted)] transition-colors",
              hasOccupants ? "hover:text-white cursor-pointer" : "opacity-0 pointer-events-none",
            )}
          >
            {expanded
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />}
          </button>
        ) : (
          // Same width as the voice chevron (w-5 = 20px) so rows
          // without a chevron (text / announcement / party / trade)
          // still line up flush with the voice rows underneath.
          // Without this, "组队大厅" / "闲聊大厅" sat 12px to the
          // left of "突袭语音 1" — user-reported misalignment after
          // the 1.15× scaling pass.
          <div className="w-5 shrink-0" />
        )}

        <button
          onMouseEnter={onMouseEnter}
          onClick={
            // Voice channels: if already connected here, single-click
            // simply switches to this channel's chat (no re-join). If
            // NOT connected, single-click is suppressed so accidental
            // taps don't fire — only double-click joins. Non-voice
            // channels: single-click selects.
            onJoinVoice ? (connectedHere ? onClick : undefined) : onClick
          }
          onDoubleClick={onJoinVoice && !connectedHere ? onJoinVoice : undefined}
          title={
            onJoinVoice && !connectedHere
              ? `双击加入${channel.type === "stream" ? "直播" : "语音"}`
              : undefined
          }
          className={cn(
            "flex-1 flex items-center gap-2 rounded transition-colors min-w-0 select-none",
            // Per user request: scale everything in the channel
            // sidebar ~1.15× — text sizes, paddings, icon size.
            // text/announcement rows stay visually heavier than
            // voice/stream rows, but the gap closed up so the
            // sidebar reads as one consistent column rather than
            // "giant titles vs. tiny voice rows".
            isLargeText
              ? "px-2 py-2 text-[19px]"
              : "px-2 py-[6px] text-[16px]",
            active
              ? "bg-[var(--bg-light)] text-white"
              : isUnread
                ? "text-white hover:bg-[var(--bg-mid)]"
                : "text-[var(--text-muted)] hover:bg-[var(--bg-mid)] hover:text-[var(--text-normal)]",
          )}
        >
          <ChannelIcon type={channel.type} />
          {isTextLike ? (
            // Two-line layout per user request: channel name on top,
            // preview of the most-recent message below. Preview is
            // pre-loaded on server entry (see `useLastMessages.
            // loadLatestForChannels`) and kept fresh by the global
            // INSERT watcher in `app/page.tsx`.
            <div className="flex-1 min-w-0 flex flex-col items-start leading-tight">
              <span className="truncate w-full text-left">{channel.name}</span>
              <span className="truncate w-full text-left text-[12px] text-[var(--text-muted)] font-normal">
                {preview
                  ? `${preview.authorName}：${preview.content || "[图片]"}`
                  : "暂无消息"}
              </span>
            </div>
          ) : (
            <span className="flex-1 text-left truncate">{channel.name}</span>
          )}
          {/* Lock icon mirrors ChatView's default-locked semantics:
              - announcement: locked unless admin explicitly set readonly=false
              - text: only locked when readonly === true */}
          {(channel.type === "announcement"
            ? channel.readonly !== false
            : channel.readonly === true) && (
            <Lock size={11} className="shrink-0 opacity-50" />
          )}
          {isUnread && !active && (
            <span className={cn("size-2 rounded-full shrink-0", isMention ? "bg-[var(--danger)]" : "bg-white")} />
          )}
          {/* Voice occupant count */}
          {isVoice && occupants !== undefined && (
            <span className="text-[13px] font-mono shrink-0 tabular-nums text-[var(--text-muted)]">
              {String(occupants.length).padStart(2, "0")}/{String(channel.maxOccupants ?? 25).padStart(2, "0")}
            </span>
          )}
          {/* Join-voice shortcut button */}
          {onJoinVoice && (
            <span
              title="加入语音"
              className="opacity-0 group-hover/row:opacity-100 shrink-0 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onJoinVoice(); }}
            >
              <UserPlus size={13} className="text-[var(--text-muted)] hover:text-white" />
            </span>
          )}
        </button>
      </div>

      {/* Voice occupants list — collapsible */}
      {isVoice && hasOccupants && expanded && (
        <ul
          // Left-margin chosen so each occupant Avatar's left edge
          // lands exactly under the FIRST character of the parent
          // channel name (per user request). The channel button
          // upstream is: chevron (w-5 = 20px) + button px-2 (8px)
          // + ChannelIcon (size 20) + gap-2 (8px) = 56px before
          // the first char. We subtract the li's own px-0 here and
          // land the avatar exactly at 56px.
          className="ml-[44px] pl-3 py-0.5 space-y-0.5"
        >
          {occupants!.map((u) => (
            <li
              key={u.user_id}
              className="flex items-center gap-2 px-0 py-[6px] rounded text-[15px] text-[var(--text-normal)] hover:bg-[var(--bg-mid)] cursor-default select-none"
              title={u.username}
            >
              <Avatar
                text={u.avatar || u.username[0] || "?"}
                color={u.avatar_color || "var(--accent)"}
                url={u.avatar_url ?? undefined}
                size={28}
              />
              <span className="truncate flex-1">{u.username}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Invite button in the channel-sidebar header. Opens a small popover with
 * two copy options:
 *   - 复制邀请链接  → full URL (https://.../?invite=XXXXXX)
 *   - 复制邀请码    → just the 6-char code
 * If the server has no invite code yet, the button routes to settings so
 * the admin can generate one first.
 */
function InviteButton({
  inviteBtnRef,
  invitePopRef,
  open,
  copiedVariant,
  hasCode,
  inviteCode,
  onButtonClick,
  onCopyLink,
  onCopyCode,
}: {
  inviteBtnRef: React.RefObject<HTMLButtonElement | null>;
  invitePopRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  copiedVariant: "link" | "code" | null;
  hasCode: boolean;
  inviteCode?: string;
  onButtonClick: () => void;
  onCopyLink: () => void;
  onCopyCode: () => void;
}) {
  return (
    <div className="relative">
      <button
        ref={inviteBtnRef}
        type="button"
        title={copiedVariant ? "已复制！" : hasCode ? "邀请伙伴" : "生成邀请码"}
        onClick={onButtonClick}
        className={cn(
          "size-7 grid place-items-center rounded transition-colors",
          copiedVariant
            ? "text-[var(--success)]"
            : "text-[var(--text-muted)] hover:text-[var(--success)] hover:bg-[var(--bg-mid)]",
        )}
      >
        {copiedVariant ? <Check size={15} /> : <UserPlus size={15} />}
      </button>
      {open && (
        <div
          ref={invitePopRef}
          className="absolute top-full right-0 mt-1.5 w-56 rounded-md bg-[var(--bg-darkest)] border border-[var(--bg-mid)] shadow-xl z-50 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-[var(--bg-mid)]/60">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
              邀请码
            </div>
            <div className="text-sm font-mono text-white tracking-wider select-all">
              {inviteCode || "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={onCopyLink}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-normal)] hover:bg-[var(--accent)]/20 hover:text-white flex items-center justify-between gap-2"
          >
            <span>复制邀请链接</span>
            {copiedVariant === "link" && (
              <Check size={14} className="text-[var(--success)]" />
            )}
          </button>
          <button
            type="button"
            onClick={onCopyCode}
            className="w-full text-left px-3 py-2 text-sm text-[var(--text-normal)] hover:bg-[var(--accent)]/20 hover:text-white flex items-center justify-between gap-2"
          >
            <span>复制邀请码</span>
            {copiedVariant === "code" && (
              <Check size={14} className="text-[var(--success)]" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

