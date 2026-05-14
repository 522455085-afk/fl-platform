"use client";

/**
 * Three-tier platform role system, configured entirely via env vars so
 * appointments are controlled by the founder's local machine (not by
 * any in-app UI). See docs/AdminOnboarding.md for the full workflow.
 *
 * ```
 *   .env.local example
 *   # Tier 1 — Founder (you). Highest authority, never delegated.
 *   NEXT_PUBLIC_FOUNDER_IDS=2052698430169415680
 *
 *   # Tier 2 — Platform admins. Help moderate everywhere on the site.
 *   NEXT_PUBLIC_ADMIN_IDS=
 *
 *   # Tier 3 — Player moderators. Scoped to official server only.
 *   NEXT_PUBLIC_OFFICIAL_MOD_IDS=
 * ```
 *
 * Separation of concerns:
 *   - Tier 1 (founder): everything, exclusive privileges = appoint
 *     other admins (via env), edit official server config.
 *   - Tier 2 (admin): all moderation (delete/kick/pin/ban/mute/etc.)
 *     site-wide. Cannot appoint others. Cannot edit official server.
 *   - Tier 3 (mod): moderation scoped to the *official server* — can
 *     kick/delete/force-disband within it, but powerless in custom
 *     servers and DMs. Cannot pin, cannot ban, cannot view audit log.
 *
 * We keep the old `NEXT_PUBLIC_ADMIN_USER_IDS` var as a backwards-
 * compatible alias for `NEXT_PUBLIC_FOUNDER_IDS` so any existing
 * deployment doesn't immediately break on upgrade.
 */

import { useAuth } from "./auth-store";

function parseIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Legacy alias: treat NEXT_PUBLIC_ADMIN_USER_IDS as a seed for founders
// so pre-refactor .env.local keeps working until the user migrates.
const LEGACY_FOUNDER_IDS = parseIds(process.env.NEXT_PUBLIC_ADMIN_USER_IDS);
const FOUNDER_IDS = new Set<string>([
  ...parseIds(process.env.NEXT_PUBLIC_FOUNDER_IDS),
  ...LEGACY_FOUNDER_IDS,
]);
const ADMIN_IDS = parseIds(process.env.NEXT_PUBLIC_ADMIN_IDS);
const OFFICIAL_MOD_IDS = parseIds(process.env.NEXT_PUBLIC_OFFICIAL_MOD_IDS);

/** ID of the official/home server. All mod scope is anchored here. */
export const OFFICIAL_SERVER_ID = "home";

export type StaffTier = "founder" | "admin" | "mod" | null;

/** ------------------------------------------------------------------
 *  Tier identity — pure predicates. Outside-React safe.
 *  ------------------------------------------------------------------ */

export function isFounderId(id: string | null | undefined): boolean {
  return !!id && FOUNDER_IDS.has(id);
}

export function isPlatformAdminId(id: string | null | undefined): boolean {
  return !!id && ADMIN_IDS.has(id);
}

export function isOfficialModId(id: string | null | undefined): boolean {
  return !!id && OFFICIAL_MOD_IDS.has(id);
}

/** The highest tier the user belongs to, or null if they're a regular
 *  player. Used for badge rendering and UI gating. */
export function getStaffTier(id: string | null | undefined): StaffTier {
  if (!id) return null;
  if (FOUNDER_IDS.has(id)) return "founder";
  if (ADMIN_IDS.has(id)) return "admin";
  if (OFFICIAL_MOD_IDS.has(id)) return "mod";
  return null;
}

/** True for any tier of staff. Useful when you just need a visual cue
 *  (e.g., unlocking the "delete own message" button). */
export function isAnyStaffId(id: string | null | undefined): boolean {
  return getStaffTier(id) !== null;
}

/** ------------------------------------------------------------------
 *  Capability predicates — "can user X do action Y in context Z?"
 *  Call these at the enforcement site. Do NOT reimplement tier logic
 *  inline at call sites; always go through a named capability.
 *  ------------------------------------------------------------------ */

/** Site-wide moderation: delete anyone's message in any server, pin
 *  messages, send high-priority announcements, force-disband any
 *  custom-server party, force-delist trades, view audit log. */
export function canModerateGlobally(id: string | null | undefined): boolean {
  const tier = getStaffTier(id);
  return tier === "founder" || tier === "admin";
}

/** Moderation within the *official* server specifically. Mods + all
 *  higher tiers. Used for voice kick / party disband / message delete
 *  when the target server is the official server. */
export function canModerateOfficial(id: string | null | undefined): boolean {
  return isAnyStaffId(id);
}

/** Action-specific helper that also takes a server context. Mods can
 *  only moderate in the official server; admins+founder can moderate
 *  everywhere. */
export function canModerateServer(
  userId: string | null | undefined,
  serverId: string | null | undefined,
): boolean {
  if (canModerateGlobally(userId)) return true;
  return isOfficialModId(userId) && serverId === OFFICIAL_SERVER_ID;
}

/** Pinning, high-priority announcements — restricted to admin+founder
 *  everywhere (even in the official server, mods don't get to pin). */
export const canPinMessages = canModerateGlobally;
export const canPostHighPriority = canModerateGlobally;

/** Permanent account ban. Founder + admin only (mods excluded). */
export const canBanUsers = canModerateGlobally;

/** Temporary mute — all three tiers, but scoped to where they can
 *  moderate (mod only in official server). */
export function canMuteInServer(
  userId: string | null | undefined,
  serverId: string | null | undefined,
): boolean {
  return canModerateServer(userId, serverId);
}

/** Viewing the admin-action audit log. Founder + admin only. */
export const canViewAuditLog = canModerateGlobally;

/** Editing the official server's config (name, avatar, channels).
 *  Founder-exclusive — admins help moderate but don't reshape the site. */
export const canEditOfficialServer = isFounderId;

/** Users may not delete/edit their own messages unless they're staff.
 *  Messages are considered permanent once posted — this is an
 *  intentional design decision; regular players have no "undo send"
 *  option. Staff (founder / admin / mod) retain the ability so they
 *  can remove their own moderation slip-ups. */
export function canDeleteOwnMessage(
  authorId: string,
  viewerId: string | null | undefined,
): boolean {
  if (authorId !== viewerId) return false;
  return isAnyStaffId(viewerId);
}

/** ------------------------------------------------------------------
 *  Legacy / compatibility surface — keep these so old call sites
 *  don't all need to be rewritten in lockstep with this refactor.
 *  ------------------------------------------------------------------ */

/** @deprecated Use `canModerateGlobally` or `getStaffTier` instead.
 *  Retained as "is this user a site-wide staff" = founder || admin. */
export function isAdminId(id: string | null | undefined): boolean {
  return canModerateGlobally(id);
}

/** ------------------------------------------------------------------
 *  React hook wrappers.
 *  ------------------------------------------------------------------ */

export function useIsAdmin(): boolean {
  const user = useAuth((s) => s.user);
  return canModerateGlobally(user?.id);
}

export function useStaffTier(): StaffTier {
  const user = useAuth((s) => s.user);
  return getStaffTier(user?.id);
}

export function useIsFounder(): boolean {
  const user = useAuth((s) => s.user);
  return isFounderId(user?.id);
}
