"use client";

/**
 * Renders the reaction chips below a message + the "+" picker button that
 * pops a small palette of allowed emojis. Each chip shows the emoji and
 * count, highlighted when the current user has reacted with it.
 */

import { useState, useRef, useEffect } from "react";
import { SmilePlus } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import {
  useReactions,
  aggregateReactions,
  REACTION_EMOJIS,
} from "@/lib/reactions-store";
import { cn } from "@/lib/utils";

export default function MessageReactions({ messageId }: { messageId: string }) {
  const { user } = useAuth();
  const rows = useReactions((s) => s.byMessage[messageId]);
  const toggle = useReactions((s) => s.toggle);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const groups = aggregateReactions(rows, user?.id);
  if (groups.length === 0 && !pickerOpen) {
    return (
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        title="添加表情反应"
        className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 h-6 px-1.5 rounded-full bg-[var(--bg-mid)]/40 text-[var(--text-muted)] hover:bg-[var(--bg-mid)] hover:text-white transition-opacity text-[11px] mt-1"
      >
        <SmilePlus size={12} />
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 relative">
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => toggle(messageId, g.emoji)}
          className={cn(
            "inline-flex items-center gap-1 h-6 px-1.5 rounded-full text-[12px] transition-colors",
            g.mine
              ? "bg-[var(--accent)]/20 border border-[var(--accent)]/60 text-white"
              : "bg-[var(--bg-mid)]/60 border border-transparent text-[var(--text-normal)] hover:bg-[var(--bg-mid)]",
          )}
        >
          <span>{g.emoji}</span>
          <span className="font-medium tabular-nums">{g.count}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        title="添加表情反应"
        className="inline-flex items-center gap-1 h-6 w-6 rounded-full bg-[var(--bg-mid)]/40 text-[var(--text-muted)] hover:bg-[var(--bg-mid)] hover:text-white"
      >
        <SmilePlus size={12} />
      </button>
      {pickerOpen && (
        <div
          ref={pickerRef}
          className="absolute z-30 top-7 left-0 bg-[var(--bg-darker)] border border-[var(--bg-mid)] rounded-lg shadow-xl p-2 grid grid-cols-6 gap-0.5 w-[14rem]"
        >
          {REACTION_EMOJIS.map((e, i) => (
            <button
              key={`${e}-${i}`}
              type="button"
              onClick={() => {
                toggle(messageId, e);
                setPickerOpen(false);
              }}
              className="size-8 grid place-items-center rounded hover:bg-[var(--bg-mid)] text-base"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
