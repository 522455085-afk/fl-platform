/**
 * Pure parser that detects an active "@token" trigger under a caret.
 *
 * Used by `MentionAutocomplete` to decide whether to show the dropdown
 * and what query to filter on. Extracted so the rules (no whitespace
 * inside the token, "@" must be at start-of-string or preceded by
 * whitespace to avoid matching "email@domain.com") have a single
 * source of truth and can be regression-tested.
 */

export type MentionTrigger = {
  /** Index of the `@` character. */
  start: number;
  /** Caret position (exclusive end of the trigger). */
  end: number;
  /** Text between `@` and caret (may be empty). */
  query: string;
};

/**
 * Returns the trigger if the caret is positioned inside a "@token"
 * with no intervening whitespace and "@" anchored at start-of-string
 * or preceded by whitespace. Otherwise null.
 */
export function parseMentionTrigger(
  value: string,
  caret: number,
): MentionTrigger | null {
  if (caret <= 0) return null;
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      const prev = i > 0 ? value[i - 1] : "";
      // "@" must be at start, or preceded by whitespace — otherwise
      // it's part of something else (email, code snippet, etc.) and
      // the dropdown should stay closed.
      if (i === 0 || /\s/.test(prev)) {
        return { start: i, end: caret, query: value.slice(i + 1, caret) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i -= 1;
  }
  return null;
}
