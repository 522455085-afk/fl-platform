"use client";

/**
 * Offline message queue — persists outgoing messages to localStorage
 * when the network is down, and auto-flushes them in order when the
 * browser comes back online.
 *
 * Usage:
 *   const queue = useOfflineQueue();
 *   const ok = await queue.enqueue({ channel_id, author_id, ... });
 *   if (!ok) // message was queued for later delivery
 *
 * Visual integration:
 *   useOfflineQueue((s) => s.isOffline) → show banner
 *   useOfflineQueue((s) => s.pending) → count of queued messages
 */

import { create } from "zustand";
import { useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ============================================================
// Types
// ============================================================

export type QueuedMessage = {
  /** Local queue id (not the DB id). */
  qid: string;
  /** The optimistic temp id shown in the UI. */
  tempId: string;
  /** Channel key, e.g. "home:general" or "dm:a:b". */
  channelId: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  authorAvatar: string;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: string;
  /** Optional attachments JSON string. */
  attachments?: string;
  /** Optional priority. */
  priority?: string;
  /** Timestamp when the message was queued. */
  queuedAt: number;
  /** Number of delivery retries. */
  retries: number;
};

type Store = {
  /** Whether the browser currently reports offline. */
  isOffline: boolean;
  /** Number of items waiting in the queue. */
  pending: number;
  /** All queued messages (persisted in localStorage). */
  queue: QueuedMessage[];

  /** Enqueue a message for later delivery. Returns false if queued. */
  enqueue: (msg: Omit<QueuedMessage, "qid" | "queuedAt" | "retries">) => boolean;

  /** Remove a message from the queue (e.g. after successful delivery). */
  dequeue: (qid: string) => void;

  /** Attempt to flush all queued messages. Called automatically. */
  flush: () => Promise<void>;

  /** Internal: set online/offline status. */
  _setOnline: (v: boolean) => void;
  /** Internal: load persisted queue from localStorage. */
  _hydrate: () => void;
};

// ============================================================
// localStorage helpers
// ============================================================

const STORAGE_KEY = "fl_offline_queue";

function loadQueue(): QueuedMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* quota exceeded — should never happen with tiny message queues */
  }
}

// ============================================================
// Store
// ============================================================

export const useOfflineQueue = create<Store>()((set, get) => ({
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
  pending: 0,
  queue: [],

  _setOnline: (v: boolean) => {
    set({ isOffline: !v });
  },

  _hydrate: () => {
    const q = loadQueue();
    set({ queue: q, pending: q.length });
  },

  enqueue: (msg) => {
    const entry: QueuedMessage = {
      ...msg,
      qid: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      queuedAt: Date.now(),
      retries: 0,
    };
    const newQueue = [...get().queue, entry];
    saveQueue(newQueue);
    set({ queue: newQueue, pending: newQueue.length });
    return false; // return false = was queued (not sent)
  },

  dequeue: (qid: string) => {
    const newQueue = get().queue.filter((m) => m.qid !== qid);
    saveQueue(newQueue);
    set({ queue: newQueue, pending: newQueue.length });
  },

  flush: async () => {
    const queue = get().queue;
    if (queue.length === 0) return;

    // Process in order to preserve message sequence.
    const remaining: QueuedMessage[] = [];

    for (const msg of queue) {
      // Skip if too many retries.
      if (msg.retries >= 5) {
        console.warn("[offline-queue] dropping message after 5 retries:", msg.qid);
        continue;
      }

      try {
        const { error } = await supabase.from("messages").insert({
          channel_id: msg.channelId,
          author_id: msg.authorId,
          author_name: msg.authorName,
          author_color: msg.authorColor,
          author_avatar: msg.authorAvatar,
          author_avatar_url: msg.authorAvatarUrl,
          content: msg.content,
          created_at: msg.createdAt,
          ...(msg.attachments ? { attachments: msg.attachments } : {}),
          ...(msg.priority === "high" ? { priority: "high" } : {}),
        });

        if (error) {
          // Still offline or server error — keep in queue.
          remaining.push({ ...msg, retries: msg.retries + 1 });
        }
        // Success → message was delivered, don't re-queue.
      } catch {
        remaining.push({ ...msg, retries: msg.retries + 1 });
      }
    }

    saveQueue(remaining);
    set({ queue: remaining, pending: remaining.length });
  },
}));

// ============================================================
// React hook — auto-flush + auto-hydrate
// ============================================================

/**
 * Mount this once at the app root (in AuthBootstrap or layout).
 * It keeps the offline status in sync and flushes the queue
 * whenever the browser comes back online.
 */
export function useOfflineQueueBootstrap() {
  const setOnline = useOfflineQueue((s) => s._setOnline);
  const flush = useOfflineQueue((s) => s.flush);

  // Hydrate persisted queue on mount.
  useEffect(() => {
    useOfflineQueue.getState()._hydrate();
    useOfflineQueue.getState()._setOnline(navigator.onLine);
  }, []);

  // Listen for online/offline events.
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flush, setOnline]);
}

/**
 * Convenience hook: tries to send a message via supabase.
 * If the network is down, queues it for later delivery.
 *
 * Returns { inserted, error } matching the pattern ChatView already uses.
 */
export function useOfflineSend() {
  const enqueue = useOfflineQueue((s) => s.enqueue);
  const isOffline = useOfflineQueue((s) => s.isOffline);

  const sendWithOfflineFallback = useCallback(
    async (payload: {
      channel_id: string;
      author_id: string;
      author_name: string;
      author_color: string;
      author_avatar: string;
      author_avatar_url: string | null;
      content: string;
      created_at: string;
      attachments?: string;
      priority?: string;
      optimisticTempId: string;
    }): Promise<{
      data: { id: string; created_at: string } | null;
      error: { message: string } | null;
      queued: boolean;
    }> => {
      // Pre-flight: if navigator says offline, skip the network entirely.
      if (isOffline || !navigator.onLine) {
        enqueue("tempId" in payload
          ? {
              ...payload,
              channelId: payload.channel_id,
              authorId: payload.author_id,
              authorName: payload.author_name,
              authorColor: payload.author_color,
              authorAvatar: payload.author_avatar,
              authorAvatarUrl: payload.author_avatar_url,
              content: payload.content,
              createdAt: payload.created_at,
              tempId: payload.optimisticTempId,
            }
          : { ...payload, channelId: payload.channel_id, authorId: payload.author_id, content: payload.content, createdAt: payload.created_at } as any);
        return { data: null, error: null, queued: true };
      }

      const obj: Record<string, unknown> = {
        channel_id: payload.channel_id,
        author_id: payload.author_id,
        author_name: payload.author_name,
        author_color: payload.author_color,
        author_avatar: payload.author_avatar,
        author_avatar_url: payload.author_avatar_url,
        content: payload.content,
        created_at: payload.created_at,
      };
      if (payload.attachments) obj.attachments = payload.attachments;
      if (payload.priority === "high") obj.priority = "high";

      const { data, error } = await supabase
        .from("messages")
        .insert(obj)
        .select()
        .single();

      if (error && (
        error.message?.includes("fetch") ||
        error.message?.includes("Network") ||
        error.message?.includes("timeout") ||
        error.message?.includes("offline")
      )) {
        enqueue({
          ...payload,
          channelId: payload.channel_id,
          authorId: payload.author_id,
          authorName: payload.author_name,
          authorColor: payload.author_color,
          authorAvatar: payload.author_avatar,
          authorAvatarUrl: payload.author_avatar_url,
          content: payload.content,
          createdAt: payload.created_at,
          tempId: payload.optimisticTempId,
        });
        return { data: null, error: null, queued: true };
      }

      return {
        data: data as { id: string; created_at: string } | null,
        error: error ? { message: error.message } : null,
        queued: false,
      };
    },
    [enqueue, isOffline],
  );

  return sendWithOfflineFallback;
}
