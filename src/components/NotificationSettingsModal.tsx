"use client";

/**
 * Per-server notification settings.
 *
 * Mirrors the screenshot the user provided: a single panel with
 *   - 将 [server] 设为免打扰  (toggle, persistent)
 *   - 服务器通知设置  (radio: 所有消息 / 仅@被提及 / 无通知)
 *   - 接收@所有人和@在线成员通知 (toggle)
 *   - 接收所有角色的@被提及通知 (toggle)
 *
 * All values are persisted via `server-prefs-store` (currently localStorage;
 * will move to a `server_prefs` collection once the notification pipeline is
 * wired up).
 */

import { useEffect } from "react";
import { X, BellOff } from "lucide-react";
import {
  useServerPref,
  useServerPrefs,
  type NotifyLevel,
} from "@/lib/server-prefs-store";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";

type Props = {
  open: boolean;
  serverId: string | null;
  serverName: string;
  onClose: () => void;
};

export default function NotificationSettingsModal({
  open,
  serverId,
  serverName,
  onClose,
}: Props) {
  const prefs = useServerPref(serverId);
  const setPref = useServerPrefs((s) => s.set);
  const backdrop = useDismissOnBackdrop(onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !serverId) return null;

  const muted = prefs.muteUntil != null && Date.now() < prefs.muteUntil;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      {...backdrop}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-darker)] rounded-lg shadow-2xl border border-[var(--bg-mid)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div className="size-10 rounded-lg bg-[var(--accent)]/20 grid place-items-center text-[var(--accent)] shrink-0">
            <BellOff size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">
              通知设置
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
              {serverName}
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

        <div className="px-5 pb-5 space-y-5">
          {/* Mute toggle */}
          <ToggleRow
            label={`将 ${serverName} 设为免打扰`}
            sub="开启服务器免打扰会关闭除@提及之外，所有消息提示。"
            checked={muted}
            onChange={(v) => {
              setPref(serverId, {
                // Toggle: when enabled, mute "until I turn it back on" using
                // a far-future timestamp. UI treats null = not muted.
                muteUntil: v ? Date.now() + 365 * 24 * 60 * 60 * 1000 : null,
              });
            }}
          />

          <Divider />

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              服务器通知设置
            </div>
            <div className="space-y-1.5">
              <RadioRow
                label="所有消息"
                checked={prefs.notify === "all"}
                onChange={() => setPref(serverId, { notify: "all" })}
              />
              <RadioRow
                label="仅@被提及"
                highlighted
                checked={prefs.notify === "mention"}
                onChange={() => setPref(serverId, { notify: "mention" })}
              />
              <RadioRow
                label="无通知"
                checked={prefs.notify === "none"}
                onChange={() => setPref(serverId, { notify: "none" })}
              />
            </div>
          </div>

          <ToggleRow
            label="接收@所有人和@在线成员通知"
            checked={prefs.notifyEveryone}
            onChange={(v) => setPref(serverId, { notifyEveryone: v })}
          />
          <ToggleRow
            label="接收所有角色的@被提及通知"
            checked={prefs.notifyRole}
            onChange={(v) => setPref(serverId, { notifyRole: v })}
          />

          <p className="text-[11px] text-[var(--text-muted)] italic">
            ※ 通知系统正在开发中，当前设置已保存（本地），上线后将自动应用到推送通道。
          </p>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white">{label}</div>
        {sub && (
          <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
            {sub}
          </div>
        )}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

function RadioRow({
  label,
  checked,
  highlighted,
  onChange,
}: {
  label: string;
  checked: boolean;
  highlighted?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "w-full flex items-center gap-3 px-3 h-10 rounded border transition-colors text-left",
        checked
          ? highlighted
            ? "border-[var(--success)]/40 bg-[var(--success)]/10"
            : "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--bg-mid)] hover:border-[var(--text-muted)]",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full border-2 grid place-items-center",
          checked
            ? highlighted
              ? "border-[var(--success)]"
              : "border-[var(--accent)]"
            : "border-[var(--text-muted)]",
        )}
      >
        {checked && (
          <span
            className={cn(
              "size-2 rounded-full",
              highlighted ? "bg-[var(--success)]" : "bg-[var(--accent)]",
            )}
          />
        )}
      </span>
      <span className="text-sm text-white">{label}</span>
    </button>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors",
        checked ? "bg-[var(--success)]" : "bg-[var(--bg-mid)]",
      )}
      aria-pressed={checked}
    >
      <span
        className={cn(
          "block size-5 bg-white rounded-full transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

function Divider() {
  return <hr className="border-[var(--bg-mid)]/50" />;
}
