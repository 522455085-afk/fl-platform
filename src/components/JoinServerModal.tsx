"use client";

/**
 * Modal for joining an existing server.
 *
 * Two tabs:
 *   1. 邀请码 — paste a 6-char code, hit Enter, get teleported to the server
 *   2. 浏览公开 — list of `is_public=true` servers, search by name, one-click join
 *
 * On successful join we call `onJoined(serverId)` so the host page can switch
 * the active server immediately.
 */

import { useEffect, useMemo, useState } from "react";
import { X, ArrowRight, Search, Globe, Users } from "lucide-react";
import { useServers, type ServerDocRow } from "@/lib/servers-store";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";

type Tab = "code" | "browse";

type Props = {
  open: boolean;
  /** Pre-fill the invite code input — used by ?invite= URL handling. */
  initialCode?: string;
  onClose: () => void;
  onJoined?: (serverId: string) => void;
  /**
   * Called when the user picks a public server from the browse list —
   * the host switches `activeServerId` to it and enters *preview* mode
   * (read-only channel list + locked composer + "加入" banner in the
   * channel sidebar). The user explicitly chooses to join from there.
   */
  onPreview?: (serverId: string) => void;
};

export default function JoinServerModal({
  open,
  initialCode,
  onClose,
  onJoined,
  onPreview,
}: Props) {
  const joinByCode = useServers((s) => s.joinByCode);
  const setPreview = useServers((s) => s.setPreview);
  const browsePublic = useServers((s) => s.browsePublic);
  const myCustom = useServers((s) => s.custom);
  const backdrop = useDismissOnBackdrop(onClose);

  const [tab, setTab] = useState<Tab>("code");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Browse tab state.
  const [search, setSearch] = useState("");
  const [browseRows, setBrowseRows] = useState<ServerDocRow[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  // Reset on open/close.
  useEffect(() => {
    if (!open) {
      setBusy(false);
      setError(null);
      setSearch("");
      setBrowseRows([]);
      return;
    }
    // Pre-fill from URL invite param (consumed once, then cleared by host).
    if (initialCode) {
      setCode(initialCode);
      setTab("code");
    }
  }, [open, initialCode]);

  // Load browse list when entering the browse tab the first time per open.
  useEffect(() => {
    if (!open || tab !== "browse") return;
    let cancelled = false;
    (async () => {
      setBrowseLoading(true);
      const rows = await browsePublic(search);
      if (!cancelled) {
        setBrowseRows(rows);
        setBrowseLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, search, browsePublic]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const myServerIds = useMemo(
    () => new Set(myCustom.map((s) => s.id)),
    [myCustom],
  );

  if (!open) return null;

  const submitCode = async () => {
    setError(null);
    setBusy(true);
    const r = await joinByCode(code);
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "加入失败");
      return;
    }
    if (r.serverId) onJoined?.(r.serverId);
    onClose();
  };

  const submitPreview = (row: ServerDocRow) => {
    // Don't actually join yet — populate the preview slot in the store so
    // the channel sidebar / chat view render in read-only mode with a
    // "加入" banner. The user explicitly hits 加入 from there.
    setPreview(row);
    onPreview?.(row.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      {...backdrop}
    >
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col bg-[var(--bg-darker)] rounded-lg shadow-2xl border border-[var(--bg-mid)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div className="size-10 rounded-lg bg-[var(--success)]/20 grid place-items-center text-[var(--success)] shrink-0">
            <ArrowRight size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white">加入服务器</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              输入邀请码，或浏览公开公会
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 flex gap-1 border-b border-[var(--bg-mid)]">
          <TabButton active={tab === "code"} onClick={() => setTab("code")}>
            邀请码
          </TabButton>
          <TabButton active={tab === "browse"} onClick={() => setTab("browse")}>
            <span className="flex items-center gap-1.5">
              <Globe size={12} /> 浏览公开
            </span>
          </TabButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "code" ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                向你发送邀请的人会给你一段 6 位邀请码（如{" "}
                <code className="font-mono px-1 bg-[var(--bg-mid)] rounded">
                  3K7M9P
                </code>
                ）。粘贴到下面：
              </p>
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCode();
                }}
                maxLength={8}
                placeholder="例如 3K7M9P"
                className="w-full bg-[var(--bg-darkest)] rounded h-12 px-4 text-center font-mono text-lg tracking-[0.4em] text-white placeholder:text-[var(--text-muted)] placeholder:font-sans placeholder:tracking-normal placeholder:text-sm focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
              <button
                type="button"
                onClick={submitCode}
                disabled={busy || code.replace(/[^A-Z0-9]/g, "").length !== 6}
                className="w-full h-10 rounded bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? "正在加入…" : "加入"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Search bar */}
              <div className="flex items-center bg-[var(--bg-darkest)] rounded h-9 px-2 gap-1.5">
                <Search size={14} className="text-[var(--text-muted)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="按名称搜索…"
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-[var(--text-muted)] focus:outline-none min-w-0"
                />
              </div>

              {/* List */}
              {browseLoading ? (
                <div className="text-center text-sm text-[var(--text-muted)] py-6 italic">
                  加载中…
                </div>
              ) : browseRows.length === 0 ? (
                <div className="text-center text-sm text-[var(--text-muted)] py-8">
                  {search.trim()
                    ? `没有匹配「${search}」的公开公会`
                    : "暂时没有公开公会。让朋友创建一个，或者你自己开一个。"}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--bg-mid)]/50">
                  {browseRows.map((row) => {
                    const joined = myServerIds.has(row.id);
                    return (
                      <li
                        key={row.id}
                        className="py-2 flex items-center gap-3"
                      >
                        <div
                          className="size-10 rounded-full grid place-items-center text-white text-sm font-semibold shrink-0"
                          style={{ background: row.icon_color }}
                        >
                          {row.icon_text}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-white truncate">
                            {row.name}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2">
                            <span className="flex items-center gap-0.5">
                              <Users size={10} />
                              {row.member_count || 1}
                            </span>
                            <span>·</span>
                            <span className="truncate">
                              领主 {row.creator_name}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={joined}
                          onClick={() => submitPreview(row)}
                          className={cn(
                            "h-8 px-3 rounded text-xs font-medium shrink-0",
                            joined
                              ? "bg-[var(--bg-mid)] text-[var(--text-muted)] cursor-not-allowed"
                              : "bg-[var(--bg-mid)] text-white hover:bg-[var(--bg-light)]",
                          )}
                          title={joined ? "已加入" : "预览服务器，再决定是否加入"}
                        >
                          {joined ? "已加入" : "预览"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded p-2">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 h-9 text-sm border-b-2 transition-colors -mb-px",
        active
          ? "border-[var(--accent)] text-white"
          : "border-transparent text-[var(--text-muted)] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
