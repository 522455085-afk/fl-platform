"use client";

/**
 * Skeleton placeholders shown while data is being fetched. Match
 * Discord's loading style: muted grey bars + circles with a slow
 * shimmer (`animate-pulse`). Used by:
 *   - ChatView during message history load
 *   - MemberList during initial presence/roster load
 *
 * The visual design is intentionally low-key — same `--bg-mid` /
 * `--bg-light` colors as real UI elements so the transition from
 * skeleton to real content is barely perceptible.
 */

import { cn } from "@/lib/utils";

/**
 * Base skeleton bar / circle. Defaults to a 12px-tall rounded bar.
 * Pass `className` to override width/height/shape (e.g. `rounded-full
 * size-10` for an avatar circle).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-[var(--bg-mid)]/70",
        className,
      )}
    />
  );
}

/**
 * Single message row skeleton: avatar circle + 2 lines of text bars,
 * matching the spacing of real ChatView messages so the layout
 * doesn't jump when the real content swaps in.
 *
 * `lines` controls how many text lines (1–3) to render — the loader
 * varies them so the placeholder doesn't look mechanical.
 */
export function MessageSkeleton({ lines = 2 }: { lines?: 1 | 2 | 3 }) {
  return (
    <div className="flex gap-3 px-4 py-2">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="flex-1 min-w-0 space-y-2 py-1">
        {/* Header (name + timestamp) */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-12 opacity-60" />
        </div>
        {/* Body lines, each with a slightly different width so the
            placeholder reads as "real text" rather than a uniform block. */}
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              "h-3",
              i === 0 && "w-[80%]",
              i === 1 && "w-[60%]",
              i === 2 && "w-[40%]",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Renders a typical chat-history skeleton: a stack of MessageSkeleton
 * rows with varying line counts. Used by ChatView's loading state to
 * replace the previous plain "加载历史消息…" text.
 */
export function MessageListSkeleton() {
  // Pseudo-random distribution of line counts. Stable across renders
  // (no random calls) so React doesn't tear the placeholder layout.
  const pattern: Array<1 | 2 | 3> = [2, 1, 3, 2, 1, 2, 3, 1];
  return (
    <div className="py-2">
      {pattern.map((lines, i) => (
        <MessageSkeleton key={i} lines={lines} />
      ))}
    </div>
  );
}

/**
 * Single member-row skeleton for the right-side member panel: small
 * avatar circle + short name bar. Width of the name varies so the
 * placeholder list doesn't look like a stamped pattern.
 */
export function MemberRowSkeleton({ width }: { width?: "short" | "med" | "long" }) {
  const w =
    width === "short" ? "w-14" : width === "long" ? "w-28" : "w-20";
  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <Skeleton className={cn("h-3", w)} />
    </div>
  );
}

/**
 * Single channel-row skeleton for the left-side channel panel: a
 * small icon (hash / speaker shape, just a square here) + a name
 * bar. Used to populate the channel list during a server switch.
 */
export function ChannelRowSkeleton({ width }: { width?: "short" | "med" | "long" }) {
  const w =
    width === "short" ? "w-16" : width === "long" ? "w-32" : "w-24";
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Skeleton className="size-4 shrink-0 rounded" />
      <Skeleton className={cn("h-3", w)} />
    </div>
  );
}

/**
 * Channel-sidebar skeleton: a few category header bars each followed
 * by a stack of channel rows. Stable widths so the placeholder
 * layout doesn't jitter between renders. Matches the typical
 * 3-category × 3-channel structure of a real server.
 */
export function ChannelListSkeleton() {
  const groups: Array<{ header: string; rows: Array<"short" | "med" | "long"> }> = [
    { header: "w-16", rows: ["med", "long", "short"] },
    { header: "w-12", rows: ["long", "med", "short", "med"] },
    { header: "w-20", rows: ["med", "short"] },
  ];
  return (
    <div className="px-2 py-2">
      {groups.map((g, gi) => (
        <div key={gi} className="mb-3">
          <Skeleton className={cn("ml-1 mb-1.5 h-2.5 opacity-70", g.header)} />
          {g.rows.map((w, i) => (
            <ChannelRowSkeleton key={i} width={w} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Member-panel skeleton: a section header bar + a stack of member
 * rows. Matches the look of a populated MemberList's role-grouped
 * panel so the right sidebar feels populated even before presence /
 * roster lands.
 */
export function MemberListSkeleton() {
  // Stable pattern so the placeholder layout doesn't twitch between
  // renders. Two faux sections: "主教" and "成员".
  const adminWidths: Array<"short" | "med" | "long"> = ["med", "long", "short"];
  const memberWidths: Array<"short" | "med" | "long"> = [
    "long",
    "med",
    "short",
    "med",
    "long",
    "med",
    "short",
    "med",
  ];
  return (
    <div className="py-3">
      <Skeleton className="mx-4 mb-2 h-2.5 w-16 opacity-70" />
      <div className="mb-3">
        {adminWidths.map((w, i) => (
          <MemberRowSkeleton key={`a${i}`} width={w} />
        ))}
      </div>
      <Skeleton className="mx-4 mb-2 h-2.5 w-12 opacity-70" />
      <div>
        {memberWidths.map((w, i) => (
          <MemberRowSkeleton key={`m${i}`} width={w} />
        ))}
      </div>
    </div>
  );
}
