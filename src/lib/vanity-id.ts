"use client";

/**
 * Generate a non-vanity 8-digit numeric ID (玩家号 / 公会号 / 频道号).
 *
 * Tailored for the 国内游戏圈 — we deliberately do NOT exclude 4 or 13;
 * the user has explicitly opted into letting those appear so the policy
 * reflects their cultural preference.
 *
 * Forbidden patterns (= "靓号"):
 *   - 全相同         e.g. 22222222
 *   - 4+ 个连续同字  e.g. 88881234, 12888823 anywhere in the string
 *   - 末 3 位 666 / 888 / 999 / 000
 *   - 末 4 位 6666 / 8888 / 9999 / 0000 / 1234 / 4321 / 6789
 *   - 首位 0  (avoids leading-zero confusion in display)
 *
 * Return: 8-character string of digits.
 *
 * Distribution: practically uniform over the ~89.9M valid IDs after filter.
 * Generation expected to take <5 attempts in worst case.
 */

const FORBIDDEN_TAIL3 = ["666", "888", "999", "000"];
const FORBIDDEN_TAIL4 = [
  "6666",
  "8888",
  "9999",
  "0000",
  "1234",
  "4321",
  "6789",
];

function isVanity(id: string): boolean {
  if (id.length !== 8) return true;
  if (id[0] === "0") return true;

  // All same digit
  if (/^(\d)\1{7}$/.test(id)) return true;

  // 4 or more consecutive identical digits anywhere
  if (/(\d)\1{3,}/.test(id)) return true;

  const tail3 = id.slice(-3);
  if (FORBIDDEN_TAIL3.includes(tail3)) return true;

  const tail4 = id.slice(-4);
  if (FORBIDDEN_TAIL4.includes(tail4)) return true;

  return false;
}

/** Generate a fresh non-vanity 8-digit ID. */
export function genVanityId(): string {
  // Loop until we get a valid one. Most attempts succeed first try.
  // Cap iterations to avoid infinite loop if the rules ever tighten.
  for (let i = 0; i < 50; i++) {
    let s = "";
    // First digit: 1-9 (avoid leading 0)
    s += Math.floor(1 + Math.random() * 9).toString();
    for (let j = 0; j < 7; j++) {
      s += Math.floor(Math.random() * 10).toString();
    }
    if (!isVanity(s)) return s;
  }
  // Extremely unlikely fallback: just return a known-valid pattern.
  return "23457689";
}

/**
 * Format an 8-digit id for display: insert spaces every 4 digits so it's
 * easy to read aloud. e.g. 12345678 → "1234 5678".
 */
export function formatVanityId(id: string | null | undefined): string {
  if (!id || id.length !== 8) return "";
  return `${id.slice(0, 4)} ${id.slice(4)}`;
}
