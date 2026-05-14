"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import { usePresenceStatus, type EffectiveStatus } from "@/lib/presence-status";
import { detectDeviceType, type DeviceType } from "@/lib/device-type";
import { useActivityStore } from "@/lib/activity-store";
import { useVoice } from "@/lib/voice-store";

export type PresenceUser = {
  user_id: string;
  username: string;
  avatar: string;
  avatar_color: string;
  /** Uploaded avatar image (data URL or http URL); null/absent = letter tile. */
  avatar_url?: string | null;
  /** "online" | "away". Old rows without this field default to "online". */
  status?: EffectiveStatus;
  /**
   * Device type this row was tracked from. "web" = PC browser, "app" =
   * mobile PWA / wrapped app. Shown as a small phone overlay on the
   * avatar when device_type === "app".
   */
  device_type?: DeviceType;
  /**
   * Free-form activity label: e.g. "正在玩三角洲行动", "正在听音乐 —
   * 夜曲". Empty string / undefined = no activity to show. The game
   * client or user (via UserPanel) sets this; we broadcast it verbatim.
   */
  activity?: string;
  /**
   * Which server the user currently has open. Set by whoever mounts the
   * MemberList (passes `room` → `currentServerId`). Used by official-server
   * member panels to show only users currently viewing that server.
   */
  current_server_id?: string;
  /**
   * If the user is currently connected to a voice/stream channel, this
   * is its channel id (matches Channel.id from mock-data) and server id.
   * Used by the channel sidebar to render real occupants beneath each
   * voice channel.
   */
  voice_channel_id?: string | null;
  voice_server_id?: string | null;
  online_at: string;
};

/**
 * Subscribes to a Supabase Realtime Presence channel and returns the list of
 * users currently connected. The current user automatically joins/leaves on
 * mount/unmount.
 *
 * Pass a stable `room` id (e.g. server id) to scope presence per server.
 */
// ---------------------------------------------------------------------------
// Module-level shared channel pool.
//
// Without this, every component that called usePresence() spun up its own
// CloudBase channel + heartbeat row. With ~9 active call sites in the app,
// each user ended up with 5-9 phantom presence rows, each with an
// independent 12s heartbeat. The server-side TTL sweeper would GC some
// rows out from under us, the orphaned heartbeats would self-heal by
// re-adding, and the cycle repeated forever — observable as the
// "[cb-rt] heartbeat: row X no longer exists, will re-add" log spam plus
// 5-9× the realtime write traffic.
//
// The pool keys on (userId, room) so any number of components can mount
// usePresence() and they all share one channel + one heartbeat row.
// ---------------------------------------------------------------------------

type SharedPresence = {
  channel: ReturnType<typeof supabase.channel>;
  refCount: number;
  // Latest sync'd user list, broadcast to every consumer's setUsers.
  lastUsers: PresenceUser[];
  listeners: Set<(users: PresenceUser[]) => void>;
  subscribed: boolean;
  // Latest in-flight payload for the debounced track. Last writer wins
  // across consumers — that matches the previous per-channel behaviour
  // and is correct because each consumer with a different
  // currentServerId is racing for the same single row anyway.
  pendingPayload: PresenceUser | null;
  trackTimer: ReturnType<typeof setTimeout> | null;
  // Deferred teardown handle. When the last consumer unsubscribes we
  // wait a short grace period before actually closing the channel —
  // this absorbs React's Strict-Mode double-mount (mount → cleanup →
  // mount) and tab-switches between sibling components, both of
  // which would otherwise destroy and immediately rebuild the
  // channel, throwing away any sync data we'd already received.
  teardownTimer: ReturnType<typeof setTimeout> | null;
};

const presencePool = new Map<string, SharedPresence>();
const POOL_TEARDOWN_DELAY_MS = 200;

function poolKey(userId: string, room: string): string {
  return `${userId}::${room}`;
}

function publish(shared: SharedPresence) {
  for (const fn of shared.listeners) fn(shared.lastUsers);
}

export function usePresence(
  room: string = "global",
  currentServerId?: string,
  /** When true, this instance keeps the pool alive and receives updates
   *  but does NOT call track() — it won't overwrite current_server_id
   *  with null when it doesn't know the active server.
   *  Used by AuthBootstrap which is always mounted but has no server context. */
  passive = false,
): PresenceUser[] {
  const { user } = useAuth();
  const effectiveStatus = usePresenceStatus((s) => s.effective);
  const activity = useActivityStore((s) => s.activity);
  const voiceCurrent = useVoice((s) => s.current);
  const [users, setUsers] = useState<PresenceUser[]>([]);

  // Stable ref to setUsers so we can safely register/deregister with
  // the shared pool's listener set across renders.
  const listenerRef = useRef<(u: PresenceUser[]) => void>(() => {});
  listenerRef.current = setUsers;

  // Track the previous voice channel AND server so Effect #2 can
  // detect transition events and flush IMMEDIATELY instead of riding
  // the 500ms debounce. Server-switch is a discrete user action that
  // should be as instant as a voice join/leave.
  const prevVoiceChannelRef = useRef<string | null>(
    voiceCurrent?.channelId ?? null,
  );
  const prevServerIdRef = useRef<string | undefined>(currentServerId);

  // ----- Effect #1: join the shared pool exactly once per (user, room).
  useEffect(() => {
    if (!user) return;
    const key = poolKey(user.id, room);
    let shared = presencePool.get(key);
    const listener = (u: PresenceUser[]) => listenerRef.current(u);

    if (!shared) {
      const channel = supabase.channel(`presence:${room}`, {
        config: { presence: { key: user.id } },
      });
      shared = {
        channel,
        refCount: 0,
        lastUsers: [],
        listeners: new Set(),
        subscribed: false,
        pendingPayload: null,
        trackTimer: null,
        teardownTimer: null,
      };
      presencePool.set(key, shared);

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<PresenceUser>();
          const flat: PresenceUser[] = Object.values(state)
            .map((arr) => arr[arr.length - 1])
            .filter(Boolean);
          const seen = new Set<string>();
          const unique = flat.filter((u) => {
            if (seen.has(u.user_id)) return false;
            seen.add(u.user_id);
            return true;
          });
          // If self is not yet in the cloud state (track() still
          // in-flight) keep our optimistic self-row so the panel
          // doesn't blip empty.
          let next = unique;
          const me = user;
          if (me && !seen.has(me.id)) {
            const selfRow = shared!.lastUsers.find(
              (u) => u.user_id === me.id,
            );
            if (selfRow) next = [...unique, selfRow];
          }
          shared!.lastUsers = next;
          publish(shared!);
        })
        .subscribe((status) => {
          // eslint-disable-next-line no-console
          console.log(`[presence] subscribe status=${status} room=${room} uid=${user.id}`);
          if (status === "SUBSCRIBED") {
            shared!.subscribed = true;
            const deviceType = detectDeviceType();
            const initial: PresenceUser = {
              user_id: user.id,
              username: user.username,
              avatar: user.avatar,
              avatar_color: user.avatarColor,
              avatar_url: user.avatarUrl ?? null,
              status: usePresenceStatus.getState().effective,
              device_type: deviceType,
              activity: useActivityStore.getState().activity || undefined,
              current_server_id: currentServerId || undefined,
              voice_channel_id: useVoice.getState().current?.channelId ?? null,
              voice_server_id: useVoice.getState().current?.serverId ?? null,
              online_at: new Date().toISOString(),
            };
            // Optimistic self-inject so the local member list never
            // shows "无人在线" during the 1-3s sync round-trip.
            if (!shared!.lastUsers.some((u) => u.user_id === initial.user_id)) {
              shared!.lastUsers = [...shared!.lastUsers, initial];
              publish(shared!);
            }
            channel.track(initial).catch((e) => {
              // eslint-disable-next-line no-console
              console.error(`[presence] initial track FAILED room=${room}:`, e);
            });
          }
        });
    }

    // Cancel any deferred teardown — we're alive again before the
    // grace period elapsed. This is the Strict-Mode protection: when
    // React does mount → cleanup → mount within one tick, the
    // cleanup's setTimeout is still pending when the re-mount runs,
    // so we clear it and the channel survives unchanged.
    if (shared.teardownTimer != null) {
      clearTimeout(shared.teardownTimer);
      shared.teardownTimer = null;
    }
    shared.refCount += 1;
    shared.listeners.add(listener);
    // Hand the new consumer the current snapshot immediately.
    if (shared.lastUsers.length > 0) listener(shared.lastUsers);

    return () => {
      const s = presencePool.get(key);
      if (!s) return;
      s.listeners.delete(listener);
      s.refCount -= 1;
      if (s.refCount <= 0) {
        // Defer the actual close — see teardownTimer comment above.
        // If a sibling/strict-mode re-mount happens within the grace
        // window, the next consumer will cancel this timeout and the
        // channel stays alive.
        if (s.teardownTimer != null) clearTimeout(s.teardownTimer);
        s.teardownTimer = setTimeout(() => {
          const current = presencePool.get(key);
          if (!current || current.refCount > 0) return;
          if (current.trackTimer != null) {
            clearTimeout(current.trackTimer);
            current.trackTimer = null;
          }
          current.pendingPayload = null;
          current.subscribed = false;
          current.channel.unsubscribe();
          supabase.removeChannel(current.channel);
          presencePool.delete(key);
        }, POOL_TEARDOWN_DELAY_MS);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, room]);

  // ----- Effect #2: whenever broadcast-relevant state changes, re-track
  //                  via the shared channel. Debounced (last write wins).
  //                  Passive instances (e.g. AuthBootstrap) skip this so
  //                  they don't overwrite current_server_id with null.
  useEffect(() => {
    if (passive) return;
    if (!user) return;
    const shared = presencePool.get(poolKey(user.id, room));
    if (!shared || !shared.subscribed) return;
    const deviceType = detectDeviceType();
    const next: PresenceUser = {
      user_id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatar_color: user.avatarColor,
      avatar_url: user.avatarUrl ?? null,
      status: effectiveStatus,
      device_type: deviceType,
      activity: activity || undefined,
      current_server_id: currentServerId || undefined,
      voice_channel_id: voiceCurrent?.channelId ?? null,
      voice_server_id: voiceCurrent?.serverId ?? null,
      online_at: new Date().toISOString(),
    };
    // Voice transitions (join / leave / switch) are discrete user
    // actions that shouldn't ride the 500ms debounce — see the
    // prevVoiceChannelRef comment up top. Detect "this render's
    // voice channel differs from last render's" and flush
    // immediately. All other state changes (activity / effective
    // status / server hop) still pay the debounce so they don't
    // hammer the DB.
    const currentVoiceChannel = voiceCurrent?.channelId ?? null;
    const voiceTransition =
      currentVoiceChannel !== prevVoiceChannelRef.current;
    prevVoiceChannelRef.current = currentVoiceChannel;
    // Server switches (enter / leave an official or custom server)
    // are equally discrete — flush without debounce so other clients
    // see the change within one poll cycle instead of 500ms later.
    const serverTransition = currentServerId !== prevServerIdRef.current;
    prevServerIdRef.current = currentServerId;

    shared.pendingPayload = next;
    if (shared.trackTimer != null) clearTimeout(shared.trackTimer);
    const delay = (voiceTransition || serverTransition) ? 0 : 500;
    shared.trackTimer = setTimeout(() => {
      const s = presencePool.get(poolKey(user.id, room));
      if (!s) return;
      const payload = s.pendingPayload;
      s.pendingPayload = null;
      s.trackTimer = null;
      if (!payload) return;
      s.channel.track(payload).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[presence] re-track FAILED room=${room}:`, e);
      });
    }, delay);
  }, [
    passive,
    user,
    room,
    effectiveStatus,
    activity,
    currentServerId,
    voiceCurrent?.channelId,
    voiceCurrent?.serverId,
  ]);

  return users;
}
