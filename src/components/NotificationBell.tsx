"use client";

import { Bell } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNotifications } from "@/lib/notifications-store";
import { cn } from "@/lib/utils";

/**
 * Bell icon + dropdown panel showing recent in-app notifications.
 *
 * Used by every channel-style view header (text channels via
 * `ChatView`, voice channels via `VoiceChannelView`, etc.) so the
 * user always has a way to peek mentions / DMs without breaking
 * their current context.
 *
 * The dropdown closes on outside-click. Clicking a notification
 * dispatches the relevant `fl:navigate-*` event for the page-level
 * handler in `app/page.tsx` to consume.
 */

function formatNotifTime(at: string): string {
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return new Date(ms).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export default function NotificationBell({ className }: { className?: string }) {
  const {
    unreadCount,
    panelOpen,
    items,
    togglePanel,
    closePanel,
    markAllRead,
    markRead,
  } = useNotifications();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (wrapperRef.current?.contains(t)) return;
      closePanel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panelOpen, closePanel]);

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => {
          if (unreadCount > 0) markAllRead();
          togglePanel();
        }}
        className={cn(
          "size-8 grid place-items-center rounded transition-colors",
          panelOpen
            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
            : "text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]",
        )}
        title="通知"
      >
        <Bell size={20} />
      </button>
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-[var(--danger)] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 pointer-events-none">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
      {panelOpen && (
        <div
          ref={panelRef}
          className="absolute top-10 right-0 w-80 max-w-[90vw] bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-black/30 flex items-center justify-between shrink-0">
            <span className="font-semibold text-sm text-white">通知</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] text-[var(--accent)] hover:underline"
              >
                全部已读
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-72 divide-y divide-[var(--bg-mid)]/40">
            {items.length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--text-muted)]">
                暂无通知
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markRead(n.id);
                    if (n.kind === "system") {
                      document.dispatchEvent(new CustomEvent("fl:navigate-friends"));
                      closePanel();
                      return;
                    }
                    if (n.kind === "dm" && n.partnerId) {
                      document.dispatchEvent(
                        new CustomEvent("fl:navigate-dm", {
                          detail: {
                            partnerId: n.partnerId,
                            partnerName: n.partnerName ?? "",
                            partnerAvatar: n.partnerAvatar ?? "",
                            partnerColor: n.partnerColor ?? "#888",
                            partnerAvatarUrl: n.partnerAvatarUrl ?? null,
                          },
                        }),
                      );
                      closePanel();
                      return;
                    }
                    if (n.channelId) {
                      document.dispatchEvent(
                        new CustomEvent("fl:navigate-channel", {
                          detail: {
                            channelId: n.channelId,
                            serverId: n.serverId,
                          },
                        }),
                      );
                      closePanel();
                    }
                  }}
                  className={cn(
                    "w-full px-4 py-3 text-left hover:bg-[var(--bg-mid)] transition-colors flex items-start gap-3",
                    !n.read && "bg-[var(--accent)]/5",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full mt-2 shrink-0",
                      n.read ? "bg-transparent" : "bg-[var(--accent)]",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-white truncate">
                      {n.title}
                    </div>
                    <div className="text-[12px] text-[var(--text-muted)] mt-0.5 line-clamp-2 break-words">
                      {n.body}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1">
                      {formatNotifTime(n.at)}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
