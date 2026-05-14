"use client";

/**
 * Runtime unread-channel tracking.
 *
 * Tracks which channels have messages the current user hasn't seen yet,
 * and whether any of those messages contain a @mention. State is
 * in-memory only (resets on page reload); a future version could
 * persist `lastReadAt[channelId]` to CloudBase for cross-device sync.
 *
 * Usage:
 *   markChannelUnread(channelId, serverId, hasMention?)  — called when a
 *     new message arrives in a non-active channel.
 *   markChannelRead(channelId)                          — called when the
 *     user opens the channel.
 *   useChannelUnread(channelId)                         — boolean
 *   useChannelMention(channelId)                        — boolean
 *   useServerUnreadCount(channelIds)                    — number of unread
 *     channels for a server (pass the server's channel ids).
 */

import { create } from "zustand";

type UnreadStore = {
  /** Channels with at least one unseen message. */
  unread: Record<string, boolean>;
  /** Subset of unread channels that contain an @mention. */
  mentions: Record<string, boolean>;
  /** Servers that have at least one unread @mention.
   *  Tracked independently of channels so the server icon's red
   *  dot stays correct even if the mention's channel isn't in our
   *  cached `server.channels` array (which can happen for the
   *  brief window after login before channels finish loading, or
   *  for dynamically created channels). */
  serverMentions: Record<string, boolean>;
  /** Per-server mention counter — increments each time a mention
   *  lands in this server's channels while the user isn't viewing it. */
  serverMentionCounts: Record<string, number>;
  /** Per-channel mention counter — drives the badge number on
   *  individual channels (1, 2, 3, …, 99+). */
  mentionCounts: Record<string, number>;
  markChannelUnread: (channelId: string, hasMention?: boolean) => void;
  markChannelRead: (channelId: string) => void;
  /** Tag a server as having an unread mention. Increments its counter. */
  markServerMention: (serverId: string) => void;
  /** Clear all unread state for every channel in a server (on server switch). */
  markServerRead: (channelIds: string[], serverId?: string) => void;
};

export const useUnreadStore = create<UnreadStore>((set) => ({
  unread: {},
  mentions: {},
  serverMentions: {},
  serverMentionCounts: {},
  mentionCounts: {},

  markChannelUnread: (channelId, hasMention = false) =>
    set((s) => ({
      unread: { ...s.unread, [channelId]: true },
      mentions: hasMention
        ? { ...s.mentions, [channelId]: true }
        : s.mentions,
      mentionCounts: hasMention
        ? {
            ...s.mentionCounts,
            [channelId]: (s.mentionCounts[channelId] ?? 0) + 1,
          }
        : s.mentionCounts,
    })),

  markServerMention: (serverId) =>
    set((s) => ({
      serverMentions: { ...s.serverMentions, [serverId]: true },
      serverMentionCounts: {
        ...s.serverMentionCounts,
        [serverId]: (s.serverMentionCounts[serverId] ?? 0) + 1,
      },
    })),

  markChannelRead: (channelId) =>
    set((s) => {
      const unread = { ...s.unread };
      const mentions = { ...s.mentions };
      const mentionCounts = { ...s.mentionCounts };
      delete unread[channelId];
      delete mentions[channelId];
      delete mentionCounts[channelId];
      return { unread, mentions, mentionCounts };
    }),

  markServerRead: (channelIds, serverId) =>
    set((s) => {
      const unread = { ...s.unread };
      const mentions = { ...s.mentions };
      const mentionCounts = { ...s.mentionCounts };
      for (const id of channelIds) {
        delete unread[id];
        delete mentions[id];
        delete mentionCounts[id];
      }
      const serverMentions = { ...s.serverMentions };
      const serverMentionCounts = { ...s.serverMentionCounts };
      if (serverId) {
        delete serverMentions[serverId];
        delete serverMentionCounts[serverId];
      }
      return {
        unread,
        mentions,
        mentionCounts,
        serverMentions,
        serverMentionCounts,
      };
    }),
}));

/** Convenience selectors. */
export function useChannelUnread(channelId: string): boolean {
  return useUnreadStore((s) => !!s.unread[channelId]);
}
export function useChannelMention(channelId: string): boolean {
  return useUnreadStore((s) => !!s.mentions[channelId]);
}
/** Returns the count of unread channels among the given ids. */
export function useServerUnreadCount(channelIds: string[]): number {
  return useUnreadStore((s) =>
    channelIds.filter((id) => s.unread[id]).length,
  );
}

/** True if any of the given channels currently has an @mention waiting.
 *  Drives the small red dot on the server icon so users can spot
 *  "someone @-pinged me in a server I'm not viewing" at a glance.
 *
 *  Also returns true when the server itself was tagged via
 *  `markServerMention(serverId)` — useful for the (common) case where
 *  the mention came in before `server.channels` had been loaded into
 *  the store, so the channel-id lookup would have missed it. */
export function useServerHasMention(
  serverId: string,
  channelIds: string[],
): boolean {
  return useUnreadStore(
    (s) =>
      !!s.serverMentions[serverId] || channelIds.some((id) => s.mentions[id]),
  );
}

/** Number of unread @mentions targeting the user in this server.
 *  Drives the numeric badge on the server icon (1, 2, … 99+). */
export function useServerMentionCount(
  serverId: string,
  channelIds: string[],
): number {
  return useUnreadStore((s) => {
    const fromServer = s.serverMentionCounts[serverId] ?? 0;
    const fromChannels = channelIds.reduce(
      (sum, id) => sum + (s.mentionCounts[id] ?? 0),
      0,
    );
    // Take whichever number is larger — they should usually agree,
    // but the server-level counter is the authoritative one because
    // it's bumped even when the mention's channel isn't yet in our
    // cached server.channels array. Channel-level is the fallback
    // when only that path fired (e.g. realtime arrived before the
    // server-mention path).
    return Math.max(fromServer, fromChannels);
  });
}

/** Number of unread @mentions in a specific channel. */
export function useChannelMentionCount(channelId: string): number {
  return useUnreadStore((s) => s.mentionCounts[channelId] ?? 0);
}
