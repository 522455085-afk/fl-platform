"use client";

import { useEffect, useRef, useState } from "react";
import { usePromptStore } from "@/lib/prompt-store";

/**
 * Global centered prompt dialog — replaces browser-native window.prompt().
 * Mount once at the app root. Triggered imperatively via `prompt(message)`
 * from @/lib/prompt-store.
 */
export default function PromptDialog() {
  const { open, message, defaultValue, placeholder, _answer } = usePromptStore();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    _answer(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && _answer(null)}
    >
      <div className="bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 w-full max-w-sm mx-4 flex flex-col gap-4">
        <p className="text-[var(--text-normal)] text-sm leading-relaxed whitespace-pre-wrap">
          {message}
        </p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") _answer(null);
          }}
          className="w-full h-9 bg-[var(--bg-mid)] rounded px-3 text-sm text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => _answer(null)}
            className="px-4 py-2 rounded text-sm text-[var(--text-muted)] hover:bg-[var(--bg-mid)] transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="px-4 py-2 rounded text-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
