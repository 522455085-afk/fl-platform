/**
 * Helpers for rendering content authored by users who have since注销ed.
 *
 * The current implementation soft-deletes by overwriting `profile.username`
 * with the literal pattern `__deleted_<8-char-uid>`. Anywhere we render a
 * username pulled out of the DB, route it through `displayUsername()` so
 * the UI shows a uniform "已注销用户" placeholder instead of the raw
 * sentinel string.
 *
 * Tip: when the redaction policy changes (e.g. we move to a `deleted_at`
 * timestamp on the row instead of a sentinel username), update only this
 * file — no caller needs to change.
 */

export const DELETED_USER_PREFIX = "__deleted_";
export const DELETED_USER_LABEL = "已注销用户";

export function isDeletedUser(username: string | null | undefined): boolean {
  return !!username && username.startsWith(DELETED_USER_PREFIX);
}

/**
 * Convert a raw stored username into something safe to render. Pass-through
 * for normal users; returns the canonical "已注销用户" label otherwise.
 */
export function displayUsername(
  username: string | null | undefined,
  fallback: string = DELETED_USER_LABEL,
): string {
  if (!username) return fallback;
  if (isDeletedUser(username)) return DELETED_USER_LABEL;
  return username;
}
