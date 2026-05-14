"use client";

/**
 * Right-click menu on a server icon (Discord-style).
 *
 * Opens at the cursor position. The host (`ServerSidebar` → `page.tsx`)
 * tracks `{ serverId, x, y }` and renders <ServerContextMenu /> when set.
 *
 * Design notes:
 *   - Items disabled based on `myRole` (creator / admin / member) and
 *     whether the server is official.
 *   - 「免打扰」has a submenu that opens to the right on hover (or below on
 *     mobile via touch). Uses local state, not a global popover library.
 *   - Closes on: outside click, Escape, or any item activation.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Check, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerPrefs, useServerPref } from "@/lib/server-prefs-store";
import { useMyServerRole } from "@/lib/server-roles-store";
import { useAllServers } from "@/lib/servers-store";
import { useAuth } from "@/lib/auth-store";
import { isFounderId, isPlatformAdminId } from "@/lib/roles";

type Props = {
  serverId: string;
  /** Cursor position (page coordinates). */
  x: number;
  y: number;
  onClose: () => void;
  // Item handlers
  onMarkRead: () => void;
  onInvite: () => void;
  onOpenNotify: () => void;
  onOpenPrivacy: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onLeave: () => void;
  onCopyName: () => void;
  onOpenSettings?: () => void;
};

const MUTE_OPTIONS: { label: string; durationMs: number | null }[] = [
  { label: "15 分钟", durationMs: 15 * 60 * 1000 },
  { label: "1 小时", durationMs: 60 * 60 * 1000 },
  { label: "3 小时", durationMs: 3 * 60 * 60 * 1000 },
  { label: "8 小时", durationMs: 8 * 60 * 60 * 1000 },
  { label: "24 小时", durationMs: 24 * 60 * 60 * 1000 },
  { label: "直到我打开它", durationMs: 365 * 24 * 60 * 60 * 1000 },
];

export default function ServerContextMenu({
  serverId,
  x,
  y,
  onClose,
  onMarkRead,
  onInvite,
  onOpenNotify,
  onOpenPrivacy,
  onCollapseAll,
  onExpandAll,
  onLeave,
  onCopyName,
  onOpenSettings,
}: Props) {
  const allServers = useAllServers();
  const server = allServers.find((s) => s.id === serverId);
  const isOfficial = !!server?.is_official;
  const role = useMyServerRole(serverId);
  const { user } = useAuth();
  const isPlatformStaff = isFounderId(user?.id) || isPlatformAdminId(user?.id);
  const canManageSettings =
    !!onOpenSettings &&
    (isOfficial
      ? isPlatformStaff
      : role === "creator" || role === "admin");
  const prefs = useServerPref(serverId);
  const mute = useServerPrefs((s) => s.mute);
  const isMuted = prefs.muteUntil != null && Date.now() < prefs.muteUntil;

  const ref = useRef<HTMLDivElement | null>(null);
  const [muteSubOpen, setMuteSubOpen] = useState(false);

  // Outside click + Esc to close.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp position so the menu doesn't overflow the viewport. Width/height
  // are estimates; menus this tall (~360px) render fine in most cases.
  const MENU_W = 200;
  const MENU_H = 380;
  const left =
    typeof window !== "undefined" && x + MENU_W > window.innerWidth
      ? Math.max(8, window.innerWidth - MENU_W - 8)
      : x;
  const top =
    typeof window !== "undefined" && y + MENU_H > window.innerHeight
      ? Math.max(8, window.innerHeight - MENU_H - 8)
      : y;

  // Wrap an item handler so it auto-closes the menu after firing.
  const wrap = (fn: () => void) => () => {
    fn();
    onClose();
  };

  // Permissions
  const canInvite = !isOfficial; // any member can copy invite if it's a custom server (settings filters further)
  const canLeave = !isOfficial && role && role !== "creator"; // creator must transfer/disband
  const leaveDisabledReason = isOfficial
    ? "官方服务器无法退出"
    : role === "creator"
      ? "领主请先转让或解散"
      : !role
        ? "你不是这个服务器的成员"
        : "";

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded-md shadow-2xl py-1.5 text-sm select-none"
      style={{ left, top, width: MENU_W }}
      onClick={(e) => e.stopPropagation()}
    >
      <Item onClick={wrap(onMarkRead)}>标识为已读</Item>
      <Item disabled={!canInvite} onClick={wrap(onInvite)}>
        邀请其他人
      </Item>
      {canManageSettings && (
        <Item onClick={wrap(onOpenSettings!)}>
          <span className="flex items-center gap-1.5">
            <Settings size={13} />
            服务器设置
          </span>
        </Item>
      )}

      {/* 免打扰 with submenu */}
      <div
        className="relative"
        onMouseEnter={() => setMuteSubOpen(true)}
        onMouseLeave={() => setMuteSubOpen(false)}
      >
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-between px-3 h-7 text-left",
            "text-[var(--text-normal)] hover:bg-[var(--accent)] hover:text-white",
            isMuted && "text-[var(--success)]",
          )}
        >
          <span>免打扰</span>
          <ChevronRight size={12} />
        </button>
        {muteSubOpen && (
          <div className="absolute left-full top-0 -mt-1 ml-0.5 w-[160px] bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded-md shadow-2xl py-1.5">
            {isMuted && (
              <Item
                onClick={wrap(() => mute(serverId, null))}
              >
                <span className="text-[var(--danger)]">取消免打扰</span>
              </Item>
            )}
            {MUTE_OPTIONS.map((opt) => (
              <Item
                key={opt.label}
                onClick={wrap(() => mute(serverId, opt.durationMs))}
              >
                <span className="flex items-center justify-between w-full">
                  {opt.label}
                  {isMuted &&
                    prefs.muteUntil != null &&
                    Math.abs(
                      prefs.muteUntil - Date.now() - (opt.durationMs ?? 0),
                    ) < 60_000 && <Check size={11} />}
                </span>
              </Item>
            ))}
          </div>
        )}
      </div>

      <Item onClick={wrap(onOpenNotify)}>通知设置</Item>
      <Item onClick={wrap(onOpenPrivacy)}>隐私设置</Item>

      <Divider />

      <Item onClick={wrap(onCollapseAll)}>折叠所有文件夹</Item>
      <Item onClick={wrap(onExpandAll)}>展开所有文件夹</Item>

      <Divider />

      <Item
        disabled={!canLeave}
        title={leaveDisabledReason || undefined}
        danger
        onClick={wrap(onLeave)}
      >
        离开服务器
      </Item>
      <Item onClick={wrap(onCopyName)}>复制服务器名称</Item>
    </div>
  );
}

function Item({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "w-full flex items-center px-3 h-7 text-left",
        disabled
          ? "text-[var(--text-muted)]/50 cursor-not-allowed"
          : danger
            ? "text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white"
            : "text-[var(--text-normal)] hover:bg-[var(--accent)] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 mx-2 h-px bg-[var(--bg-mid)]/60" />;
}
