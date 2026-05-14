"use client";

import React from "react";

/**
 * Visual highlight layer for the textarea-based composers.
 *
 * Why this exists: native `<textarea>` can't colour part of its
 * content. To get a Discord-style "blue @mention" without committing
 * to a full contenteditable rewrite, we render a positioned
 * `<div>` *underneath* the textarea (same font, same padding,
 * same wrap rules), painted with the @mention tokens in blue. The
 * textarea itself uses `color: transparent` + `caret-color: white`,
 * so the caret and selection still work normally and the user sees
 * the overlay through the textarea.
 *
 * The overlay must mirror EVERY style that affects glyph layout:
 *   font-family, font-size, line-height, letter-spacing,
 *   white-space (pre-wrap), word-wrap (break-word), padding,
 *   text-align. Pass them via `style` from the consumer to keep
 *   the two layers pixel-aligned.
 */

const MENTION_RE = /(@[\p{L}\p{N}_]+)/u;

export default function MentionHighlightOverlay({
  value,
  className,
  style,
  scrollTop,
  validNames,
}: {
  value: string;
  /** Tailwind class string mirroring the textarea's typography. */
  className?: string;
  /** Inline overrides — typically font + padding values copied
   *  from the textarea's computed style. */
  style?: React.CSSProperties;
  /** Vertical scroll offset of the textarea, so the overlay can
   *  scroll along with it. */
  scrollTop?: number;
  /** Whitelist of usernames that should render blue. Pass `undefined`
   *  to colour *all* @tokens (legacy behaviour). When provided, only
   *  `@<name>` where `name` is in the set turns blue — typed but
   *  unmatched @text stays the default text colour, so the user
   *  immediately sees "this didn't actually mention anyone". */
  validNames?: Set<string>;
}) {
  // Append a zero-width sentinel so trailing newlines render
  // their height in the overlay (otherwise browsers collapse the
  // last empty line and the highlight drifts up vs. the textarea).
  const padded = value.endsWith("\n") ? value + "\u200B" : value;
  const parts = padded.split(MENTION_RE);
  return (
    <div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "hidden",
        // NOTE: do NOT default `color` to transparent here. The
        // textarea on top is already transparent, so the overlay
        // must paint the *entire* text — plain segments in the
        // user's normal text colour, @mentions in blue. The
        // consumer supplies the plain-text colour via `style.color`
        // (defaults below to white so we at least see something).
        color: "var(--text-normal, #fff)",
        // Sync vertical scroll with the textarea so long drafts
        // don't drift between layers.
        transform: scrollTop ? `translateY(${-scrollTop}px)` : undefined,
        ...style,
      }}
    >
      {parts.map((p, i) => {
        if (i % 2 !== 1) {
          return <React.Fragment key={i}>{p}</React.Fragment>;
        }
        const name = p.slice(1); // strip leading @
        const match = validNames ? validNames.has(name) : true;
        return match ? (
          <span key={i} style={{ color: "#5b9dff", fontWeight: 500 }}>
            {p}
          </span>
        ) : (
          // Unmatched @ — render in the normal text colour so the
          // user can tell it isn't an actual mention.
          <React.Fragment key={i}>{p}</React.Fragment>
        );
      })}
    </div>
  );
}
