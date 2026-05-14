"use client";

/**
 * Mount once at the app root. Keeps the local client's `mutes` state
 * fresh by:
 *   1. Fetching the latest mute row on mount / when the logged-in
 *      user changes.
 *   2. Subscribing to new `mutes` rows in realtime — a new mute for
 *      *us* instantly populates into `useMute`.
 *   3. Re-evaluating every 15 seconds so an expired mute naturally
 *      releases without requiring a page refresh.
 *
 * The composer / send path reads `useMute.isMutedNow()` to decide
 * whether to block outgoing messages. This watcher is the glue that
 * keeps that flag accurate over the session.
 */

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { supabase } from "@/lib/supabase";
import { useMute, type MuteRow } from "@/lib/mute-store";

export default function MuteWatcher() {
  const userId = useAuth((s) => s.user?.id ?? null);
  useEffect(() => {
    if (!userId) {
      useMute.getState().set(null);
      return;
    }
    // 1) Initial fetch.
    void useMute.getState().refresh(userId);

    // 2) Realtime push for freshly-issued mutes + revocation updates.
    //    CloudBase's realtime is not always reliable so the 5s poll
    //    below is the authoritative safety net, but realtime gives us
    //    sub-second UX when it does deliver.
    //
    //    INSERT — a new mute row for us. Adopt it if its expires_at is
    //    later than our current row (shorter overlapping mutes never
    //    shorten an existing longer one).
    //
    //    UPDATE — covers staff revocation. `revokeMutesFor` rewinds
    //    expires_at into the past (see mute-store.ts for why we
    //    expire-in-place instead of DELETE). When the watcher sees
    //    that, it drops the local active row immediately.
    const ch = supabase
      .channel(`mutes:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mutes",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = (payload.new || payload.old) as MuteRow | undefined;
          if (!row) return;
          const s = useMute.getState();
          const expired =
            !row.expires_at ||
            new Date(row.expires_at).getTime() <= Date.now();
          if (expired) {
            // Only clear if the tracked row IS this one (don't blow
            // away a different, still-active mute).
            if (s.active?.id === row.id) s.set(null);
            return;
          }
          // Still-active mute: adopt if it's the newest-expiring.
          const current = s.active;
          if (
            !current ||
            new Date(row.expires_at).getTime() >
              new Date(current.expires_at).getTime()
          ) {
            s.set(row);
          }
        },
      )
      .subscribe();

    // 3) Fixed 5s polling as a reliable fallback. Realtime (both the
    //    INSERT subscription above and the kick_signals "mute-changed"
    //    ping) delivers mute changes in < 1s most of the time, but
    //    CloudBase realtime occasionally drops events entirely, and
    //    the 60s cadence from the previous version meant "解除禁言"
    //    could take up to a minute to take effect. 5s keeps the
    //    worst-case under 5 seconds for anyone who lost their
    //    realtime channel, at a trivial query cost (one indexed
    //    lookup per client every 5s).
    // Polling fallback (every 15s). The realtime subscription above
    // is the primary path so this only catches dropped events.
    const tick = setInterval(() => {
      const s = useMute.getState();
      // Local expiry check first — cheap, avoids a network round trip.
      if (s.active && !s.isMutedNow()) s.set(null);
      void s.refresh(userId);
    }, 15_000);

    // 4) Refresh immediately when the user returns to the tab. They
    //    might have been muted/unmuted while the page was throttled
    //    in the background.
    const onVisible = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      void useMute.getState().refresh(userId);
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    return () => {
      clearInterval(tick);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
      supabase.removeChannel(ch);
    };
  }, [userId]);
  return null;
}
