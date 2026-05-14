"use client";

import { useEffect } from "react";
import { useAuthBootstrap, useAuth } from "@/lib/auth-store";
import { registerServiceWorker } from "@/lib/pwa-register";
import { useSocialBootstrap } from "@/lib/social-store";
import { useDmThreadsBootstrap } from "@/lib/dm-threads-store";
import { useServerRolesBootstrap } from "@/lib/server-roles-store";
import { useServersBootstrap } from "@/lib/servers-store";
import { usePresence } from "@/lib/use-presence";
import { usePresenceStatusBootstrap } from "@/lib/presence-status";
import { installActivityBridge } from "@/lib/activity-store";
import { useOfflineQueueBootstrap } from "@/lib/offline-queue-store";
import { db } from "@/lib/cloudbase";
import { claimSession, releaseSession, resetKickLatch } from "@/lib/sessions";

export default function AuthBootstrap() {
  useAuthBootstrap();
  useSocialBootstrap();
  useDmThreadsBootstrap();
  useServerRolesBootstrap();
  useServersBootstrap();
  usePresenceStatusBootstrap();
  useOfflineQueueBootstrap();
  // Install the global `window.__flSetActivity` bridge for the game
  // client. Safe to call every render — installActivityBridge is
  // idempotent and just overwrites the same function on window.
  useEffect(() => {
    installActivityBridge();
    // Register PWA Service Worker on client mount
    registerServiceWorker();
  }, []);
  // Suppress the native browser context menu site-wide. Components that need
  // a custom right-click menu (server icons, messages later, …) call
  // `e.preventDefault()` in their own onContextMenu and render their own
  // floating menu. Plain text selection is unaffected because we don't
  // touch the selectionchange / mouseup events.
  useEffect(() => {
    const block = (e: MouseEvent) => {
      // Allow right-click only on inputs/textareas/contenteditable so users
      // can still paste / spell-check inside text fields.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);
  // Keep a single always-on presence subscription scoped to the lifetime of
  // the entire app. Without this, the user vanishes from the online list as
  // soon as they leave a view that mounts MemberList (e.g. switching to DM
  // mode), even though they're still logged in and active.
  usePresence("global", undefined, true);

  // One-time global sweep of OUR expired presence rows on login. Each
  // RealtimeChannel only ever cleans the room it's subscribed to, so
  // rooms the user briefly visited (and never came back to) accumulate
  // stale rows forever. This sweep collects them all in one query and
  // best-effort deletes them. Runs once per session per user.
  const userId = useAuth((s) => s.user?.id);

  // On every userId transition (login or page-reload-with-existing-session),
  // claim our session slot. The login() handler already calls this for
  // fresh logins, but we ALSO need it when CloudBase auto-restores the
  // session on app boot (the user closed and reopened the tab without
  // logging out). Idempotent — calling claim twice with the same session
  // id just bumps last_seen.
  useEffect(() => {
    if (!userId) return;
    resetKickLatch();
    void claimSession(userId).catch((e) => {
      console.warn("[auth-bootstrap] claimSession failed:", e);
    });
    // Best-effort release on tab close. Mirrors the presence pagehide
    // logic; we don't use sendBeacon here because (a) the row is small
    // and the standard async DELETE usually flushes in time, and
    // (b) sessions don't have the same "appear online" race as presence.
    const onPageHide = () => {
      void releaseSession();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        // Stagger so it doesn't race with the channel mounts above.
        await new Promise((r) => setTimeout(r, 1500));
        if (cancelled) return;
        const now = Date.now();
        const res = await db
          .collection("presence")
          .where({ presence_key: userId })
          .limit(500)
          .get();
        const expired: Record<string, unknown>[] = (res?.data || []).filter(
          (d: Record<string, unknown>) =>
            ((d.expires_at as number) || 0) < now - 10_000,
        );
        if (expired.length === 0) return;
         
        console.log(
          `[presence] sweeping ${expired.length} stale rows for ${userId}`,
        );
        for (const d of expired) {
          if (cancelled) return;
          const id = (d._id as string) || (d.id as string);
          if (!id) continue;
          try {
            await db.collection("presence").doc(id).remove();
          } catch {
            /* ignore — not ours, or rule denied */
          }
        }
      } catch (e) {
         
        console.warn("[presence] global sweep failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return null;
}
