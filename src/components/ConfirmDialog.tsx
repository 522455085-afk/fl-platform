"use client";

import { useEffect, useState } from "react";
import { useConfirmStore } from "@/lib/confirm-store";

/**
 * Global centered confirm dialog — replaces browser-native window.confirm().
 * Mount once at the app root. Triggered imperatively via `confirm(message)`
 * from @/lib/confirm-store.
 *
 * When the caller passes `opts.id`, a "不再提醒" checkbox is shown below
 * the buttons; if checked, future calls with the same id resolve true
 * immediately without showing the dialog.
 */
export default function ConfirmDialog() {
  const {
    open,
    message,
    rememberLabel,
    okLabel,
    cancelLabel,
    tone,
    _answer,
  } = useConfirmStore();
  const [remember, setRemember] = useState(false);
  // Reset the checkbox each time the dialog opens — sticky state would
  // be surprising ("I unchecked it last time, why is it on now?").
  useEffect(() => {
    if (open) setRemember(false);
  }, [open]);
  if (!open) return null;

  // Alert mode (single-button) — `cancelLabel === ""` is the signal
  // sent by `alert()` in confirm-store. In that mode the backdrop
  // click resolves *true* (i.e. acknowledged) instead of false, so a
  // user dismissing an informational dialog doesn't accidentally read
  // as "cancelled".
  const isAlertMode = cancelLabel === "" || cancelLabel === null;

  const onBackdrop = () => _answer(isAlertMode ? true : false, false);
  const primaryClass =
    tone === "primary"
      ? "px-4 py-2 rounded text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium transition-colors"
      : "px-4 py-2 rounded text-sm bg-[var(--danger)] hover:bg-[var(--danger)]/80 text-white font-medium transition-colors";

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && onBackdrop()}
    >
      <div className="bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-4">
        <p className="text-[var(--text-normal)] text-sm leading-relaxed whitespace-pre-wrap">
          {message}
        </p>
        {rememberLabel && (
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-3.5 accent-[var(--accent)]"
            />
            {rememberLabel}
          </label>
        )}
        <div className="flex gap-3 justify-end">
          {!isAlertMode && (
            <button
              type="button"
              onClick={() => _answer(false, false)}
              className="px-4 py-2 rounded text-sm text-[var(--text-muted)] hover:bg-[var(--bg-mid)] transition-colors"
            >
              {cancelLabel || "取消"}
            </button>
          )}
          <button
            type="button"
            onClick={() => _answer(true, remember)}
            className={primaryClass}
            autoFocus
          >
            {okLabel || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
