"use client";

/**
 * Three-tier visual staff marker. Renders one of:
 *   - 👑 Crown (gold) + red name   → Founder
 *   - 🛡️ Shield (silver) + orange  → Platform admin
 *   - ⭐ Star (yellow)              → Official-server moderator
 *
 * Consumers pass a `userId` to `<StaffBadge />` which looks up the tier
 * via `getStaffTier()` and renders the appropriate icon, or `null` if
 * the user is a regular player.
 *
 * For name-color pairing, import the exported `STAFF_NAME_CLASS[tier]`
 * map and apply it alongside the badge. Three-tier icons must always
 * be paired with the matching name color so players can tell at a
 * glance which tier they're dealing with.
 *
 * This file intentionally contains **no logic** — tier decisions live
 * in `@/lib/roles`. That keeps the UI layer pure and safe to render
 * inside memoized lists.
 */

import { Crown, ShieldCheck, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStaffTier, type StaffTier } from "@/lib/roles";

/** Name-color tailwind classes keyed by tier. `null` key → regular
 *  player, returns empty string so call sites can unconditionally
 *  splat `STAFF_NAME_CLASS[tier]`. */
// All tiers use the same bright-white name color. The badge icon
// (crown / shield / star) already identifies the tier visually so the
// coloured-name duplication is unnecessary and adds noise.
export const STAFF_NAME_CLASS: Record<NonNullable<StaffTier>, string> = {
  founder: "",
  admin: "",
  mod: "",
};

/** Human-readable Chinese label per tier — used for tooltips. */
const TIER_LABEL: Record<NonNullable<StaffTier>, string> = {
  founder: "领主",
  admin: "主教",
  mod: "书记官",
};

/** Per-tier badge color hex (for the icon's fill/text color).
 *  Each tier gets a clearly-distinguishable bright color so the badge
 *  reads at a glance — silver was rejected by the user as "looking
 *  greyed-out / disabled". */
const TIER_COLOR: Record<NonNullable<StaffTier>, string> = {
  founder: "#fbbf24", // amber-400 — gold crown
  admin: "#fb923c", // orange-400 — bright orange shield
  mod: "#facc15", // yellow-400 — sunshine yellow star
};

/** Per-tier drop-shadow/glow, matched to TIER_COLOR for a subtle halo. */
const TIER_GLOW: Record<NonNullable<StaffTier>, string> = {
  founder: "drop-shadow-[0_0_4px_rgba(251,191,36,0.55)]",
  admin: "drop-shadow-[0_0_4px_rgba(251,146,60,0.55)]",
  mod: "drop-shadow-[0_0_4px_rgba(250,204,21,0.55)]",
};

type Props = {
  /** Pixel size of the icon. Default 15, suitable for inline body text. */
  size?: number;
  className?: string;
  /** Tooltip override. Defaults to the tier's Chinese label. */
  title?: string;
};

type TierProps = Props & { tier: NonNullable<StaffTier> };

/** Internal renderer — picks the lucide icon for the given tier. */
function TierBadge({ tier, size = 15, className, title }: TierProps) {
  const color = TIER_COLOR[tier];
  const glow = TIER_GLOW[tier];
  const Icon = tier === "founder" ? Crown : tier === "admin" ? ShieldCheck : Star;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center align-middle",
        glow,
        className,
      )}
      style={{ color }}
      title={title ?? TIER_LABEL[tier]}
      aria-label={title ?? TIER_LABEL[tier]}
    >
      <Icon
        size={size}
        strokeWidth={2.5}
        fill="currentColor"
        fillOpacity={0.22}
      />
    </span>
  );
}

/** Tier-specific named exports for when the caller already knows the
 *  tier (e.g., mock test servers, docs examples). */
export function FounderBadge(props: Props) {
  return <TierBadge {...props} tier="founder" />;
}
export function PlatformAdminBadge(props: Props) {
  return <TierBadge {...props} tier="admin" />;
}
export function ModBadge(props: Props) {
  return <TierBadge {...props} tier="mod" />;
}

/** Main entry point. Pass a `userId` — renders the correct badge for
 *  their tier, or `null` if they're a regular player. */
export default function StaffBadge({
  userId,
  size = 15,
  className,
  title,
}: Props & { userId: string | null | undefined }) {
  const tier = getStaffTier(userId);
  if (!tier) return null;
  return <TierBadge tier={tier} size={size} className={className} title={title} />;
}

/** Convenience helper: for a given userId, returns the tailwind class
 *  string to color their displayed name. Regular players → "". */
export function staffNameClass(userId: string | null | undefined): string {
  const tier = getStaffTier(userId);
  return tier ? STAFF_NAME_CLASS[tier] : "";
}

/** ------------------------------------------------------------------
 *  Legacy alias so pre-refactor call sites that import
 *  `import AdminBadge from "@/components/AdminBadge"` keep compiling.
 *  It now auto-detects the tier when given a userId; if given no
 *  userId (old API), renders a founder crown for compatibility.
 *  ------------------------------------------------------------------ */
export const ADMIN_NAME_CLASS = STAFF_NAME_CLASS.founder;
