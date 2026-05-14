"use client";

/**
 * Floating user profile card. Shown when "查看资料" is picked in the member
 * list right-click menu, or any other place that wants a quick peek at a
 * player.
 *
 * Loads the latest profiles row by user id (so phone-bound, real-name etc
 * stay current). Falls back to whatever data was passed in from presence.
 */

import { useEffect, useRef, useState } from "react";
import { AtSign, MessageSquarePlus, ShieldCheck, X } from "lucide-react";
import { supabase, type DbProfile } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import {
  useFriendStatusFor,
  useIsBlocked,
  useSocial,
} from "@/lib/social-store";
import { cn } from "@/lib/utils";
import Avatar from "@/components/Avatar";

type Seed = {
  user_id: string;
  username: string;
  avatar: string;
  avatar_color: string;
  avatar_url?: string | null;
};

type Props = {
  seed: Seed;
  /** Top-left anchor in viewport coords. Auto-clamped to fit. */
  anchor: { x: number; y: number };
  isOnline?: boolean;
  onClose: () => void;
  onStartDm?: (target: Seed) => void;
};

export default function UserProfileCard({
  seed,
  anchor,
  isOnline,
  onClose,
  onStartDm,
}: Props) {
  const me = useAuth((s) => s.user);
  const { status: friendStatus, friendshipId } = useFriendStatusFor(seed.user_id);
  const blocked = useIsBlocked(seed.user_id);
  const { sendFriendRequest, removeFriend, blockUser, unblockUser } = useSocial();

  const [profile, setProfile] = useState<DbProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer attach so the click that opened us doesn't immediately close.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onClick);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Fetch the latest profile row.
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("*")
      .eq("id", seed.user_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!mounted) return;
        setProfile((data as DbProfile) || null);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [seed.user_id]);

  // Clamp anchor inside viewport. Card is ~320 wide, ~340 tall.
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 328));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 360));

  const username = profile?.username ?? seed.username;
  const avatar = profile?.avatar ?? seed.avatar;
  const color = profile?.avatar_color ?? seed.avatar_color;
  const avatarUrl = profile?.avatar_url ?? seed.avatar_url ?? null;
  const phoneVerified = !!profile?.phone_verified_at;
  const created = profile?.created_at;

  const isSelf = me?.id === seed.user_id;
  const showFriendBtn =
    !isSelf && (friendStatus === "none" || friendStatus === "pending_outgoing");

  const handleAddFriend = async () => {
    setBusy(true);
    setActionMsg(null);
    const r = await sendFriendRequest({
      user_id: seed.user_id,
      username,
      avatar,
      avatar_color: color,
      avatar_url: avatarUrl,
    });
    setBusy(false);
    setActionMsg(r.ok ? "好友请求已发出" : `失败：${r.error}`);
  };

  const handleRemoveFriend = async () => {
    if (!friendshipId) return;
    setBusy(true);
    setActionMsg(null);
    const r = await removeFriend(friendshipId);
    setBusy(false);
    setActionMsg(r.ok ? "已移除好友" : `失败：${r.error}`);
  };

  const handleToggleBlock = async () => {
    setBusy(true);
    setActionMsg(null);
    const r = blocked
      ? await unblockUser(seed.user_id)
      : await blockUser({
          user_id: seed.user_id,
          username,
          avatar,
          avatar_color: color,
          avatar_url: avatarUrl,
        });
    setBusy(false);
    setActionMsg(r.ok ? (blocked ? "已解除屏蔽" : "已屏蔽") : `失败：${r.error}`);
  };

  return (
    <div
      ref={cardRef}
      className="fixed z-50 w-80 rounded-lg border border-[var(--bg-mid)] bg-[var(--bg-darker)] shadow-2xl overflow-hidden"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header — close button + avatar, no banner */}
      <div className="relative px-4 pt-3 pb-2 flex items-end gap-3">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 size-7 grid place-items-center rounded-full bg-black/30 text-white hover:bg-black/60"
          aria-label="关闭"
        >
          <X size={16} />
        </button>
        <Avatar
          text={avatar}
          color={color}
          url={avatarUrl}
          size={64}
          className="ring-4 ring-[var(--bg-darker)]"
        />
        {isOnline !== undefined && (
          <span
            className={cn(
              "mb-2 px-2 py-0.5 rounded-full text-[10px] font-semibold",
              isOnline
                ? "bg-[var(--success)]/20 text-[var(--success)]"
                : "bg-[var(--text-muted)]/20 text-[var(--text-muted)]",
            )}
          >
            {isOnline ? "● 在线" : "○ 离线"}
          </span>
        )}
      </div>

      {/* Username + meta */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5">
          <AtSign size={14} className="text-[var(--accent)]" />
          <h3 className="text-lg font-bold text-white truncate">{username}</h3>
          {phoneVerified && (
            <span
              title="已绑定手机号"
              className="ml-1 inline-flex items-center gap-1 text-[var(--success)] text-[11px]"
            >
              <ShieldCheck size={12} />
              已验证
            </span>
          )}
          {isSelf && (
            <span className="ml-auto text-[10px] text-[var(--accent)]">（你）</span>
          )}
        </div>
        <div className="text-[11px] text-[var(--text-muted)] mt-1 space-y-0.5">
          <div>
            UID:{" "}
            <span className="font-mono">
              {seed.user_id.slice(0, 8)}…{seed.user_id.slice(-4)}
            </span>
          </div>
          {created && (
            <div>加入于 {new Date(created).toLocaleDateString()}</div>
          )}
          {loading && <div className="italic">加载中…</div>}
        </div>
      </div>

      {/* Action row */}
      {!isSelf && (
        <div className="px-4 pb-3 flex flex-col gap-2 border-t border-[var(--bg-mid)] pt-3">
          {onStartDm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onStartDm({ ...seed, username, avatar, avatar_color: color });
                onClose();
              }}
              className="w-full inline-flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium rounded h-8 disabled:opacity-50"
            >
              <MessageSquarePlus size={14} />
              发起私信
            </button>
          )}
          <div className="flex gap-2">
            {showFriendBtn && (
              <button
                type="button"
                disabled={busy || friendStatus === "pending_outgoing"}
                onClick={handleAddFriend}
                className="flex-1 text-xs h-8 rounded border border-[var(--bg-mid)] hover:bg-[var(--bg-mid)] text-[var(--text-normal)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {friendStatus === "pending_outgoing" ? "请求已发出" : "加好友"}
              </button>
            )}
            {friendStatus === "accepted" && (
              <button
                type="button"
                disabled={busy}
                onClick={handleRemoveFriend}
                className="flex-1 text-xs h-8 rounded border border-[var(--bg-mid)] hover:bg-[var(--danger)]/15 text-[var(--text-normal)] hover:text-[var(--danger)] disabled:opacity-50"
              >
                移除好友
              </button>
            )}
            {friendStatus === "pending_incoming" && (
              <span className="flex-1 text-[11px] text-[var(--warning)] self-center">
                对方已向你发送好友请求 · 在好友栏处理
              </span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={handleToggleBlock}
              className={cn(
                "flex-1 text-xs h-8 rounded border disabled:opacity-50",
                blocked
                  ? "border-[var(--warning)]/40 text-[var(--warning)] hover:bg-[var(--warning)]/10"
                  : "border-[var(--bg-mid)] text-[var(--text-muted)] hover:bg-[var(--danger)]/15 hover:text-[var(--danger)]",
              )}
            >
              {blocked ? "解除屏蔽" : "屏蔽"}
            </button>
          </div>
          {actionMsg && (
            <div className="text-[11px] text-[var(--text-muted)] truncate">
              {actionMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
