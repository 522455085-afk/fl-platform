"use client";

/**
 * Emoji reactions on chat messages.
 *
 * CloudBase collection: `message_reactions`
 *   { id, message_id, emoji, user_id, user_name, created_at }
 *
 * Recommended permission rules:
 *   read:  "auth != null"
 *   write: "auth != null"
 * (CloudBase still enforces "delete only your own" via `_openid` ownership.)
 *
 * Each row uniquely identifies "user X reacted to message Y with emoji Z".
 * Toggling a reaction = if my row exists, delete it; else insert one.
 *
 * To keep the UX live, we run a periodic refetch (8 s) for the active
 * channel's reactions, mirroring the dm-threads strategy. Realtime watch
 * on this table would be nice but CloudBase's watch can be flaky on
 * filtered subscriptions.
 */

import { create } from "zustand";
import { db, dbCmd } from "@/lib/cloudbase";
import { useAuth } from "@/lib/auth-store";

// Fantasy-themed reaction set, deliberately distinct from Discord's default
// 👍 / ❤ / 😂 / 😮 / 😢 / 😡 to avoid mimicking their look-and-feel.
// All standard Unicode emoji so they render across platforms without bundles.
// Picker is grouped: 战斗 | 情绪 | 法术 | 杂项. Order is rendered as-is.
export const REACTION_EMOJIS = [
  // 战斗 / 装备
  "⚔️", "🛡️", "🏹", "🗡️", "🪓", "🔥", "💣", "🎯",
  // 情绪
  "👍", "👎", "❤️", "😂", "😱", "🤔", "😴", "😭", "🥲", "😎", "🥳", "🙏",
  // 法术 / 神秘
  "✨", "🪄", "🔮", "💀", "🐉", "👻", "⚡", "🌙",
  // 表态 / 节奏
  "🎉", "👀", "🍀", "💎", "🏆", "💯", "🆙", "🆗", "🚀", "🥇",
  // 互动
  "🤝", "👋", "💪", "🫡", "🤡", "🤣", "💬", "📣",
  // 玩梗
  "🍕", "☕", "🎮", "🎲", "🍻", "🌈",
] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export type ReactionRow = {
  id: string;
  message_id: string;
  emoji: string;
  user_id: string;
  user_name: string;
  created_at: string;
};

type Store = {
  /** Map of message_id → array of reaction rows. */
  byMessage: Record<string, ReactionRow[]>;

  /** Replace / merge rows for a given message id. */
  setForMessage: (messageId: string, rows: ReactionRow[]) => void;

  /** Bulk replace using a list of rows; groups by message_id. */
  bulkReplace: (rows: ReactionRow[]) => void;

  /**
   * Toggle a reaction by the current user on the given message.
   * Optimistic: updates local state immediately, then persists.
   */
  toggle: (messageId: string, emoji: string) => Promise<void>;

  /** Load all reactions for a list of message ids. */
  loadForMessages: (messageIds: string[]) => Promise<void>;
};

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const useReactions = create<Store>()((set, get) => ({
  byMessage: {},

  setForMessage: (messageId, rows) =>
    set((s) => ({ byMessage: { ...s.byMessage, [messageId]: rows } })),

  bulkReplace: (rows) => {
    const grouped: Record<string, ReactionRow[]> = {};
    for (const r of rows) {
      (grouped[r.message_id] ||= []).push(r);
    }
    set({ byMessage: grouped });
  },

  toggle: async (messageId, emoji) => {
    const me = useAuth.getState().user;
    if (!me) return;
    const list = get().byMessage[messageId] || [];
    const mine = list.find(
      (r) => r.user_id === me.id && r.emoji === emoji,
    );

    if (mine) {
      // Optimistic remove.
      set((s) => ({
        byMessage: {
          ...s.byMessage,
          [messageId]: (s.byMessage[messageId] || []).filter(
            (r) => r.id !== mine.id,
          ),
        },
      }));
      try {
        await db
          .collection("message_reactions")
          .where({ id: mine.id })
          .remove();
      } catch (e) {
         
        console.warn("[reactions] remove failed:", e);
      }
      return;
    }

    // Optimistic add.
    const newRow: ReactionRow = {
      id: uuid(),
      message_id: messageId,
      emoji,
      user_id: me.id,
      user_name: me.username,
      created_at: new Date().toISOString(),
    };
    set((s) => ({
      byMessage: {
        ...s.byMessage,
        [messageId]: [...(s.byMessage[messageId] || []), newRow],
      },
    }));
    try {
      await db.collection("message_reactions").add(newRow);
    } catch (e) {
       
      console.warn("[reactions] add failed:", e);
      // Roll back on failure.
      set((s) => ({
        byMessage: {
          ...s.byMessage,
          [messageId]: (s.byMessage[messageId] || []).filter(
            (r) => r.id !== newRow.id,
          ),
        },
      }));
    }
  },

  loadForMessages: async (messageIds) => {
    if (messageIds.length === 0) return;
    try {
      // CloudBase `where` with `dbCmd.in(...)` — but we only have message_id
      // arrays of moderate size (≤200). Fetch them in one query if possible.
      // We use the supabase adapter via dynamic import here would be heavy;
      // direct CloudBase command is fine.
      const res = await db
        .collection("message_reactions")
        .where({ message_id: dbCmd.in(messageIds) })
        .limit(1000)
        .get();
      const rows: ReactionRow[] = (res.data || []).map(
        (d: Record<string, unknown>) => ({
          id: (d.id as string) || (d._id as string),
          message_id: d.message_id as string,
          emoji: d.emoji as string,
          user_id: d.user_id as string,
          user_name: d.user_name as string,
          created_at: d.created_at as string,
        }),
      );
      get().bulkReplace(rows);
    } catch (e) {
       
      console.warn("[reactions] loadForMessages failed:", e);
    }
  },
}));

/** Aggregate reactions into [{emoji, count, mineSet}] for rendering. */
export function aggregateReactions(
  rows: ReactionRow[] | undefined,
  myUserId: string | undefined,
): { emoji: string; count: number; mine: boolean }[] {
  if (!rows || rows.length === 0) return [];
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of rows) {
    const cur = map.get(r.emoji) || { count: 0, mine: false };
    cur.count += 1;
    if (myUserId && r.user_id === myUserId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return [...map.entries()].map(([emoji, v]) => ({
    emoji,
    count: v.count,
    mine: v.mine,
  }));
}
