"use client";

/**
 * Composer "互动" popover — small menu of social chat games whose
 * results post a regular text message to the channel so everyone sees
 * the outcome. Currently:
 *
 *   - 投掷骰子 — `🎲 [user] 投掷了骰子：5`
 *   - 石头剪刀布 — `✊ [user] 出了：剪刀`
 *   - roll 点 — `🎯 [user] roll 点：87 / 100`
 *
 * Why post a message rather than mutate local state: realtime
 * propagation is already wired for normal messages, so the dice/roll
 * result becomes part of the channel history (auditable, scrollable)
 * with no extra plumbing.
 */

import { useEffect, useRef, useState } from "react";
import { Dices, Hand, Target, Gamepad2 } from "lucide-react";
import Tooltip from "@/components/Tooltip";

const RPS = ["石头", "剪刀", "布"] as const;

type Props = {
  /** Called with the formatted message text to post into the channel. */
  onPost: (text: string) => void;
  /** When true, the trigger button is disabled (e.g. composer locked). */
  disabled?: boolean;
};

export default function InteractionMenu({ onPost, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fire = (text: string) => {
    onPost(text);
    setOpen(false);
  };

  const rollDice = () => {
    const n = 1 + Math.floor(Math.random() * 6);
    fire(`🎲 投掷了骰子：${n}`);
  };
  const rollRps = () => {
    const pick = RPS[Math.floor(Math.random() * RPS.length)];
    fire(`✊ 出了：${pick}`);
  };
  const rollHundred = () => {
    const n = 1 + Math.floor(Math.random() * 100);
    fire(`🎯 roll 点：${n} / 100`);
  };

  return (
    <span ref={rootRef} className="relative inline-flex">
      <Tooltip label="互动 — 骰子 / 石头剪刀布 / roll 点">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="hover:text-white transition-colors disabled:opacity-40"
        >
          <Gamepad2 size={22} />
        </button>
      </Tooltip>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-44 bg-[var(--bg-darkest)] border border-[var(--accent)]/40 rounded-md shadow-xl z-50 py-1 overflow-hidden"
          onMouseDown={(e) => e.preventDefault()}
        >
          <MenuRow icon={<Dices size={14} />} label="投掷骰子" sub="1–6" onClick={rollDice} />
          <MenuRow icon={<Hand size={14} />} label="石头剪刀布" sub="随机" onClick={rollRps} />
          <MenuRow icon={<Target size={14} />} label="roll 点" sub="1–100" onClick={rollHundred} />
        </div>
      )}
    </span>
  );
}

function MenuRow({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--text-normal)] hover:bg-[var(--bg-mid)] transition-colors"
    >
      <span className="text-[var(--accent)] shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-[10px] text-[var(--text-muted)]">{sub}</span>
    </button>
  );
}
