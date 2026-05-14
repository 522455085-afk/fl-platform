"use client";

/**
 * Two-section sidebar shown when the user clicks the MessageSquare icon.
 *
 * Upper section: "好友" category links
 *   - 在线 / 全部 / 亲密关系 / 请求 / 已屏蔽
 *   Clicking a link selects that category in `useDmView`, which drives what
 *   DmHome renders on the right. Also clears any active DM so the user is
 *   taken back to the friends grid.
 *
 * Lower section: "私信" — recent DM threads (persisted in `dm_threads`
 *   collection). Clicking a row opens that DM conversation.
 *
 * Both sections are collapsible. Designed to visually match the reference
 * screenshot supplied by the user.
 */

import {
  UserPlus,
  Compass,
  Search,
  X,
  ChevronDown,
  Circle,
  Users,
  Heart,
  Inbox,
  Ban,
  Gavel,
} from "lucide-react";
import { useState } from "react";
import UserPanel from "@/components/UserPanel";
import {
  useDmThreads,
  type DmThreadRow,
} from "@/lib/dm-threads-store";
import { useDmView, type DmCategory } from "@/lib/dm-view-store";
import { useFriends, useSocial } from "@/lib/social-store";
import { usePresence } from "@/lib/use-presence";
import { cn } from "@/lib/utils";
import { displayUsername } from "@/lib/deleted-user";
import Avatar from "@/components/Avatar";
import { confirm } from "@/lib/confirm-store";
import { useTradeDm } from "@/lib/trade-dm-store";

type Props = {
  /** Kept for backward compat; unused — online dots always read from global. */
  presenceRoom?: string;
  onOpenDm: (target: {
    user_id: string;
    username: string;
    avatar: string;
    avatar_color: string;
    avatar_url?: string | null;
  }) => void;
  /** Called when any 好友 category is selected — the host should close any
   *  active DM so DmHome is rendered on the right. */
  onSelectFriendsHome?: () => void;
  onOpenDiscover?: () => void;
  onAddFriend?: () => void;
  onOpenSecurity?: () => void;
  onOpenProfile?: () => void;
};

export default function DmSidebar({
  onOpenDm,
  onSelectFriendsHome,
  onOpenDiscover,
  onAddFriend,
  onOpenSecurity,
  onOpenProfile,
}: Props) {
  return (
    <aside className="w-[324px] shrink-0 bg-[var(--bg-darker)] flex flex-col">
      {/* Header */}
      <div className="h-14 px-3 flex items-center gap-2 border-b border-black/30 shadow-sm shrink-0">
        <div className="flex-1 flex items-center gap-1.5 bg-[var(--bg-darkest)] rounded px-2 h-7 text-[13px] text-[var(--text-muted)]">
          <Search size={14} />
          <span className="truncate">查找好友或会话</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-2 pt-2 pb-1 space-y-0.5">
        <ActionRow
          icon={<UserPlus size={16} className="text-[var(--accent)]" />}
          label="添加好友"
          subtitle="按名字发送好友请求"
          onClick={onAddFriend}
        />
        <ActionRow
          icon={<Compass size={16} className="text-[var(--success)]" />}
          label="发现公会"
          subtitle="浏览所有公开公会"
          onClick={onOpenDiscover}
        />
      </div>

      <div className="mx-3 my-2 h-px bg-[var(--bg-mid)]/60" />

      {/* Scrollable body: friends categories + DM threads */}
      <div className="flex-1 overflow-y-auto px-2">
        <FriendsCategoriesSection onSelectHome={onSelectFriendsHome} />
        <DmThreadsSection onOpenDm={onOpenDm} />
      </div>

      {/* Bottom user bar — hidden on desktop; full-width bottom bar replaces it */}
      <div className="md:hidden">
        <UserPanel
          onOpenSecurity={onOpenSecurity}
          onOpenProfile={onOpenProfile}
        />
      </div>
    </aside>
  );
}

// ============================================================
// 好友 category links
// ============================================================

function FriendsCategoriesSection({
  onSelectHome,
}: {
  onSelectHome?: () => void;
}) {
  const { friends, incoming, outgoing } = useFriends();
  const blockedIds = useSocial((s) => s.blockedIds);
  const presence = usePresence("global");
  const onlineIds = new Set(presence.map((p) => p.user_id));
  const { category, setCategory } = useDmView();
  const [collapsed, setCollapsed] = useState(false);

  const onlineCount = friends.filter((f) => onlineIds.has(f.user_id)).length;
  const requestCount = incoming.length + outgoing.length;

  const handleSelect = (c: DmCategory) => {
    setCategory(c);
    onSelectHome?.();
  };

  return (
    <div className="mb-3">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-1 px-1 mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-white transition-colors"
      >
        <ChevronDown
          size={12}
          className={cn("transition-transform", collapsed && "-rotate-90")}
        />
        <span className="flex-1 text-left">好友</span>
      </button>
      {!collapsed && (
        <ul className="space-y-0.5">
          <CategoryRow
            label="在线"
            icon={<Circle size={14} className="text-[var(--success)] fill-[var(--success)]" />}
            count={onlineCount}
            active={category === "online"}
            onClick={() => handleSelect("online")}
          />
          <CategoryRow
            label="全部"
            icon={<Users size={14} />}
            count={friends.length}
            active={category === "all"}
            onClick={() => handleSelect("all")}
          />
          <CategoryRow
            label="亲密关系"
            icon={<Heart size={14} className="text-[var(--accent)]" />}
            count={0}
            active={category === "close"}
            onClick={() => handleSelect("close")}
          />
          <CategoryRow
            label="请求"
            icon={<Inbox size={14} />}
            count={requestCount}
            highlight={incoming.length > 0}
            active={category === "requests"}
            onClick={() => handleSelect("requests")}
          />
          <CategoryRow
            label="已屏蔽"
            icon={<Ban size={14} />}
            count={blockedIds.length}
            active={category === "blocked"}
            onClick={() => handleSelect("blocked")}
          />
        </ul>
      )}
    </div>
  );
}

function CategoryRow({
  label,
  icon,
  count,
  active,
  highlight,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active?: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full h-8 px-2 rounded flex items-center gap-2 text-[13px] transition-colors",
          active
            ? "bg-[var(--bg-mid)] text-white"
            : "text-[var(--text-muted)] hover:bg-[var(--bg-mid)]/50 hover:text-white",
        )}
      >
        <span className="shrink-0 grid place-items-center w-4">{icon}</span>
        <span className="flex-1 text-left truncate">{label}</span>
        {count > 0 && (
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full shrink-0",
              highlight
                ? "bg-[var(--danger)] text-white font-bold"
                : "bg-[var(--bg-darkest)] text-[var(--text-muted)]",
            )}
          >
            {count}
          </span>
        )}
      </button>
    </li>
  );
}
// 私信 — recent DM threads
// ============================================================

type OpenDmFn = (target: {
  user_id: string;
  username: string;
  avatar: string;
  avatar_color: string;
  avatar_url?: string | null;
}) => void;

function DmThreadsSection({ onOpenDm }: { onOpenDm: OpenDmFn }) {
  const threads = useDmThreads((s) => s.threads);
  const hideThread = useDmThreads((s) => s.hideThread);
  const presence = usePresence("global");
  const presenceById = new Map(presence.map((p) => [p.user_id, p]));
  const tradeHas = useTradeDm((s) => s.has);
  const [collapsed, setCollapsed] = useState(false);
  const [tradeCollapsed, setTradeCollapsed] = useState(false);

  const regularThreads = threads.filter((t) => !tradeHas(t.partner_id));
  const tradeThreads = threads.filter((t) => tradeHas(t.partner_id));

  const renderThread = (t: DmThreadRow) => {
    const p = presenceById.get(t.partner_id);
    const partnerStatus: "online" | "away" | "offline" = !p
      ? "offline"
      : p.status === "away" ? "away" : "online";
    const freshAvatar = p?.avatar || t.partner_avatar;
    const freshColor = p?.avatar_color || t.partner_color;
    const freshAvatarUrl = p ? (p.avatar_url ?? null) : (t.partner_avatar_url ?? null);
    const freshName = p?.username || t.partner_name;
    return (
      <ThreadRow
        key={t.thread_key}
        thread={t}
        freshAvatar={freshAvatar}
        freshColor={freshColor}
        freshAvatarUrl={freshAvatarUrl}
        freshName={freshName}
        status={partnerStatus}
        onClick={() => onOpenDm({ user_id: t.partner_id, username: freshName, avatar: freshAvatar, avatar_color: freshColor, avatar_url: freshAvatarUrl })}
        onHide={async () => {
          const ok = await confirm(
            `从私信列表移除与「${displayUsername(freshName)}」的会话？\n隐藏后再次收到对方消息会自动重新出现。`,
            { id: "dm-hide", rememberLabel: "不再询问" },
          );
          if (ok) hideThread(t.partner_id);
        }}
      />
    );
  };

  return (
    <>
      {/* 普通私信 */}
      <div className="mb-3">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center gap-1 px-1 mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-white transition-colors"
        >
          <ChevronDown size={12} className={cn("transition-transform", collapsed && "-rotate-90")} />
          <span className="flex-1 text-left">
            私信{regularThreads.length > 0 ? ` · ${regularThreads.length}` : ""}
          </span>
        </button>
        {!collapsed && (
          regularThreads.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-[var(--text-muted)] italic">还没有私信会话。</div>
          ) : (
            <ul>{regularThreads.map(renderThread)}</ul>
          )
        )}
      </div>

      {/* 交易行私信 — 仅当存在交易来源的 DM 时显示 */}
      {tradeThreads.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setTradeCollapsed((v) => !v)}
            className="w-full flex items-center gap-1 px-1 mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-white transition-colors"
          >
            <ChevronDown size={12} className={cn("transition-transform", tradeCollapsed && "-rotate-90")} />
            <Gavel size={11} className="opacity-70" />
            <span className="flex-1 text-left">
              交易行私信{tradeThreads.length > 0 ? ` · ${tradeThreads.length}` : ""}
            </span>
          </button>
          {!tradeCollapsed && (
            <ul>{tradeThreads.map(renderThread)}</ul>
          )}
        </div>
      )}
    </>
  );
}

function ThreadRow({
  thread,
  freshAvatar,
  freshColor,
  freshAvatarUrl,
  freshName,
  status,
  onClick,
  onHide,
}: {
  thread: DmThreadRow;
  /** Fresh avatar data resolved from presence (or cached thread row) — see
   *  avatar bugfix in DmThreadsSection. */
  freshAvatar: string;
  freshColor: string;
  freshAvatarUrl: string | null;
  freshName: string;
  status: "online" | "away" | "offline";
  onClick: () => void;
  onHide: () => void;
}) {
  const online = status !== "offline";
  const dotClass =
    status === "online"
      ? "bg-[var(--success)]"
      : status === "away"
        ? "bg-[var(--warning)]"
        : "bg-[var(--text-muted)]";
  const unread = thread.unread_count || 0;
  const ts = formatRelative(thread.last_message_at);
  return (
    <li
      className="group mx-0 px-2 py-1.5 rounded flex items-center gap-2 hover:bg-[var(--bg-mid)] transition-colors cursor-pointer"
      onClick={onClick}
      title={`与 ${displayUsername(freshName)} 的私信`}
    >
      <div className="relative shrink-0">
        <Avatar
          text={freshAvatar}
          color={freshColor}
          url={freshAvatarUrl}
          size={32}
          className={cn(!online && "grayscale opacity-60")}
        />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--bg-darker)]",
            dotClass,
          )}
          title={status === "away" ? "离开" : status === "online" ? "在线" : "离线"}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1">
          <span
            className={cn(
              "text-[13px] truncate flex-1",
              unread > 0 ? "font-semibold text-white" : "text-[var(--text-normal)]",
            )}
          >
            {displayUsername(freshName)}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] shrink-0">{ts}</span>
        </div>
        <div className="text-[11px] text-[var(--text-muted)] truncate">
          {thread.last_preview || "—"}
        </div>
      </div>
      {unread > 0 && (
        <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--danger)] text-[10px] font-bold text-white grid place-items-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onHide();
        }}
        className="opacity-0 group-hover:opacity-100 size-5 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-darker)]"
        title="从列表隐藏"
      >
        <X size={12} />
      </button>
    </li>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`;
  const M = d.getMonth() + 1;
  const D = d.getDate();
  return `${M}/${D}`;
}

function ActionRow({
  icon,
  label,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-mid)] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="size-7 rounded grid place-items-center bg-[var(--bg-mid)] shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[var(--text-normal)] truncate">
          {label}
        </div>
        {subtitle && (
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            {subtitle}
          </div>
        )}
      </div>
    </button>
  );
}
