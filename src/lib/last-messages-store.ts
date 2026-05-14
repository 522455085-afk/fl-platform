"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";

/**
 * Tracks the most recent message per channel so the channel sidebar
 * can render a "preview" line under each text/announcement row.
 *
 * Data flow:
 *   1. On server entry the caller invokes `loadLatestForChannels(...)`
 *      which fires a single `SELECT … ORDER BY created_at DESC LIMIT 1`
 *      per channel (in parallel). Cheap because the channel list per
 *      server is small (< 10).
 *   2. The page-level realtime INSERT watcher in `app/page.tsx` calls
 *      `upsert(...)` for every incoming row, keeping the preview live.
 *
 * No persistence — the store rebuilds on every reload. That keeps it
 * cheap and consistent with the rest of the realtime stack.
 */

export type LastMessage = {
  channelId: string;
  authorName: string;
  content: string;
  /** ms epoch — used for sorting / formatting timestamps. */
  at: number;
};

type Store = {
  byChannel: Record<string, LastMessage>;
  upsert: (m: LastMessage) => void;
  loadLatestForChannels: (channelIds: string[]) => Promise<void>;
};

export const useLastMessages = create<Store>((set, get) => ({
  byChannel: {},

  upsert: (m) =>
    set((s) => {
      const existing = s.byChannel[m.channelId];
      // Ignore out-of-order arrivals (an older row landing after a
      // newer one would otherwise downgrade the preview).
      if (existing && existing.at > m.at) return s;
      return { byChannel: { ...s.byChannel, [m.channelId]: m } };
    }),

  loadLatestForChannels: async (channelIds) => {
    // De-dupe with what we already have so a server re-entry
    // doesn't re-fetch rows we already cached.
    const missing = channelIds.filter((id) => !get().byChannel[id]);
    if (missing.length === 0) return;
    // SINGLE batched query rather than one round-trip per channel.
    // Spawning N parallel `.eq(channel_id, …).limit(1)` requests
    // (one per text/announcement channel) was the main cause of
    // "进入其他服务器很卡" — every server switch turned into 4-8+
    // simultaneous HTTP requests + a big realtime resubscribe.
    //
    // Trade-off: we fetch up to 200 recent rows across all the
    // requested channels and pick the newest one per channel client
    // -side. With < 10 channels per server this is plenty (each
    // channel only needs ONE row); if a channel is so silent that
    // its latest message falls outside the 200-row window the
    // preview just stays empty until a new message arrives, which
    // is acceptable.
    let data: unknown = null;
    try {
      const res = await supabase
        .from("messages")
        .select("channel_id, author_name, content, created_at")
        .in("channel_id", missing)
        .order("created_at", { ascending: false })
        .limit(200);
      if (res.error) return;
      data = res.data;
    } catch (e) {
      // Defensive: if the underlying driver doesn't support `.in()`
      // (older CloudBase shim build) we don't want a rejected promise
      // here to break the eager-preload caller, which used to leave
      // the channel-sidebar stuck on its skeleton ("一直转圈不让我
      // 进去"). Realtime upserts will still populate previews for
      // any messages that arrive AFTER this point.
      // eslint-disable-next-line no-console
      console.warn("[last-messages] loadLatestForChannels failed:", e);
      return;
    }
    if (!data) return;
    const next: Record<string, LastMessage> = { ...get().byChannel };
    for (const row of data as Array<{
      channel_id: string;
      author_name: string;
      content: string;
      created_at: string;
    }>) {
      // Rows arrive in DESC order, so the FIRST hit per channel is
      // the latest — skip subsequent occurrences.
      if (next[row.channel_id]) continue;
      next[row.channel_id] = {
        channelId: row.channel_id,
        authorName: row.author_name,
        content: row.content ?? "",
        at: new Date(row.created_at).getTime(),
      };
    }
    set({ byChannel: next });
  },
}));
