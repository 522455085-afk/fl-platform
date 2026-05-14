"use client";

/**
 * Unified avatar renderer.
 *
 * Renders an uploaded image when `url` is a valid dataURL / http URL,
 * otherwise falls back to a colored letter tile. Used everywhere a user
 * or server icon appears so swapping between letter and image is a
 * single-source-of-truth change.
 *
 * Sizing: pass `size` in pixels. Common values:
 *   - 28  user list / message row
 *   - 40  user panel / DM row / member list
 *   - 48  server icon
 *   - 80  profile preview
 */

import { useState, useEffect, memo } from "react";
import { Smartphone } from "lucide-react";
import { isAvatarUrl } from "@/lib/avatar-upload";
import { cn } from "@/lib/utils";

type Props = {
  text: string;
  color: string;
  url?: string | null;
  size?: number;
  /** Border-radius preset; defaults to full (round). */
  shape?: "round" | "squircle" | "square";
  /** Extra classes (e.g. ring on hover). */
  className?: string;
  /** Inline style override (rarely needed). */
  style?: React.CSSProperties;
  title?: string;
  /**
   * When true, overlay a tiny phone icon at the bottom-right of the
   * avatar so viewers know the user is on the mobile App (not web).
   * See `DeviceType` in `@/lib/device-type`.
   */
  mobile?: boolean;
};

// Memoized comparison for Avatar props
const Avatar = memo(function Avatar({
  text,
  color,
  url,
  size = 40,
  shape = "round",
  className,
  style,
  title,
  mobile = false,
}: Props) {
  const radius =
    shape === "round"
      ? "rounded-full"
      : shape === "squircle"
        ? "rounded-xl"
        : "rounded";

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.4)),
    ...style,
  };

  // Phone badge is roughly 45% of the avatar size, clamped to [14, 22]
  // so it stays readable on both 28px list rows and 80px profile cards.
  const badgeSize = Math.max(14, Math.min(22, Math.round(size * 0.45)));
  const badgeIconSize = Math.max(9, Math.round(badgeSize * 0.6));
  const [imgError, setImgError] = useState(false);
  // If the URL prop changes (e.g. user uploaded a new avatar), reset the
  // error state so we attempt to load the fresh URL.
  useEffect(() => { setImgError(false); }, [url]);

  const core = isAvatarUrl(url) && !imgError ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url as string}
      alt={text}
      title={title}
      className={cn("object-cover shrink-0 select-none", radius, className)}
      style={baseStyle}
      draggable={false}
      onError={() => setImgError(true)}
    />
  ) : (
    <div
      title={title}
      className={cn(
        "grid place-items-center text-white font-semibold shrink-0 select-none",
        radius,
        className,
      )}
      style={{ background: color, ...baseStyle }}
    >
      {(text || "?").slice(0, 2)}
    </div>
  );

  if (!mobile) return core;

  // Wrap in a relative container so we can position the badge. The
  // wrapper inherits shrink-0 from the core element via layout context.
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {core}
      <span
        title="手机 App 在线"
        className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-[var(--accent)] text-white ring-2 ring-[var(--bg-darker)]"
        style={{ width: badgeSize, height: badgeSize }}
      >
        <Smartphone size={badgeIconSize} strokeWidth={2.5} />
      </span>
    </div>
  );
});

export default Avatar;
