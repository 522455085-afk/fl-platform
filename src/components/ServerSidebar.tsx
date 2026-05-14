"use client";

import { Compass, MessageSquare, Settings } from "lucide-react";
import Image from "next/image";
import { useFriends } from "@/lib/social-store";
import { useTotalDmUnread } from "@/lib/dm-threads-store";
import { useAllServers } from "@/lib/servers-store";
import { useMyServerRole } from "@/lib/server-roles-store";
import { useIsAdmin, isFounderId } from "@/lib/roles";
import { useAuth } from "@/lib/auth-store";
import { type Server } from "@/lib/mock-data";
import { isAvatarUrl } from "@/lib/avatar-upload";
import { useServerUnreadCount, useServerHasMention, useServerMentionCount } from "@/lib/unread-store";
import { cn } from "@/lib/utils";

export type SidebarView = "server" | "dm" | "discover";

type Props = {
  activeId: string;
  view: SidebarView;
  onSelect: (id: string) => void;
  onOpenDm: () => void;
  onOpenDiscover: () => void;
  onAddServer: () => void;
  /** Open the JoinServerModal (invite code + browse public). */
  onJoinServer: () => void;
  /** Right-click on a server icon → open its settings (creator/admin only). */
  onOpenServerSettings?: (serverId: string) => void;
  /** Right-click on a server icon → open the contextual menu. */
  onOpenServerMenu?: (serverId: string, x: number, y: number) => void;
};

export default function ServerSidebar({
  activeId,
  view,
  onSelect,
  onOpenDm,
  onOpenDiscover,
  onAddServer,
  onJoinServer,
  onOpenServerSettings,
  onOpenServerMenu,
}: Props) {
  const { incoming } = useFriends();
  const totalUnread = useTotalDmUnread();
  const dmBadge = incoming.length + totalUnread;
  const allServers = useAllServers();

  return (
    <aside className="w-[90px] shrink-0 bg-[var(--bg-darkest)] flex flex-col items-center py-2 gap-3">
      {/* Top: DM + Discover */}
      <SpecialIcon
        icon={<MessageSquare size={22} />}
        label="私信 / 好友"
        active={view === "dm"}
        accent="accent"
        badge={dmBadge}
        onClick={onOpenDm}
      />
      <SpecialIcon
        icon={<Compass size={22} />}
        label="发现公会 / 搜索频道"
        active={view === "discover"}
        accent="success"
        onClick={onOpenDiscover}
      />
      <Divider />

      {/* Servers (scrollable middle region) */}
      <div className="flex-1 w-full flex flex-col items-center gap-3 overflow-y-auto no-scrollbar min-h-0">
        {allServers.map((s) => (
          <ServerIcon
            key={s.id}
            server={s}
            active={activeId === s.id}
            onClick={() => onSelect(s.id)}
            onOpenSettings={
              onOpenServerSettings
                ? () => onOpenServerSettings(s.id)
                : undefined
            }
            onOpenMenu={
              onOpenServerMenu
                ? (x, y) => onOpenServerMenu(s.id, x, y)
                : undefined
            }
          />
        ))}
      </div>

      {/* Bottom: the divider has been moved to below the + button
          in the bottom bar (BottomBarComposer / page.tsx). */}
    </aside>
  );
}

function SpecialIcon({
  icon,
  label,
  active,
  accent,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  accent: "accent" | "success";
  badge?: number;
  onClick: () => void;
}) {
  const color =
    accent === "accent" ? "var(--accent)" : "var(--success)";
  return (
    <div className="relative group w-full flex justify-center">
      <span
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full transition-all",
          active ? "h-10" : "h-0 group-hover:h-4",
        )}
        style={{ background: color, boxShadow: active ? `0 0 8px ${color}` : undefined }}
      />
      <button
        onClick={onClick}
        title={label}
        className={cn(
          "size-14 rounded-xl grid place-items-center transition-all duration-200 hover:rounded-2xl",
          active
            ? "text-white"
            : "bg-[var(--bg-darker)] border border-[var(--bg-mid)] text-[var(--text-muted)] hover:text-white",
        )}
        style={
          active
            ? { background: color, boxShadow: `0 0 18px ${color}` }
            : undefined
        }
      >
        {icon}
      </button>
      {badge ? (
        <span className="absolute -bottom-0.5 right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--danger)] text-[11px] font-bold text-white grid place-items-center border-[3px] border-[var(--bg-darkest)]">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </div>
  );
}

function ServerIcon({
  server,
  active,
  onClick,
  onOpenSettings,
  onOpenMenu,
}: {
  server: Server;
  active: boolean;
  onClick: () => void;
  onOpenSettings?: () => void;
  onOpenMenu?: (x: number, y: number) => void;
}) {
  // Show a tiny settings cog on hover when the user can manage this server
  // (creator / admin of a non-official server). For official servers the
  // cog appears for platform admins, but only if a handler is provided.
  const myRole = useMyServerRole(server.id);
  const isPlatformAdmin = useIsAdmin();
  const { user } = useAuth();
  const allChannelIds = (server.channels ?? []).flatMap((c) => c.channels.map((ch) => ch.id));
  const unreadCount = useServerUnreadCount(allChannelIds);
  const hasMention = useServerHasMention(server.id, allChannelIds);
  const mentionCount = useServerMentionCount(server.id, allChannelIds);
  const canManage =
    !!onOpenSettings &&
    (server.is_official
      ? isPlatformAdmin || isFounderId(user?.id)
      : myRole === "creator" || myRole === "admin");
  return (
    <div className="relative group w-full flex justify-center">
      <span
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-[var(--accent)] transition-all",
          active ? "h-10 shadow-[0_0_8px_var(--accent-glow)]" : "h-0 group-hover:h-4",
        )}
      />
      <button
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (onOpenMenu) {
            onOpenMenu(e.clientX, e.clientY);
          } else if (canManage) {
            onOpenSettings?.();
          }
        }}
        title={`${server.name}（右键打开菜单）`}
        className={cn(
          "relative size-14 rounded-xl grid place-items-center text-white font-semibold transition-all duration-200 overflow-hidden",
          "hover:scale-105 hover:shadow-[0_0_18px_var(--accent-glow)]",
          active ? "ring-2 ring-[var(--accent)] shadow-[0_0_20px_var(--accent-glow)]" : "",
        )}
        style={
          isAvatarUrl(server.iconUrl)
            ? undefined
            : {
                background: `linear-gradient(135deg, ${server.iconColor}, ${shade(server.iconColor, -20)})`,
              }
        }
      >
        {isAvatarUrl(server.iconUrl) ? (
          <Image
            src={server.iconUrl as string}
            alt={server.name}
            fill
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          server.iconText
        )}
      </button>
      {canManage && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSettings?.();
          }}
          title="服务器设置"
          className="absolute -top-1 -right-1 size-5 rounded-full bg-[var(--bg-darker)] border border-[var(--bg-mid)] text-[var(--text-muted)] grid place-items-center opacity-0 group-hover:opacity-100 hover:text-white"
        >
          <Settings size={11} />
        </button>
      )}
      {/* Two independent badges, mirroring the original layout:
          - Red @-mention badge: bottom-right corner, now a number
            (used to be a small pulse dot). Shows when ANY channel
            in this server has an unread @mention.
          - White channel-unread badge: slightly to the left
            (right-3), shows the count of unread channels overall.
          Both can appear simultaneously — e.g. "3 unread channels,
          1 of them is a mention". */}
      {hasMention && !active && (
        <span
          title={`有 ${mentionCount || 1} 条未读 @ 提及`}
          className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--danger)] text-[11px] font-bold text-white grid place-items-center border-[3px] border-[var(--bg-darkest)] shadow-[0_0_6px_var(--danger)]"
        >
          {mentionCount > 99 ? "99+" : mentionCount > 0 ? mentionCount : "·"}
        </span>
      )}
      {unreadCount > 0 && !active ? (
        <span className="absolute -bottom-0.5 right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--text-bright)] text-[11px] font-bold text-[var(--bg-darkest)] grid place-items-center border-[3px] border-[var(--bg-darkest)]">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  colorClass,
}: {
  icon: React.ReactNode;
  label: string;
  colorClass: string;
}) {
  return (
    <button
      title={label}
      className={cn(
        "size-12 rounded-xl grid place-items-center bg-[var(--bg-darker)] hover:bg-[var(--accent)]/20 hover:text-[var(--accent)] hover:scale-105 transition-all duration-200 border border-[var(--bg-mid)]",
        colorClass,
      )}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <div className="w-8 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent my-0.5" />;
}

function shade(hex: string, percent: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const factor = (100 + percent) / 100;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}
