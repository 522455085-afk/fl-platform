"use client";

/**
 * Bottom-right stack of DM popup cards.
 *
 * Mount once at the app root. Reads from `dm-toast-store`; the
 * sender is the DM realtime path (currently `noteIncomingDm` in
 * `dm-threads-store`) which pushes a toast whenever a new DM arrives
 * AND the user isn't already viewing that DM thread.
 *
 * Clicking a card dispatches `fl:navigate-dm` with `{ partnerId }`
 * which `page.tsx` listens for to open the DM. The X button
 * dismisses without navigating.
 */

import { X } from "lucide-react";
import Avatar from "@/components/Avatar";
import { useDmToastStore } from "@/lib/dm-toast-store";

export default function DmToastViewport() {
  const toasts = useDmToastStore((s) => s.toasts);
  const dismiss = useDmToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-3 z-[350] flex flex-col gap-2 w-[300px] max-w-[90vw] pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            document.dispatchEvent(
              new CustomEvent("fl:navigate-dm", {
                detail: {
                  partnerId: t.partnerId,
                  partnerName: t.partnerName,
                  partnerAvatar: t.partnerAvatar,
                  partnerColor: t.partnerColor,
                  partnerAvatarUrl: t.partnerAvatarUrl ?? null,
                },
              }),
            );
            dismiss(t.id);
          }}
          className="pointer-events-auto group relative bg-[var(--bg-darkest)] border border-[var(--accent)]/40 rounded-lg shadow-2xl px-4 py-4 flex items-start gap-3 text-left hover:bg-[var(--bg-mid)] transition-colors animate-in slide-in-from-right-4 fade-in duration-200"
        >
          <Avatar
            text={t.partnerAvatar}
            color={t.partnerColor}
            url={t.partnerAvatarUrl}
            size={48}
          />
          <div className="flex-1 min-w-0 pr-5">
            <div
              className="text-[14px] font-semibold truncate"
              style={{ color: t.partnerColor }}
            >
              {t.partnerName}
              <span className="ml-1.5 text-[11px] font-normal text-[var(--text-muted)]">
                · 新私信
              </span>
            </div>
            <div className="text-[13px] text-[var(--text-normal)] mt-1 line-clamp-3 break-words leading-snug">
              {t.preview || "（无文字内容）"}
            </div>
          </div>
          <span
            role="button"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            className="absolute top-1.5 right-1.5 size-5 grid place-items-center rounded text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-mid)] hover:text-white transition-all"
          >
            <X size={12} />
          </span>
        </button>
      ))}
    </div>
  );
}
