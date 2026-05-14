"use client";

/**
 * Per-server privacy settings.
 *
 * Currently exposes a single switch — "允许服务器成员向你发送私信" — mirroring
 * the screenshot the user provided. Stored locally via `server-prefs-store`.
 *
 * Cancel / Save semantics: changes are staged in local state and only
 * committed when the user clicks 保存. This matches the user's mockup which
 * shows explicit cancel / save buttons.
 */

import { useEffect, useState } from "react";
import { X, ShieldCheck } from "lucide-react";
import {
  useServerPref,
  useServerPrefs,
} from "@/lib/server-prefs-store";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";

type Props = {
  open: boolean;
  serverId: string | null;
  serverName: string;
  onClose: () => void;
};

export default function PrivacySettingsModal({
  open,
  serverId,
  serverName,
  onClose,
}: Props) {
  const prefs = useServerPref(serverId);
  const setPref = useServerPrefs((s) => s.set);
  const backdrop = useDismissOnBackdrop(onClose);

  const [allowDMs, setAllowDMs] = useState(prefs.allowDMs);

  useEffect(() => {
    if (!open) return;
    // Re-seed on each open so we always start from the persisted value.
    setAllowDMs(prefs.allowDMs);
  }, [open, prefs.allowDMs]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !serverId) return null;

  const dirty = allowDMs !== prefs.allowDMs;

  const save = () => {
    setPref(serverId, { allowDMs });
    onClose();
  };

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
            <ShieldCheck size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">
              隐私设置 — {serverName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white">
              允许服务器成员向你发送私信
            </span>
            <Switch checked={allowDMs} onChange={setAllowDMs} />
          </div>

          <p className="text-[11px] text-[var(--text-muted)] italic">
            ※ 关闭后，仅好友能向你发起私信。已存在的会话不受影响。
          </p>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded text-sm text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty}
              className="h-9 px-4 rounded text-sm bg-[var(--success)] text-[#0e1d11] font-medium hover:bg-[var(--success)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
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
