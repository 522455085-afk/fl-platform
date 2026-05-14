"use client";

/**
 * @-mention autocomplete dropdown for the channel composer.
 *
 * Watches the caller-provided `value` + `caret` and, when the user has
 * an "@token" partial active under the cursor, surfaces matching
 * candidates. The caller wires keyboard handlers (ArrowUp/Down/Enter/
 * Tab/Escape) by inspecting `isOpen` and the imperative API returned
 * via the `apiRef` prop.
 *
 * Why a controlled component:
 * - The composer textarea lives inside ChatView and is already
 *   sharing state with the composer store. Wrapping it would have
 *   meant either lifting all that state up here or duplicating it.
 * - The parent already owns the keydown handler (Enter sends), so
 *   we just expose a minimal "did the autocomplete handle this key?"
 *   imperative method that the parent calls *before* its own logic.
 */

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import Avatar from "@/components/Avatar";
import type { PresenceUser } from "@/lib/use-presence";
import { parseMentionTrigger } from "@/lib/mention-parse";

export type MentionApi = {
  /**
   * Called by the parent on every keydown BEFORE its own logic runs.
   * If the autocomplete consumed the event (e.g. ArrowDown to move
   * selection, Enter to commit), returns true and the parent should
   * skip its own handling. Otherwise returns false.
   */
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Returns true if the dropdown is currently visible. */
  isOpen: () => boolean;
};

type Props = {
  /** Current textarea value. */
  value: string;
  /** Current caret position (selectionStart). */
  caret: number;
  /** Online users to draw candidates from. */
  candidates: PresenceUser[];
  /** Exclude self from the list — you can't @ yourself. */
  selfId?: string;
  /**
   * Called when the user commits a selection. Receives the new draft
   * string and the new caret position so the parent can update both
   * atomically.
   */
  onCommit: (newValue: string, newCaret: number) => void;
  apiRef: RefObject<MentionApi | null>;
};

const MAX_VISIBLE = 6;

export default function MentionAutocomplete({
  value,
  caret,
  candidates,
  selfId,
  onCommit,
  apiRef,
}: Props) {
  // Detect any active @-trigger under the caret. Rules live in
  // `parseMentionTrigger` so they can be unit-tested independently.
  const trigger = useMemo(
    () => parseMentionTrigger(value, caret),
    [value, caret],
  );

  const queryLower = trigger?.query.toLowerCase() ?? "";

  const filtered = useMemo(() => {
    if (!trigger) return [];
    return candidates
      .filter((u) => u.user_id !== selfId)
      .filter((u) => {
        if (!queryLower) return true;
        return u.username.toLowerCase().includes(queryLower);
      })
      // Stable order: exact prefix matches first, then substring.
      .sort((a, b) => {
        const ap = a.username.toLowerCase().startsWith(queryLower) ? 0 : 1;
        const bp = b.username.toLowerCase().startsWith(queryLower) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.username.localeCompare(b.username);
      })
      .slice(0, MAX_VISIBLE);
  }, [trigger, candidates, selfId, queryLower]);

  const [activeIdx, setActiveIdx] = useState(0);
  // Reset selection when the candidate list changes shape.
  useEffect(() => {
    setActiveIdx(0);
  }, [trigger?.query, filtered.length]);

  const open = trigger !== null && filtered.length > 0;

  const commit = (idx: number) => {
    if (!trigger) return;
    const user = filtered[idx];
    if (!user) return;
    // Insert "@username " replacing the trigger range.
    const insert = `@${user.username} `;
    const newValue =
      value.slice(0, trigger.start) + insert + value.slice(trigger.end);
    const newCaret = trigger.start + insert.length;
    onCommit(newValue, newCaret);
  };

  // Expose imperative API.
  const apiObj = useRef<MentionApi>({
    handleKeyDown: () => false,
    isOpen: () => false,
  });
  apiObj.current.isOpen = () => open;
  apiObj.current.handleKeyDown = (e) => {
    if (!open) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % filtered.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit(activeIdx);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // "Close" by jumping caret outside trigger — but we don't own
      // the caret. Simplest: just commit with empty replacement so
      // the parent can choose to clear. Here we just consume Esc and
      // do nothing; the trigger will go away as soon as the user
      // types a space or deletes the @.
      // Actually: just treat as no-op consumption.
      return true;
    }
    return false;
  };
  useImperativeHandle(apiRef, () => apiObj.current, [open, filtered, activeIdx]);

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-1 w-72 max-w-[90vw] bg-[var(--bg-floating,var(--bg-darker))] border border-[var(--border)] rounded-md shadow-xl overflow-hidden z-50"
      onMouseDown={(e) => {
        // Prevent the textarea from losing focus on click — we want
        // the caret to stay where it was after commit.
        e.preventDefault();
      }}
    >
      <div className="px-3 py-1.5 text-[11px] text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border)]">
        提及成员{trigger?.query ? ` · ${trigger.query}` : ""}
      </div>
      <ul className="py-1 max-h-72 overflow-y-auto">
        {filtered.map((u, i) => (
          <li key={u.user_id}>
            <button
              type="button"
              onClick={() => commit(i)}
              onMouseEnter={() => setActiveIdx(i)}
              className={[
                "w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm",
                i === activeIdx
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-normal)] hover:bg-[var(--bg-mid)]",
              ].join(" ")}
            >
              <Avatar
                text={u.avatar}
                color={u.avatar_color}
                url={u.avatar_url ?? null}
                size={20}
              />
              <span className="truncate">{u.username}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
