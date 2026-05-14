"use client";

/**
 * Send a friend request by username. Looks up the `profiles` collection by
 * name (eq), falls back to prefix match warning if multiple users share it.
 * Keeps scope small — no fuzzy search, no discovery tab yet.
 */

import { X, UserPlus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, type DbProfile } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import { useSocial } from "@/lib/social-store";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";

type Props = {
  onClose: () => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "not_found"; name: string }
  | { kind: "found"; profile: DbProfile }
  | { kind: "sending" }
  | { kind: "sent"; name: string }
  | { kind: "error"; message: string };

export default function AddFriendModal({ onClose }: Props) {
  const me = useAuth((s) => s.user);
  const { sendFriendRequest } = useSocial();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const backdrop = useDismissOnBackdrop(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const search = async () => {
    const name = input.trim();
    if (!name) return;
    if (name === me?.username) {
      setStatus({ kind: "error", message: "不能加自己为好友" });
      return;
    }
    setStatus({ kind: "searching" });
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("username", name)
      .limit(1);
    if (error) {
      setStatus({ kind: "error", message: error.message });
      return;
    }
    const row = (data as DbProfile[] | null)?.[0];
    if (!row) {
      setStatus({ kind: "not_found", name });
      return;
    }
    setStatus({ kind: "found", profile: row });
  };

  const sendRequest = async () => {
    if (status.kind !== "found") return;
    const p = status.profile;
    setStatus({ kind: "sending" });
    const r = await sendFriendRequest({
      user_id: p.id,
      username: p.username,
      avatar: p.avatar,
      avatar_color: p.avatar_color,
    });
    if (!r.ok) {
      setStatus({ kind: "error", message: r.error || "发送失败" });
      return;
    }
    setStatus({ kind: "sent", name: p.username });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4"
      {...backdrop}
    >
      <div
        className="w-full max-w-md rounded-lg border border-[var(--bg-mid)] bg-[var(--bg-darker)] shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--bg-mid)]">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-[var(--accent)]" />
            <h2 className="font-semibold text-white">添加好友</h2>
          </div>
          <button
            onClick={onClose}
            className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              输入对方的用户名
            </span>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-[var(--bg-darkest)] rounded px-2.5 h-9">
                <Search size={14} className="text-[var(--text-muted)]" />
                <input
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") search();
                  }}
                  placeholder="例如 WizardKing"
                  className="flex-1 bg-transparent text-sm focus:outline-none text-white placeholder:text-[var(--text-muted)]"
                />
              </div>
              <button
                onClick={search}
                disabled={!input.trim() || status.kind === "searching"}
                className="px-3 h-9 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50"
              >
                查找
              </button>
            </div>
          </label>

          {/* Status / result box */}
          <div className="min-h-[72px]">
            {status.kind === "idle" && (
              <p className="text-xs text-[var(--text-muted)] italic">
                用户名必须完全匹配（区分大小写）。
              </p>
            )}
            {status.kind === "searching" && (
              <p className="text-sm text-[var(--text-muted)]">查找中…</p>
            )}
            {status.kind === "not_found" && (
              <p className="text-sm text-[var(--warning)]">
                没有找到名为 <span className="font-semibold">{status.name}</span> 的玩家。
              </p>
            )}
            {status.kind === "found" && (
              <div className="flex items-center gap-3 p-3 rounded border border-[var(--bg-mid)] bg-[var(--bg-mid)]/30">
                <div
                  className="size-10 rounded-full grid place-items-center text-white font-bold shrink-0"
                  style={{ background: status.profile.avatar_color }}
                >
                  {status.profile.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {status.profile.username}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate">
                    UID {status.profile.id.slice(0, 8)}…
                  </div>
                </div>
                <button
                  onClick={sendRequest}
                  className="px-3 h-8 rounded bg-[var(--success)] hover:bg-[var(--success)]/80 text-white text-xs font-medium"
                >
                  发起请求
                </button>
              </div>
            )}
            {status.kind === "sending" && (
              <p className="text-sm text-[var(--text-muted)]">发送中…</p>
            )}
            {status.kind === "sent" && (
              <p className="text-sm text-[var(--success)]">
                已向 <span className="font-semibold">{status.name}</span> 发送好友请求，等对方在好友栏接受。
              </p>
            )}
            {status.kind === "error" && (
              <p className="text-sm text-[var(--danger)]">{status.message}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
