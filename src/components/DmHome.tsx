"use client";

import { useState } from "react";

/**
 * Right-side content shown when the user is in DM view but hasn't opened a
 * specific conversation. Renders a friend card grid (KOOK-style) driven by
 * the currently selected category in `useDmView` —"在线 / 全部 / 亲密关系 /
 * 请求 / 已屏蔽.
 *
 * Each friend is shown as a tile with their avatar, username#tag, online
 * status, and quick-action icons (message, voice call, — remove). The
 * tiles flow in a responsive 1/2/3-column grid depending on width.
 *
 * The "请求" and "已屏蔽 views stay as full-width lists since they have
 * buttons that need labels; the rest are cards.
 */

import {
  Menu,
  MessageSquare,
  Phone,
  MoreHorizontal,
  UserMinus,
  Ban,
  Users,
} from "lucide-react";
import {
  useFriends,
  useSocial,
  type FriendshipRow,
  type FriendSummary,
} from "@/lib/social-store";
import { useDmView, type DmCategory } from "@/lib/dm-view-store";
import { usePresence } from "@/lib/use-presence";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import { confirm } from "@/lib/confirm-store";

type Props = {
  onOpenNav?: () => void;
  /** Host opens a DM with the given friend. */
  onOpenDm?: (target: {
    user_id: string;
    username: string;
    avatar: string;
    avatar_color: string;
    avatar_url?: string | null;
  }) => void;
};

const CATEGORY_LABEL: Record<DmCategory, string> = {
  online: "在线",
  all: "全部",
  close: "亲密关系",
  requests: "请求",
  blocked: "已屏蔽",
};

export default function DmHome({ onOpenNav, onOpenDm }: Props) {
  const { user: me } = useAuth();
  const { friends, incoming, outgoing } = useFriends();
  const { acceptFriendRequest, declineFriendRequest, removeFriend, unblockUser } =
    useSocial();
  const blockedIds = useSocial((s) => s.blockedIds);
  const presence = usePresence("global");
  const onlineIds = new Set(presence.map((p) => p.user_id));
  const category = useDmView((s) => s.category);

  const meLabel = me?.username || "玩家";
  const meTag = ""; // numeric tag hidden per user request

  const headerCount = (() => {
    switch (category) {
      case "online":
        return friends.filter((f) => onlineIds.has(f.user_id)).length;
      case "all":
        return friends.length;
      case "close":
        return 0;
      case "requests":
        return incoming.length + outgoing.length;
      case "blocked":
        return blockedIds.length;
    }
  })();

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-[var(--bg-dark)]">
      {/* Top strip: my identity */}
      <div className="px-4 pt-3 pb-2 shrink-0 flex items-center gap-3">
        {onOpenNav && (
          <button
            onClick={onOpenNav}
            className="md:hidden size-8 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <Menu size={20} />
          </button>
        )}
        <Avatar
          text={me?.avatar || "?"}
          color={me?.avatarColor || "#555"}
          url={me?.avatarUrl}
          size={32}
        />
        <div className="font-semibold text-white truncate">
          {meLabel}
        </div>
      </div>

      {/* Section header: current category + count */}
      <div className="px-4 pb-2 shrink-0 flex items-center gap-2">
        <Users size={16} className="text-[var(--text-muted)]" />
        <h2 className="text-[13px] font-semibold text-white">
          {CATEGORY_LABEL[category]} - {headerCount}
        </h2>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {category === "online" && (
          <FriendGrid
            friends={friends.filter((f) => onlineIds.has(f.user_id))}
            onlineIds={onlineIds}
            onOpenDm={onOpenDm}
            onRemove={removeFriend}
            emptyHint="当前没有好友在线。"
          />
        )}
        {category === "all" && (
          <FriendGrid
            friends={friends}
            onlineIds={onlineIds}
            onOpenDm={onOpenDm}
            onRemove={removeFriend}
            emptyHint="还没有好友，点左侧「添加好友」找个拜把子吧。"
          />
        )}
        {category === "close" && (
          <div className="py-16 text-center text-[var(--text-muted)] italic">
            亲密关系功能即将上线 —这里会显示你标记为挚友/ CP 的好友。          </div>
        )}
        {category === "requests" && (
          <PendingSection
            incoming={incoming}
            outgoing={outgoing}
            onAccept={acceptFriendRequest}
            onDecline={declineFriendRequest}
          />
        )}
        {category === "blocked" && (
          <BlockedSection blockedIds={blockedIds} onUnblock={unblockUser} />
        )}
      </div>
    </section>
  );
}

// ============================================================
// Friend grid (cards)
// ============================================================

function FriendGrid({
  friends,
  onlineIds,
  onOpenDm,
  onRemove,
  emptyHint,
}: {
  friends: FriendSummary[];
  onlineIds: Set<string>;
  onOpenDm?: (target: {
    user_id: string;
    username: string;
    avatar: string;
    avatar_color: string;
    avatar_url?: string | null;
  }) => void;
  onRemove: (friendshipId: string) => Promise<{ ok: boolean; error?: string } | void> | void;
  emptyHint: string;
}) {
  if (friends.length === 0) {
    return (
      <div className="py-16 text-center text-[var(--text-muted)] italic">
        {emptyHint}
      </div>
    );
  }

  const sorted = [...friends].sort((a, b) => {
    const ao = onlineIds.has(a.user_id) ? 0 : 1;
    const bo = onlineIds.has(b.user_id) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return a.username.localeCompare(b.username);
  });

  return (
    // Grid-auto-fill with a fixed column width keeps each friend card at a
    // consistent size regardless of viewport / zoom. We also cap the
    // container to ~1000px so on ultra-wide setups the cards don't stretch
    // into a long banner across the whole screen.
    <div
      className="grid gap-3 max-w-[720px]"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
    >
      {sorted.map((f) => (
        <FriendCard
          key={f.friendship_id}
          friend={f}
          online={onlineIds.has(f.user_id)}
          onMessage={() =>
            onOpenDm?.({
              user_id: f.user_id,
              username: f.username,
              avatar: f.avatar,
              avatar_color: f.avatar_color,
              avatar_url: f.avatar_url ?? null,
            })
          }
          onRemove={() => onRemove(f.friendship_id)}
        />
      ))}
    </div>
  );
}

function FriendCard({
  friend,
  online,
  onMessage,
  onRemove,
}: {
  friend: FriendSummary;
  online: boolean;
  onMessage: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-[var(--bg-darker)] rounded-lg px-3 py-4 flex flex-col gap-3 hover:bg-[var(--bg-darker)]/70 transition-colors">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <Avatar
            text={friend.avatar}
            color={friend.avatar_color}
            url={friend.avatar_url}
            size={54}
            className={cn(!online && "opacity-60 grayscale")}
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-4 rounded-full border-2 border-[var(--bg-darker)]",
              online ? "bg-[var(--success)]" : "bg-[var(--text-muted)]",
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[19px] font-semibold text-white truncate">
            {friend.username}
          </div>
          <div className="text-[15px] text-[var(--text-muted)] truncate">
            {online ? "在线" : "离线"}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 text-[var(--text-muted)]">
        <IconBtn
          title="语音呼叫（暂未上线）"
          icon={<Phone size={16} />}
          disabled
        />
        <IconBtn title="发送私信" icon={<MessageSquare size={16} />} onClick={onMessage} />
        <IconBtn
          title="更多（暂未上线）"
          icon={<MoreHorizontal size={16} />}
          disabled
        />
        <IconBtn
          title="移除好友"
          icon={<UserMinus size={16} />}
          onClick={() => {
            void (async () => {
              if (await confirm(`确定要把 ${friend.username} 从好友列表移除吗？`)) {
                onRemove();
              }
            })();
          }}
          hoverColor="var(--danger)"
        />
      </div>
    </div>
  );
}

function IconBtn({
  icon,
  title,
  onClick,
  disabled,
  hoverColor,
}: {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  hoverColor?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "size-8 grid place-items-center rounded bg-[var(--bg-mid)]/40 transition-colors",
        disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-[var(--bg-mid)] hover:text-white",
      )}
      style={
        hoverColor
          ? { ["--tw-color" as string]: hoverColor }
          : undefined
      }
    >
      {icon}
    </button>
  );
}

// ============================================================
// Pending (incoming + outgoing) —kept as a list since rows need wide buttons
// ============================================================

function PendingSection({
  incoming,
  outgoing,
  onAccept,
  onDecline,
}: {
  incoming: FriendshipRow[];
  outgoing: FriendshipRow[];
  onAccept: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onDecline: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const handleAccept = async (id: string) => {
    setLoadingIds((prev) => new Set(prev).add(id));
    try { await onAccept(id); } finally { setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
  };
  const handleDecline = async (id: string) => {
    setLoadingIds((prev) => new Set(prev).add(id));
    try { await onDecline(id); } finally { setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next; }); }
  };
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="py-16 text-center text-[var(--text-muted)] italic">
        没有待处理的请求。      </div>
    );
  }
  return (
    <div className="space-y-4 max-w-[720px]">
      {incoming.length > 0 && (
        <div>
          <div className="px-2 text-[11px] uppercase tracking-wider text-[var(--warning)] mb-2">
            收到的请求•{incoming.length}
          </div>
          <ul className="divide-y divide-[var(--bg-mid)]/50">
            {incoming.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 px-2 py-2"
              >
                <Avatar
                  text={f.requester_avatar}
                  color={f.requester_color}
                  url={f.requester_avatar_url}
                  size={36}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {f.requester_name}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    想加你为好友
                  </div>
                </div>
                <button
                  onClick={() => handleAccept(f.id)}
                  disabled={loadingIds.has(f.id)}
                  className="text-xs px-3 h-7 rounded bg-[var(--success)]/20 text-[var(--success)] hover:bg-[var(--success)]/40 disabled:opacity-50"
                >
                  {loadingIds.has(f.id) ? "…" : "接受"}
                </button>
                <button
                  onClick={() => handleDecline(f.id)}
                  className="text-xs px-3 h-7 rounded bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/40"
                >
                  拒绝
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {outgoing.length > 0 && (
        <div>
          <div className="px-2 text-[11px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
            已发出•{outgoing.length}
          </div>
          <ul className="divide-y divide-[var(--bg-mid)]/50">
            {outgoing.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-2 py-2">
                <Avatar
                  text={f.addressee_avatar}
                  color={f.addressee_color}
                  url={f.addressee_avatar_url}
                  size={36}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">
                    {f.addressee_name}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    等待对方确认…                  </div>
                </div>
                <button
                  onClick={() => onDecline(f.id)}
                  className="text-xs px-3 h-7 rounded border border-[var(--bg-mid)] text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)]/40"
                >
                  撤回
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Blocked list
// ============================================================

function BlockedSection({
  blockedIds,
  onUnblock,
}: {
  blockedIds: string[];
  onUnblock: (id: string) => void;
}) {
  if (blockedIds.length === 0) {
    return (
      <div className="py-16 text-center text-[var(--text-muted)] italic">
        暂无被屏蔽的用户。      </div>
    );
  }
  return (
    <ul className="divide-y divide-[var(--bg-mid)]/50 max-w-[720px]">
      {blockedIds.map((id) => (
        <li key={id} className="flex items-center gap-3 px-2 py-2">
          <div className="size-9 rounded-full grid place-items-center bg-[var(--bg-mid)] text-[var(--text-muted)] shrink-0">
            <Ban size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white font-mono truncate">
              {id.slice(0, 8)}…{id.slice(-4)}
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              UID 已被屏蔽
            </div>
          </div>
          <button
            onClick={() => onUnblock(id)}
            className="text-xs px-3 h-7 rounded border border-[var(--bg-mid)] text-[var(--warning)] hover:bg-[var(--warning)]/10"
          >
            解除屏蔽
          </button>
        </li>
      ))}
    </ul>
  );
}
