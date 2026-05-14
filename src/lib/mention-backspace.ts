/**
 * Helpers for treating `@username` as an atomic token in plain
 * <textarea> composers. We can't render the chip in blue inside a
 * native textarea, but we can at least mimic Discord/Slack's
 * "one-press-delete" behaviour so the user doesn't have to backspace
 * through every character of a long handle.
 *
 * `tryDeleteMentionBeforeCaret` is invoked from onKeyDown when the
 * user presses Backspace with no active selection. It returns the
 * patched `{value, caret}` if a mention was just removed, or `null`
 * if the caret wasn't sitting on (or right after) a mention token —
 * in which case the default browser behaviour should run.
 */

const MENTION_BACK_RE = /@[\p{L}\p{N}_]+\s?$/u;

export function tryDeleteMentionBeforeCaret(
  value: string,
  caretStart: number,
  caretEnd: number,
): { value: string; caret: number } | null {
  if (caretStart !== caretEnd) return null; // user has a selection
  if (caretStart <= 0) return null;
  const left = value.slice(0, caretStart);
  const m = left.match(MENTION_BACK_RE);
  if (!m) return null;
  const matchStart = caretStart - m[0].length;
  // Don't fire on a lone "@" — let the user backspace the bare "@"
  // out normally. The token must have at least one name char to be
  // treated as a mention.
  if (m[0] === "@" || m[0] === "@ ") return null;
  return {
    value: value.slice(0, matchStart) + value.slice(caretStart),
    caret: matchStart,
  };
}
