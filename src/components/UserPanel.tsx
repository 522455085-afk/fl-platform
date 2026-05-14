"use client";

/**
 * Bottom user-panel bar (avatar + mic/headphone/settings + menu).
 *
 * Shared between ChannelSidebar (server mode) and DmSidebar (DM mode) so the
 * look stays identical and menu logic isn't duplicated.
 */

import {
  Settings,
  LogOut,
  ShieldCheck,
  UserCog,
  Circle,
  Moon,
  Gamepad2,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { usePresenceStatus } from "@/lib/presence-status";
import { useActivityStore } from "@/lib/activity-store";
import { useVoice } from "@/lib/voice-store";
import { useMicLevel } from "@/lib/use-mic-level";
import Avatar from "@/components/Avatar";
// VoiceConnectionPanel used to live here as a floated child. It now
// renders one row above this panel inside BottomBarComposer so the
// bottom-bar columns share a consistent top edge — see comment
// further down for details.
import { cn } from "@/lib/utils";
import { confirm } from "@/lib/confirm-store";

type Props = {
  onOpenSecurity?: () => void;
  onOpenProfile?: () => void;
  onOpenSystemSettings?: () => void;
  /** Click handler to jump the active channel/server to where the
      voice connection currently lives. Wired from the page so the
      voice block (now embedded above the avatar row) can navigate. */
  onJumpToVoice?: (serverId: string, channelId: string) => void;
  className?: string;
  /** When false, top corners are not rounded (used when VoiceConnectionPanel sits above). */
  roundedTop?: boolean;
};

export default function UserPanel({ onOpenSecurity, onOpenProfile, onOpenSystemSettings, onJumpToVoice, className, roundedTop = true }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  // True from the moment the user confirms logout until the hard
  // navigation kicks in. Drives both the button label and a
  // full-screen veil that smooths over the "empty page" beat between
  // signOut() and the /login redirect — which is what made the
  // previous flow feel 生硬 (the menu vanished, then a blank flash).
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { user, logout } = useAuth();
  const effective = usePresenceStatus((s) => s.effective);
  const manual = usePresenceStatus((s) => s.manual);
  const setManual = usePresenceStatus((s) => s.setManual);
  const activity = useActivityStore((s) => s.activity);
  const activitySource = useActivityStore((s) => s.source);
  // Voice mic/deafen state — these icons live inline in the avatar row
  // (next to 设置), per the user's request. The mic icon pulses green
  // when it detects real speaking audio from the user's microphone.
  const voiceCurrent = useVoice((s) => s.current);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const toggleMute = useVoice((s) => s.toggleMute);
  const toggleDeafen = useVoice((s) => s.toggleDeafen);
  const { level } = useMicLevel(!!voiceCurrent && !muted);
  const speaking = !!voiceCurrent && !muted && level > 0.08;

  useEffect(() => {
    if (!menuOpen && !statusMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, statusMenuOpen]);

  return (
    <div
      className={cn("relative h-full", className)}
      ref={menuRef}
    >
      {/* Logout veil — fades over the entire viewport once the user
          confirms 退出登录 so the brief window between signOut() and
          the /login redirect doesn't show a half-torn-down UI. */}
      {loggingOut && (
        <div className="fixed inset-0 z-[400] bg-[var(--bg-darkest)]/90 backdrop-blur-sm grid place-items-center animate-in fade-in duration-150">
          <div className="flex items-center gap-3 text-[var(--text-normal)]">
            <span className="size-4 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
            <span className="text-sm">正在退出登录…</span>
          </div>
        </div>
      )}
      {/* NOTE: VoiceConnectionPanel used to be rendered here with
          `absolute bottom-full` so it stuck UP out of the 72px bar.
          The user later asked for the leftmost (+) button, the user
          card, the voice card, and the composer's top edges to all
          align on the same horizontal line — which the absolute
          float made impossible. The voice panel now lives at the
          bottom-bar level in `BottomBarComposer` as a sibling row
          above the user/composer row, so all four columns share
          the same vertical reference. */}
      <div className={cn("h-full flex items-center px-2 gap-2 relative bg-[var(--bg-userbar)] overflow-hidden", roundedTop ? "rounded-2xl" : "rounded-b-2xl")}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 flex-1 min-w-0 px-1 py-1 rounded hover:bg-[var(--bg-mid)] transition-colors"
      >
        <div className="relative shrink-0">
          <Avatar
            text={user?.avatar || "?"}
            color={user?.avatarColor || "#5865f2"}
            url={user?.avatarUrl}
            size={56}
          />
          {/* Status dot — clickable in its own right (stop propagation so we
              don't also trigger the avatar/menu click). */}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setStatusMenuOpen((v) => !v);
              setMenuOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setStatusMenuOpen((v) => !v);
              }
            }}
            title={effective === "away" ? "离开" : "在线"}
            className={cn(
              "absolute bottom-0 right-0 size-4 rounded-full border-[3px] border-[var(--bg-darkest)] cursor-pointer",
              effective === "away"
                ? "bg-[var(--warning)]"
                : "bg-[var(--success)]",
            )}
          />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[17px] font-semibold text-white truncate">
            {user?.username || "未登录"}
          </div>
          <div className="text-[14px] text-[var(--text-muted)] truncate">
            {activity
              ? activity
              : effective === "away"
                ? manual === "away"
                  ? "离开（手动）"
                  : "离开（5 分钟无操作）"
                : "在线"}
          </div>
        </div>
      </button>
      {/* Voice mic / deafen — inline next to 设置. Only meaningful when
          connected to a voice channel (otherwise mute state is
          broadcast-only and has no effect). We still render the icons
          so the UI stays stable; they just act on voice-store directly. */}
      <button
        type="button"
        onClick={toggleMute}
        title={muted ? "取消静音" : "静音"}
        className={cn(
          "size-11 grid place-items-center rounded transition-all",
          muted
            ? "bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30"
            : speaking
              ? "bg-[var(--success)]/20 text-[var(--success)] shadow-[0_0_10px_var(--success)]"
              : "hover:bg-[var(--bg-mid)] text-[var(--text-muted)] hover:text-white",
        )}
      >
        {muted ? <MicOff size={22} /> : <Mic size={22} />}
      </button>
      <button
        type="button"
        onClick={toggleDeafen}
        title={deafened ? "取消屏蔽听筒" : "屏蔽听筒"}
        className={cn(
          "size-11 grid place-items-center rounded transition-colors",
          deafened
            ? "bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30"
            : "hover:bg-[var(--bg-mid)] text-[var(--text-muted)] hover:text-white",
        )}
      >
        {deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
      </button>
      <button
        type="button"
        title="系统设置（外观 / 音频）"
        onClick={() => onOpenSystemSettings?.()}
        className="size-11 grid place-items-center rounded hover:bg-[var(--bg-mid)] text-[var(--text-muted)] hover:text-white transition-colors"
      >
        <Settings size={22} />
      </button>
      </div>

      {statusMenuOpen && (
        <div className="absolute bottom-full left-2 mb-2 w-56 bg-[var(--bg-darkest)] border border-black/40 rounded-lg shadow-2xl py-1.5 z-50">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--bg-mid)] mb-1">
            设置状态
          </div>
          <StatusMenuItem
            label="在线"
            color="var(--success)"
            icon={<Circle size={12} fill="var(--success)" stroke="var(--success)" />}
            active={effective === "online" && manual !== "away"}
            onClick={() => {
              setManual("online");
              setStatusMenuOpen(false);
            }}
          />
          <StatusMenuItem
            label="离开"
            color="var(--warning)"
            icon={<Moon size={12} className="text-[var(--warning)]" />}
            active={manual === "away"}
            onClick={() => {
              setManual("away");
              setStatusMenuOpen(false);
            }}
          />
          {manual !== null && (
            <button
              type="button"
              onClick={() => {
                setManual(null);
                setStatusMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-[11px] text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)] border-t border-[var(--bg-mid)]"
            >
              恢复自动（5 分钟无操作 → 离开）
            </button>
          )}
          {/* Activity is *automatically* detected by the desktop client by
              scanning running processes (e.g. "正在玩 三角洲行动")，并通过
              window.__flSetActivity 推送给前端。这里只做只读展示，不再
              提供手动输入入口。 */}
          {activity && (
            <div className="border-t border-[var(--bg-mid)] mt-1 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                <Gamepad2 size={11} />
                正在进行
                <span className="ml-auto text-[var(--accent)] normal-case tracking-normal">
                  {activitySource === "game" ? "来自游戏" : "自动检测"}
                </span>
              </div>
              <div
                className="text-xs text-white truncate"
                title={activity}
              >
                {activity}
              </div>
            </div>
          )}
        </div>
      )}

      {menuOpen && (
        <div className="absolute bottom-full left-2 mb-2 w-56 bg-[var(--bg-darkest)] border border-black/40 rounded-lg shadow-2xl py-1.5 z-50">
          <div className="px-3 py-2 border-b border-[var(--bg-mid)] mb-1">
            <div className="text-sm font-semibold text-white truncate">
              {user?.username}
              {user?.phoneVerifiedAt && (
                <span
                  className="ml-1.5 text-[10px] text-[var(--success)]"
                  title="手机号已验证"
                >
                  ✓
                </span>
              )}
            </div>
          </div>
          {onOpenProfile && (
            <button
              onClick={() => {
                setMenuOpen(false);
                onOpenProfile();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-normal)] hover:bg-[var(--bg-mid)] transition-colors"
            >
              <UserCog size={16} className="text-[var(--accent)]" />
              个人设置
            </button>
          )}
          {onOpenSecurity && (
            <button
              onClick={() => {
                setMenuOpen(false);
                onOpenSecurity();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-normal)] hover:bg-[var(--bg-mid)] transition-colors"
            >
              <ShieldCheck size={16} className="text-[var(--accent)]" />
              安全中心
              {!user?.phoneVerifiedAt && (
                <span className="ml-auto text-[10px] text-[var(--warning)]">
                  未绑手机
                </span>
              )}
            </button>
          )}
          <button
            disabled={loggingOut}
            onClick={async () => {
              const ok = await confirm("确定退出登录？", {
                id: "logout",
                rememberLabel: "不再询问",
              });
              if (!ok) return;
              setMenuOpen(false);
              setLoggingOut(true);
              // Hard timeout so a hung backend can never strand the
              // full-screen overlay (z-[400]) covering the UI and
              // making clicks feel "stuck".
              try {
                await Promise.race([
                  logout(),
                  new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("logout timeout")), 5000),
                  ),
                ]);
              } catch (e) {
                console.error("[logout] failed or timed out:", e);
              } finally {
                setLoggingOut(false);
              }
              await new Promise((r) => setTimeout(r, 100));
              window.location.href = "/login";
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            <LogOut size={16} />
            {loggingOut ? "正在退出…" : "退出登录"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusMenuItem({
  label,
  color,
  icon,
  active,
  onClick,
}: {
  label: string;
  color: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors",
        active
          ? "bg-[var(--bg-mid)]/60 text-white"
          : "text-[var(--text-normal)] hover:bg-[var(--bg-mid)] hover:text-white",
      )}
      style={active ? { color } : undefined}
    >
      <span className="size-3 grid place-items-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {active && <span className="text-[10px] text-[var(--text-muted)]">当前</span>}
    </button>
  );
}

function IconButton({
  active,
  onClick,
  on,
  off,
}: {
  active: boolean;
  onClick: () => void;
  on: React.ReactNode;
  off: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "size-8 grid place-items-center rounded hover:bg-[var(--bg-mid)]",
        active ? "text-[var(--danger)]" : "text-[var(--text-muted)] hover:text-white",
      )}
    >
      {active ? off : on}
    </button>
  );
}
