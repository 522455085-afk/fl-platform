"use client";

/**
 * Site-wide listener for @mentions targeting the current user.
 *
 * Mount once at the app root. Subscribes to INSERTs on the global
 * messages table (no channel filter, unlike ChatView's subscription
 * which is scoped to whichever channel is open) so the user gets
 * notified the moment someone @-pings them in ANY channel they
 * weren't currently viewing.
 *
 * Three side-effects per mention:
 *   1. Inbox entry (`notifications-store`) — the red dot in the top
 *      bar / inbox panel.
 *   2. Per-channel unread + mention flag (`unread-store`) so the
 *      channel name in the sidebar gets the highlight + mention
 *      pill.
 *   3. Audio ding + OS notification (`browser-notify`) — same path
 *      used for ChatView's in-channel mentions.
 *
 * Filters:
 *   - Skip our own messages.
 *   - Skip messages older than 2 minutes at arrival time (avoids the
 *     "login replays months of mentions" avalanche).
 *   - Dedup by row id within the session.
 */

import { useEffect, useRef } from "react";
import { supabase, type DbMessage } from "@/lib/supabase";
import { db } from "@/lib/cloudbase";
import { useAuth } from "@/lib/auth-store";
import { useNotifications } from "@/lib/notifications-store";
import { useUnreadStore } from "@/lib/unread-store";
import { useAllServers } from "@/lib/servers-store";
import { notifyMention } from "@/lib/browser-notify";

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

export default function MentionWatcher() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const username = user?.username ?? null;
  // Subscribed via the store so the lookup table stays fresh as the
  // user joins / leaves servers; we read the latest snapshot inside
  // the realtime callback via a ref to avoid stale-closure misses.
  const allServers = useAllServers();
  const serversRef = useRef(allServers);
  serversRef.current = allServers;

  useEffect(() => {
    if (!userId || !username) return;
    const seen = new Set<string>();
    const mentionToken = ("@" + username).toLowerCase();
    // Broadcast mentions — channel-wide pings that should also fire
    // the audible/inbox notification for everyone (not just the
    // user's personal @username). Kept short and lowercase so the
    // includes() check is cheap.
    const broadcastTokens = ["@everyone", "@all", "@here", "@所有人", "@全体"];
    // Use direct CloudBase db.watch() on messages — no filter, WebSocket push.
    // Bypasses the supabase adapter's poll fallback which fails on unfiltered
    // queries when orderBy is unavailable (returns random 50 docs, missing new ones).
    let watchRef: { close: () => void } | null = null;
    const handleDoc = (row: DbMessage | undefined) => {
          if (!row || !row.id) return;
          if (row.author_id === userId) return;
          if (seen.has(row.id)) return;
          seen.add(row.id);
          // Cap the seen-set growth so a long-running session doesn't
          // grow it unboundedly. 1000 entries is enough for any
          // realistic backlog window.
          if (seen.size > 1000) {
            const it = seen.values();
            seen.delete(it.next().value as string);
          }
          const ts = row.created_at
            ? new Date(row.created_at).getTime()
            : Date.now();
          if (Date.now() - ts > STALE_THRESHOLD_MS) return;
          const content = row.content || "";
          const lower = content.toLowerCase();
          const direct = lower.includes(mentionToken);
          const broadcast =
            !direct && broadcastTokens.some((t) => lower.includes(t));

          // Direct-message fast path: any insert into a `dm:a:b`
          // channel where I'm a participant goes through the same
          // toast/inbox/sound fan-out as the polling path, but
          // arrives via realtime instead of waiting up to 8s for
          // the next pollIncomingDms tick. Dedup is handled by the
          // shared `seen` set above plus the dm-threads-store's
          // own per-session `seenIncomingMsgIds` (idempotent
          // upsert + coalescing toast).
          const cid = row.channel_id || "";
          if (cid.startsWith("dm:")) {
            const parts = cid.split(":");
            if (parts.length === 3 && (parts[1] === userId || parts[2] === userId)) {
              // Lazy import — same trick used in dm-threads-store
              // to avoid a static cycle through the auth/cloudbase
              // graph.
              import("@/lib/dm-threads-store").then(({ useDmThreads }) => {
                void useDmThreads.getState().noteIncomingDm({
                  id: row.id,
                  author_id: row.author_id,
                  author_name: row.author_name,
                  author_avatar: row.author_avatar,
                  author_color: row.author_color,
                  author_avatar_url: row.author_avatar_url ?? null,
                  content: row.content,
                  created_at: row.created_at,
                });
              });
            }
            // DMs never carry an @mention against an arbitrary
            // server channel, so we return here regardless of the
            // mention-token match — no need to fall through to the
            // server-mention branch below.
            return;
          }

          if (!direct && !broadcast) return;

           
          console.log(
            "[mention-watch] hit channel_id=",
            row.channel_id,
            "serversRef ids=",
            serversRef.current.map((s) => s.id),
            "first server channel ids=",
            (serversRef.current[0]?.channels ?? []).flatMap((c) =>
              c.channels.map((ch) => ch.id),
            ),
          );

          // Resolve which server this channel belongs to so we can:
          //   - show the server name in the inbox subtitle
          //   - flag the server icon's red dot directly (bypasses the
          //     channel-id-in-server.channels lookup race)
          //   - route the click to setActiveServerId during navigation
          let serverId: string | undefined;
          let serverName: string | undefined;
          for (const srv of serversRef.current) {
            const found = (srv.channels ?? []).some((cat) =>
              cat.channels.some((c) => c.id === row.channel_id),
            );
            if (found) {
              serverId = srv.id;
              serverName = srv.name;
              break;
            }
          }
          // Fallback: official channel ids are namespaced as
          // `${serverId}-${slug}` (see mock-data.ts). When the
          // channels[] array on `srv` is stale or empty (the actual
          // cause of "服务器头像无红点" — the merged server roster
          // dropped the hardcoded channels because a CloudBase
          // override doc shadowed them) we can still recover the
          // server identity by string prefix. Keeps the red-dot +
          // navigation working without depending on srv.channels.
          if (!serverId) {
            // Both separators in use: `:` for user-created servers
            // (e.g. `cust_t61w3bjaca:general`), `-` for official
            // mock servers (`home-general`). Whichever appears
            // first wins — neither slug currently contains the
            // other character.
            const cid = row.channel_id || "";
            const sepIdx =
              cid.indexOf(":") >= 0 ? cid.indexOf(":") : cid.indexOf("-");
            if (sepIdx > 0) {
              const guessed = cid.slice(0, sepIdx);
              const srv = serversRef.current.find((s) => s.id === guessed);
              if (srv) {
                serverId = srv.id;
                serverName = srv.name;
              }
            }
          }
          const baseTitle = direct
            ? `${row.author_name} 提到了你`
            : `${row.author_name} 提到了全体成员`;
          const fullTitle = serverName ? `${baseTitle} · ${serverName}` : baseTitle;

          // 1. Inbox dot
          useNotifications.getState().add({
            kind: "mention",
            title: fullTitle,
            body: content.slice(0, 120),
            channelId: row.channel_id,
            serverId,
            avatarText: row.author_avatar,
            avatarColor: row.author_color,
          });
          // 2. Channel + server sidebar highlight
          useUnreadStore
            .getState()
            .markChannelUnread(row.channel_id, true);
          if (serverId) {
            useUnreadStore.getState().markServerMention(serverId);
             
            console.log(
              "[mention-watch] markServerMention →",
              serverId,
              "store after:",
              useUnreadStore.getState().serverMentions,
            );
          } else {
             
            console.warn(
              "[mention-watch] serverId could not be resolved for channel_id",
              row.channel_id,
            );
          }
          // 3. Sound + OS popup
          void notifyMention({
            title: fullTitle,
            body: content.slice(0, 120),
          });
    };
    try {
      watchRef = db.collection("messages").watch({
        onChange: (snapshot: any) => {
          const changes = (snapshot.docChanges || []) as Array<{ dataType?: string; doc?: DbMessage }>;
          for (const change of changes) {
            if (change.dataType !== "add") continue;
            handleDoc(change.doc as DbMessage | undefined);
          }
        },
        onError: () => {},
      });
    } catch {
      // Fallback: keep the supabase channel as backup
      supabase
        .channel(`mentions-watch-fallback:${userId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => handleDoc(payload.new as DbMessage | undefined),
        )
        .subscribe();
    }

    return () => {
      try { watchRef?.close(); } catch { /* ignore */ }
    };
  }, [userId, username]);

  return null;
}
