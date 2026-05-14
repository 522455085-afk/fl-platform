"use client";

import React from "react";
import { useVoiceRecorder } from "@/lib/voice-recorder";
import { Hash, Megaphone, Bell, Pin, Users, Search, Inbox, HelpCircle, Plus, Gift, Sticker, Smile, Send, Menu, AtSign, X, Lock, Pencil, Trash2, Image as ImageIcon, Loader2, Mic } from "lucide-react";
import Image from "next/image";
import { processImageFile, type ProcessImageResult } from "@/lib/avatar-upload";
import { type ChatAttachment } from "@/lib/supabase-types";
import { useNotifications } from "@/lib/notifications-store";
import {
  mergeRealtimeInsert,
  mergeOptimisticSwap,
} from "@/lib/message-merge";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { useSocial } from "@/lib/social-store";
import { useDmThreads } from "@/lib/dm-threads-store";
import { useReactions } from "@/lib/reactions-store";
import { usePresence } from "@/lib/use-presence";
import { useCanPostAnnouncement } from "@/lib/server-roles-store";
import { useAllServers, useServers } from "@/lib/servers-store";
import { adminDeleteMessage } from "@/lib/admin-actions";
import {
  useIsAdmin,
  canPinMessages,
  canPostHighPriority,
  canModerateServer,
  canDeleteOwnMessage,
  getStaffTier,
} from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit-log";
import StaffBadge, { staffNameClass } from "@/components/AdminBadge";
import { useMyMute, type MuteRow } from "@/lib/mute-store";
import { supabase, type DbMessage } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import MessageReactions from "@/components/MessageReactions";
import Avatar from "@/components/Avatar";
import MentionAutocomplete, { type MentionApi } from "@/components/MentionAutocomplete";
import InteractionMenu from "@/components/InteractionMenu";
import Tooltip from "@/components/Tooltip";
import { MessageListSkeleton } from "@/components/Skeleton";
import { displayUsername } from "@/lib/deleted-user";
import { useComposer, composerTextareaRef, composerImageInputRef, composerImageDropHandlerRef } from "@/lib/composer-store";
import { tryDeleteMentionBeforeCaret } from "@/lib/mention-backspace";
import MentionHighlightOverlay from "@/components/MentionHighlightOverlay";
import { confirm } from "@/lib/confirm-store";
import { logError } from "@/lib/error-log";

// Module-level caches that survive channel switches (components remount via key=).
// msgCache: channel_id → last-known messages, shown instantly on revisit.
// profileCache: user_id → avatar_url (null = no uploaded avatar).
const msgCache = new Map<string, UiMessage[]>();
const profileCache = new Map<string, string | null>();

// Prefetch a channel's messages on hover so they're ready when clicked.
const prefetchingIds = new Set<string>();
export function prefetchChannel(channelId: string) {
  if (!channelId || msgCache.has(channelId) || prefetchingIds.has(channelId)) return;
  prefetchingIds.add(channelId);
  const q = supabase
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(30);
  Promise.resolve(q).then(({ data }) => {
    prefetchingIds.delete(channelId);
    if (!data || data.length === 0) return;
    if (!msgCache.has(channelId)) {
      msgCache.set(channelId, (data as DbMessage[]).map(rowToUi).reverse());
    }
  }).catch((e) => {
    prefetchingIds.delete(channelId);
    logError('Database', 'Failed to prefetch channel messages', e);
  });
}

type DmPartner = {
  user_id: string;
  username: string;
  avatar: string;
  avatar_color: string;
  avatar_url?: string | null;
};

type Props = {
  channelId: string;
  channelName: string;
  showMembers: boolean;
  onToggleMembers: () => void;
  onOpenNav?: () => void;
  /** If set, render the header in DM mode with partner info + close button. */
  dmPartner?: DmPartner;
  onCloseDm?: () => void;
  /**
   * If true, this is an announcement-style channel — only admins can post,
   * everyone else gets a read-only banner instead of a composer. Reactions
   * still work for everyone.
   */
  announcement?: boolean;
  /**
   * Server id this channel belongs to. Used together with `announcement`
   * to look up the user's per-server role (creator / admin / member). DM
   * views leave it undefined.
   */
  serverId?: string;
  /** When set, clicking a message author's avatar / name opens the
   * floating profile card so the user can DM / friend / block them.
   * Wired up by the parent page (page.tsx). */
  onOpenProfileCard?: (
    seed: {
      user_id: string;
      username: string;
      avatar: string;
      avatar_color: string;
      avatar_url?: string | null;
    },
    anchor: { x: number; y: number },
  ) => void;
  /**
   * Preview / guest mode — the viewer isn't a member of this server yet.
   * Messages are read-only and the composer is replaced with a
   * "加入后可发送消息" banner. DM views always pass `false`.
   */
  guest?: boolean;
  /** Click handler for the inline 加入 button shown in guest mode. */
  onJoinServer?: () => void;
  /**
   * Channel-level readonly override:
   *   - undefined (default):
   *       text channels are open, announcement channels are admin-only.
   *   - true:
   *       explicitly locked — only admins/creators can post.
   *   - false:
   *       explicitly unlocked — members CAN post, even in announcement
   *       channels (admin override so a server can turn an announcement
   *       channel into a shared whiteboard).
   */
  readonlyChannel?: boolean;
  /** When true, render only the channel name as a single-line heading
   *  instead of the big avatar + flavour subtitle welcome banner.
   *  Used by the voice-channel right-side chat panel where the wide
   *  banner reads as noise. */
  compactWelcome?: boolean;
  /** When true, the channel header bar is not rendered. Used when the
   *  parent already provides a header (e.g. voice-channel split view). */
  hideHeader?: boolean;
};

type UiMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  avatar: string;
  avatarUrl?: string | null;
  content: string;
  timestamp: string;
  createdAt: number;
  /** Set when the message has been edited at least once. */
  editedAt?: number | null;
  /** Soft-deleted; renderer should show a placeholder. */
  isDeleted?: boolean;
  /** Pinned by an admin/moderator. */
  isPinned?: boolean;
  /** Unix-ms timestamp of when this was pinned (drives banner order). */
  pinnedAt?: number | null;
  /** Importance hint for announcement messages. */
  priority?: "normal" | "high";
  /** Parsed image attachments. */
  attachments?: ChatAttachment[];
  /** Offline queue: message is waiting for network to recover. */
  pending?: boolean;
};

function rowToUi(m: DbMessage): UiMessage {
  // Legacy rows may lack `created_at`; fall back to the CloudBase `_createTime`
  // auto-field if present, otherwise "now" so the timestamp at least renders
  // something readable instead of "NaN/NaN NaN:NaN".
  type WithCloudBaseMeta = DbMessage & { _createTime?: number | string };
  const withMeta = m as WithCloudBaseMeta;
  const rawTs = m.created_at || withMeta._createTime;
  const createdAt = rawTs ? new Date(rawTs).getTime() : Date.now();
  const editedAt = m.edited_at ? new Date(m.edited_at).getTime() : null;
  return {
    id: m.id,
    authorId: m.author_id,
    authorName: m.author_name,
    authorColor: m.author_color,
    avatar: m.author_avatar,
    avatarUrl: m.author_avatar_url ?? null,
    content: m.content,
    timestamp: formatTimestamp(createdAt),
    createdAt,
    editedAt,
    isDeleted: !!m.is_deleted,
    isPinned: !!m.is_pinned,
    pinnedAt: m.pinned_at ? new Date(m.pinned_at).getTime() : null,
    priority: m.priority === "high" ? "high" : "normal",
    attachments: m.attachments
      ? (() => { try { return JSON.parse(m.attachments as string) as ChatAttachment[]; } catch { return undefined; } })()
      : undefined,
  };
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `今天 ${hh}:${mm}`;
  const M = d.getMonth() + 1;
  const D = d.getDate();
  return `${M}/${D} ${hh}:${mm}`;
}

export default function ChatView(props: Props) {
  // Re-mount on channel change so we never need setState-in-effect for resets.
  return <ChatViewInner key={props.channelId} {...props} />;
}

function ChatViewInner({
  channelId,
  channelName,
  showMembers,
  onToggleMembers,
  onOpenNav,
  dmPartner,
  onCloseDm,
  announcement,
  serverId,
  onOpenProfileCard,
  guest,
  onJoinServer,
  readonlyChannel,
  compactWelcome,
  hideHeader,
}: Props) {
  const isDm = !!dmPartner;
  // Seed from cache so the channel feels instant on revisit.
  const [messages, setMessages] = useState<UiMessage[]>(
    () => msgCache.get(channelId) ?? [],
  );
  const [loading, setLoading] = useState(() => !msgCache.has(channelId));
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const isPrepending = useRef(false);
  const { draft, setDraft, setPlaceholder, setDisabled } = useComposer();
  const sendRef = useRef<(overrideText?: string) => void>(() => {});
  const [sendError, setSendError] = useState<string | null>(null);
  const { isRecording, duration: voiceDuration, start: startVoice, stop: stopVoice, cancel: cancelVoice } = useVoiceRecorder();
  const voiceBlobRef = useRef<Blob | null>(null);
  // Fresh-from-DB partner avatar — the dmPartner prop may have been
  // constructed from a stale source (a friendships row written before the
  // partner uploaded their avatar, an old dm_threads cache, or a presence
  // entry from the moment of opening). On mount we read profiles directly
  // so the DM header always shows the partner's *current* picture.
  const [partnerAvatarUrl, setPartnerAvatarUrl] = useState<string | null>(
    dmPartner?.avatar_url ?? null,
  );
  // Live author -> avatar_url map. Messages sent before we started writing
  // `author_avatar_url` (or sent by users who later changed their picture)
  // need a way to display the current image. We bulk-load profiles for
  // every author in the visible window and merge that result with whatever
  // each message row carried with it. The map is keyed by author_id.
  const [authorAvatars, setAuthorAvatars] = useState<Record<string, string | null>>({});
  const { user } = useAuth();
  const canPostAnnouncement = useCanPostAnnouncement(serverId || "");
  // Three-tier moderation gates, derived from the current user's staff
  // tier and the channel's server context:
  //   • canModerateHere   — can delete anyone's message here? Mods have
  //                         this in the official server; admin/founder
  //                         have it everywhere.
  //   • canPin            — pin/unpin a message (admin/founder only).
  //   • canPostHigh       — send "high priority" announcements (admin+).
  //   • canRemoveOwn      — delete/undo your own message. Regular players
  //                         cannot — messages are permanent once sent.
  const isPlatformAdmin = useIsAdmin(); // kept for legacy audit call-sites
  const canModerateHere = canModerateServer(user?.id, serverId);
  const canPin = canPinMessages(user?.id);
  const canPostHigh = canPostHighPriority(user?.id);
  // Look up the server for this channel so the welcome splash can show
  // the actual guild icon instead of a generic "#" tile.
  const allServers = useAllServers();
  const server = serverId
    ? allServers.find((s) => s.id === serverId)
    : undefined;
  const blockedIds = useSocial((s) => s.blockedIds);
  const touchThread = useDmThreads((s) => s.touch);
  const markThreadRead = useDmThreads((s) => s.markRead);
  const loadReactions = useReactions((s) => s.loadForMessages);
  // Online status of the DM partner — drives the grey-out / "在线" badge
  // on the DM avatars. We piggyback on the global presence room so we
  // don't need per-DM presence channels.
  // Pass serverId so this client broadcasts current_server_id — prevents
  // ChatView from overwriting MemberList's current_server_id tracking.
  const presenceUsers = usePresence("global", serverId || undefined);
  // Memoised so MessageRow doesn't see a fresh array/Set every
  // render (which used to cascade into a full re-render of every
  // message on each presence heartbeat — the actual cause of the
  // "进入服务器很卡" report). Deps cover only the inputs that
  // can change the contents.
  const mentionCandidates = useMemo(() => {
    if (isDm) {
      return presenceUsers.filter(
        (u) => u.user_id === dmPartner?.user_id,
      );
    }
    if (serverId) {
      return presenceUsers.filter(
        (u) => u.current_server_id === serverId,
      );
    }
    return [];
  }, [presenceUsers, isDm, dmPartner?.user_id, serverId]);
  const validMentionNames = useMemo(
    () => new Set(mentionCandidates.map((u) => u.username)),
    [mentionCandidates],
  );
  const partnerPresence = dmPartner
    ? presenceUsers.find((p) => p.user_id === dmPartner.user_id)
    : undefined;
  const partnerStatus: "online" | "away" | "offline" = !partnerPresence
    ? "offline"
    : partnerPresence.status === "away"
      ? "away"
      : "online";
  const partnerOnline = partnerStatus !== "offline";
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Caret position in the composer textarea — needed by the @mention
  // autocomplete to detect the active "@token" under the cursor.
  const [composerCaret, setComposerCaret] = useState(0);
  const mentionApiRef = useRef<MentionApi | null>(null);

  const [searchQuery, setSearchQuery] = useState("");

  // In an announcement channel, only the server's creator / admins (or
  // platform admins for official servers) can post. Everyone else gets the
  // read-only banner below.
  // Composer is locked for: (a) announcement channels when the viewer
  // isn't an admin, and (b) preview mode for non-members (`guest`). The
  // banner rendered below branches on which reason applies so the user
  // gets the right call-to-action (加入 vs. read reactions).
  // Active mute (if any) on the current user. Disables composer and
  // surfaces a banner explaining who muted them and why.
  const myMute: MuteRow | null = useMyMute();
  // Default-locked semantics:
  //   announcement channels are admin-only BY DEFAULT, but an admin can
  //   pass readonly=false through the settings modal to explicitly unlock
  //   the channel for every member. Text channels default to open and can
  //   be opt-in locked via readonly=true.
  const isChannelLocked = announcement
    ? readonlyChannel !== false // undefined (default) or true ⇒ locked
    : readonlyChannel === true;
  const composerDisabled =
    (isChannelLocked && !canPostAnnouncement) ||
    !!guest || !!myMute;
  // Mirror to a ref so event handlers (fl:mention, fl:send-text)
  // can short-circuit without re-binding every render.
  const composerDisabledRef = useRef(composerDisabled);
  composerDisabledRef.current = composerDisabled;

  // Admins posting into an announcement channel may mark messages as
  // "high priority" — triggers a site-wide toast for everyone online.
  // Gate: must be (a) announcement channel AND (b) user is a platform
  // admin. (`canPostAnnouncement` subsumes the admin check on official
  // servers but not on user-created servers, so we check both.)
  // Gate on top of (a) announcement channel + (b) admin: ONLY
  // official servers can do site-wide push. User-created guilds are
  // capped at their own member base (the "channel red dot + unread"
  // path still works for them), so showing "全站推送" there would
  // mislead — there's no global broadcast for those.
  const canSetPriorityHere =
    !!announcement &&
    canPostAnnouncement &&
    canPostHigh &&
    server?.is_official === true;
  const setCanSetPriority = useComposer((s) => s.setCanSetPriority);
  const setPriority = useComposer((s) => s.setPriority);
  useEffect(() => {
    setCanSetPriority(canSetPriorityHere);
    // Reset priority whenever the eligibility toggles off — prevents a
    // stale "high" flag from leaking into a non-announcement channel.
    if (!canSetPriorityHere) setPriority("normal");
    return () => {
      setCanSetPriority(false);
      setPriority("normal");
    };
  }, [canSetPriorityHere, setCanSetPriority, setPriority]);

  // Hide messages from blocked authors. Recompute only when set or messages change.
  const visibleMessages = useMemo(() => {
    if (blockedIds.length === 0) return messages;
    const set = new Set(blockedIds);
    return messages.filter((m) => !set.has(m.authorId));
  }, [messages, blockedIds]);
  const blockedCount = messages.length - visibleMessages.length;

  // Union of currently-online roster usernames and authors who have
  // posted in the visible scrollback. This is the whitelist used by
  // renderContent to decide whether a typed `@xxx` is rendered as a
  // real (blue, clickable) mention or just plain text. Without
  // unioning author names a legitimately-mentioned user who has
  // since gone offline would lose their blue highlight on every
  // scrollback render.
  const messageMentionNames = useMemo(() => {
    const s = new Set<string>();
    for (const u of mentionCandidates) s.add(u.username);
    for (const m of visibleMessages) {
      if (m.authorName) s.add(m.authorName);
    }
    return s;
  }, [mentionCandidates, visibleMessages]);

  const searchedMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleMessages;
    return visibleMessages.filter(
      (m) => !m.isDeleted && m.content.toLowerCase().includes(q),
    );
  }, [visibleMessages, searchQuery]);

  // Keep fresh refs so the subscription callback (dep: channelId only)
  // always sees the latest dmPartner / user without re-subscribing.
  const dmPartnerRef = useRef(dmPartner);
  useEffect(() => { dmPartnerRef.current = dmPartner; }, [dmPartner]);

  // Load history + subscribe to realtime
  useEffect(() => {
    let mounted = true;

    // On channelId change, immediately re-seed UI from cache for the
    // NEW channel. Without this, the messages state still contains the
    // previous channel's content until the async fetch resolves —
    // observable as a "wrong messages flash" when hopping between
    // active channels and a confusing "blank → suddenly populated"
    // moment when entering an unvisited channel.
    const cached = msgCache.get(channelId);
    setMessages(cached ?? []);
    setLoading(!cached);
    setSendError(null);

    // Build the realtime channel first (subscribe() starts the 800 ms poll
    // timer). We then seed its knownTableIds from the history fetch so the
    // FIRST poll cycle treats everything already on-screen as "old" and only
    // surfaces truly new rows — eliminating the 800 ms blind-spot where a
    // message arriving during the seed phase would be silently swallowed.
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (!mounted) return;
          const ui = rowToUi(payload.new as DbMessage);
          setMessages((prev) => mergeRealtimeInsert(prev, ui));
          // Use refs / store getState so we never read a stale closure.
          const currentUser = useAuth.getState().user;
          const currentPartner = dmPartnerRef.current;
          // If this DM message is from the partner and we're actively viewing,
          // immediately clear unread on our side.
          if (currentPartner && currentUser && ui.authorId === currentPartner.user_id) {
            markThreadRead(currentPartner.user_id);
          }
          // @mention detection lives in <MentionWatcher /> at the
          // root level so we get notifications across ALL channels
          // (not just the one currently open). Don't duplicate it
          // here — otherwise the active channel double-fires.
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          // Propagate edits + soft-deletes from other tabs/users so the
          // local row updates without needing a refresh. We replace the
          // matching row by id; if we don't have it (e.g. the row scrolled
          // off our window), we just ignore.
          if (!mounted) return;
          const ui = rowToUi(payload.new as DbMessage);
          setMessages((prev) =>
            prev.map((m) => (m.id === ui.id ? ui : m)),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          // Hard delete from another tab/user — remove the row locally.
          // payload.old contains the deleted row's columns; we only need
          // the id to drop it from our list.
          if (!mounted) return;
          const oldRow = payload.old as { id?: string } | undefined;
          if (!oldRow?.id) return;
          setMessages((prev) => prev.filter((m) => m.id !== oldRow.id));
        },
      )
      .subscribe();

    // Fetch history after subscribe() so we can immediately seed the
    // channel's knownTableIds. This way the very first poll (800 ms out)
    // looks for messages that arrived AFTER our snapshot, not re-seeds.
    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      // Fetch the LATEST 50 messages (desc + limit), then reverse the
      // array so the UI still renders oldest→newest top-to-bottom. The
      // earlier ascending+limit query was returning the OLDEST 50 — for
      // channels with >50 historical messages the user would see ancient
      // history and never reach recent posts.
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.warn("[messages] load failed:", error);
        }
        const ui: UiMessage[] = (data || []).map(rowToUi).reverse();
        msgCache.set(channelId, ui);
        setMessages(ui);
        setHasMore(ui.length >= 30);
        setLoading(false);
        if (ui.length > 0) {
          void loadReactions(ui.map((m) => m.id));
          // Seed the channel so the poll immediately tracks new rows.
          channel.seedIds(ui.map((m) => m.id));
        }
      });

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Listen for @ mention events dispatched by the MemberList right-click menu.
  // Bail when the composer is locked (announcement-only channel, mute, guest)
  // — otherwise right-clicking "@他" in a read-only channel still pushed the
  // mention into the draft store and showed it in the desktop bottom bar,
  // which users perceived as a broken UI state. (user-reported bug)
  useEffect(() => {
    const handler = (e: Event) => {
      if (composerDisabledRef.current) return;
      const { username } = (e as CustomEvent<{ username: string }>).detail;
      setDraft((d) => (d ? `${d} @${username} ` : `@${username} `));
      setTimeout(() => (composerTextareaRef.current ?? textareaRef.current)?.focus(), 0);
    };
    document.addEventListener("fl:mention", handler);
    return () => document.removeEventListener("fl:mention", handler);
  }, [setDraft]);

  useEffect(() => {
    setPlaceholder(
      isDm
        ? `发消息给 ${dmPartner?.username ?? "对方"}`
        : `发消息到 #${channelName}`,
    );
  }, [isDm, dmPartner?.username, channelName, setPlaceholder]);

  useEffect(() => {
    // Reason ordering matters — composer-store consumes this string to
    // pick the right placeholder/banner. Mute is the most specific so
    // it wins over announcement/guest restrictions.
    const reason = myMute
      ? "muted"
      : guest
        ? "guest"
        : composerDisabled
          ? "announcement"
          : null;
    setDisabled(composerDisabled, reason);
  }, [composerDisabled, guest, myMute, setDisabled]);

  useEffect(() => {
    const handler = () => {
      if (composerDisabledRef.current) return;
      sendRef.current();
    };
    const textHandler = (e: Event) => {
      if (composerDisabledRef.current) return;
      const detail = (e as CustomEvent<{ text?: string }>).detail;
      const text = detail?.text;
      if (typeof text === "string" && text.length > 0) {
        sendRef.current(text);
      }
    };
    document.addEventListener("fl:send", handler);
    document.addEventListener("fl:send-text", textHandler);
    return () => {
      document.removeEventListener("fl:send", handler);
      document.removeEventListener("fl:send-text", textHandler);
    };
  }, []);

  // Fetch the partner's current avatar_url when entering a DM. Cheap
  // single-row read; runs once per partner. Done independently of the
  // messages effect so it doesn't get retorn down on unrelated rerenders.
  useEffect(() => {
    if (!dmPartner?.user_id) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", dmPartner.user_id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const profile = data as { avatar_url?: string | null } | null;
        const url = profile?.avatar_url ?? null;
        setPartnerAvatarUrl(url);
      });
    return () => {
      cancelled = true;
    };
  }, [dmPartner?.user_id]);

  // Bulk-resolve avatar_url for every distinct message author. Messages
  // saved before `author_avatar_url` was a column won't have a URL on the
  // row itself, and even messages that did save it can drift if the author
  // later changes their picture. We fetch each author's profile once and
  // overlay the result on top of the row data when we render.
  useEffect(() => {
    const need = new Set<string>();
    for (const m of messages) {
      if (!m.authorId) continue;
      if (authorAvatars[m.authorId] !== undefined) continue;
      need.add(m.authorId);
    }
    if (need.size === 0) return;
    let cancelled = false;
    (async () => {
      // Split into already-cached vs needs-fetch. Then do ONE batch query
      // for all uncached ids instead of N parallel single-row fetches —
      // reduces CloudBase round-trips from N to 1.
      const fromCache: [string, string | null][] = [];
      const toFetch: string[] = [];
      for (const authorId of need) {
        if (profileCache.has(authorId)) {
          fromCache.push([authorId, profileCache.get(authorId) ?? null]);
        } else {
          toFetch.push(authorId);
        }
      }
      let fromFetch: [string, string | null][] = [];
      if (toFetch.length > 0) {
        try {
          const { data } = await supabase
            .from("profiles")
            .select("id,avatar_url")
            .in("id", toFetch)
            .limit(toFetch.length);
          const profiles = (data || []) as Array<{ id: string; avatar_url: string | null }>;
          const byId = new Map<string, string | null>(profiles.map((p) => [p.id, p.avatar_url ?? null]));
          fromFetch = toFetch.map((id) => {
            const url = byId.get(id) ?? null;
            // Only cache real URLs — don't cache null so users who later
            // upload an avatar will show it without a page refresh.
            if (url) profileCache.set(id, url);
            return [id, url] as const;
          });
        } catch {
          // Don't cache on network error — allow retry on next render.
          fromFetch = toFetch.map((id) => [id, null] as const);
        }
      }
      if (!cancelled) {
        const next = Object.fromEntries([...fromCache, ...fromFetch]);
        setAuthorAvatars((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally exclude `authorAvatars` from deps — including it
    // would re-fire after every successful resolve. The Set diff above
    // already handles "what's left to fetch".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Periodic reaction refresh — pulls 👍/❤ updates from other users without
  // needing a watch on message_reactions (CloudBase watch quirks). 8 s.
  useEffect(() => {
    const ids = messages.map((m) => m.id);
    if (ids.length === 0) return;
    const id = setInterval(() => loadReactions(ids), 8_000);
    return () => clearInterval(id);
  }, [messages, loadReactions]);

  // On entering a DM, mark its thread as read (clears any backlog of unreads).
  useEffect(() => {
    if (!dmPartner || !user) return;
    markThreadRead(dmPartner.user_id);
  }, [dmPartner, user, markThreadRead]);

  // Auto-scroll on new messages — suppressed when we're prepending history
  // so the view doesn't jump to the bottom while the user reads old posts.
  useEffect(() => {
    if (isPrepending.current) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleMessages.length]);

  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    const oldest = messages[0];
    const cursor = new Date(oldest.createdAt).toISOString();
    setLoadingMore(true);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .lt("created_at", cursor)
      .order("created_at", { ascending: false })
      .limit(30);
    setLoadingMore(false);
    if (error) { console.warn("[messages] loadMore failed:", error); return; }
    const older = (data || []).map(rowToUi).reverse();
    if (older.length === 0) { setHasMore(false); return; }
    setHasMore(older.length >= 30);
    // Preserve scroll position: record height before prepend, restore after.
    const container = scrollRef.current;
    const prevHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;
    isPrepending.current = true;
    setMessages((prev) => {
      const ids = new Set(prev.map((m: UiMessage) => m.id));
      const fresh = older.filter((m: UiMessage) => !ids.has(m.id));
      return [...fresh, ...prev];
    });
    // After React paints the new rows, adjust scrollTop to keep the user
    // at the same visual position (new rows appeared above, not below).
    requestAnimationFrame(() => {
      if (container) {
        container.scrollTop = prevScrollTop + (container.scrollHeight - prevHeight);
      }
      isPrepending.current = false;
    });
    void loadReactions(older.map((m: UiMessage) => m.id));
  };

  /**
   * Edit own message. Updates the row in-place and sets `edited_at`.
   * We optimistically patch the local state so the user sees the change
   * immediately; on failure we roll back and surface a banner.
   */
  const editMessage = async (messageId: string, nextText: string) => {
    if (!user) return;
    const trimmed = nextText.trim();
    if (!trimmed) return;
    const prevSnapshot = messages.find((m) => m.id === messageId);
    if (!prevSnapshot) return;
    if (prevSnapshot.authorId !== user.id) return; // hard guard
    if (trimmed === prevSnapshot.content) return;

    const nowIso = new Date().toISOString();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? { ...m, content: trimmed, editedAt: Date.now() }
          : m,
      ),
    );
    setSendError(null);
    const { error } = await supabase
      .from("messages")
      .update({ content: trimmed, edited_at: nowIso })
      .eq("id", messageId);
    if (error) {
      // Roll back optimistic edit.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                content: prevSnapshot.content,
                editedAt: prevSnapshot.editedAt ?? null,
              }
            : m,
        ),
      );
      setSendError(`编辑失败：${error.message}`);
    }
  };

  /**
   * Soft-delete a message. Permission matrix:
   *   - Regular players CANNOT delete their own messages (by design —
   *     see canDeleteOwnMessage in @/lib/roles; rationale: permanence
   *     reduces drive-by edit-to-delete griefing).
   *   - Staff (founder/admin/mod) may delete their own messages.
   *   - Founder + admin may delete anyone's message in any server.
   *   - Mods may delete anyone's message inside the official server
   *     only (scoped via canModerateServer).
   */
  const deleteMessage = async (messageId: string) => {
    if (!user) return;
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;
    const isOwn = target.authorId === user.id;
    const allowed = isOwn
      ? canDeleteOwnMessage(target.authorId, user.id)
      : canModerateHere;
    if (!allowed) return;
    const isAdminAction = !isOwn;
    const deletePrompt = isAdminAction
      ? `主教删除「${target.authorName}」的这条消息？`
      : "确认删除这条消息？此操作无法撤销。";
    if (!(await confirm(deletePrompt))) return;
    const prevIndex = messages.findIndex((m) => m.id === messageId);
    const prevSnapshot = messages[prevIndex];
    // Hard delete: drop the row from DB and the local list outright.
    // Admin deletions go through the CloudBase Function (server-side
    // auth enforcement); own-message deletes go direct (allowed by
    // security rule: doc.author_id == auth.uid).
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    setSendError(null);
    try {
      if (isAdminAction) {
        await adminDeleteMessage(messageId);
      } else {
        const { error } = await supabase.from("messages").delete().eq("id", messageId);
        if (error) throw new Error(error.message);
      }
    } catch (err: unknown) {
      // Roll back the optimistic removal at its original position.
      setMessages((prev) => {
        const next = [...prev];
        const insertAt = Math.min(prevIndex, next.length);
        next.splice(insertAt, 0, prevSnapshot);
        return next;
      });
      setSendError(`删除失败：${(err as Error)?.message ?? String(err)}`);
      return;
    }
    // Audit: only record admin moderation actions (not self-deletes).
    if (target.authorId !== user.id && isPlatformAdmin) {
      recordAuditEvent({
        actor_id: user.id,
        actor_name: user.username,
        action: "delete_message",
        target_type: "message",
        target_id: messageId,
        target_label: `${target.authorName}: ${target.content}`,
      });
    }
  };

  /**
   * Toggle the `is_pinned` flag on a message. Platform admins only.
   * Optimistic: flip locally first, rollback if the DB write fails.
   *
   * A channel may have at most `PIN_LIMIT` pinned messages at once.
   * Pinning a 6th will refuse with a friendly hint to unpin first;
   * we'd rather force the moderator to make a deliberate choice than
   * silently demote whichever is "oldest".
   */
  const togglePin = async (messageId: string) => {
    if (!canPin) return;
    const target = messages.find((m) => m.id === messageId);
    if (!target) return;
    const nextPinned = !target.isPinned;
    if (nextPinned) {
      const PIN_LIMIT = 5;
      const currentlyPinned = messages.filter(
        (m) => m.isPinned && !m.isDeleted,
      ).length;
      if (currentlyPinned >= PIN_LIMIT) {
        setSendError(
          `本频道已有 ${PIN_LIMIT} 条置顶消息（上限），请先取消其中一条再试。`,
        );
        return;
      }
    }
    // togglePin is only invoked from a click handler, never during
    // render — the lint rule's heuristic flags it because the function
    // is defined during render.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              isPinned: nextPinned,
              pinnedAt: nextPinned ? nowMs : null,
            }
          : m,
      ),
    );
    const { error } = await supabase
      .from("messages")
      .update({
        is_pinned: nextPinned,
        // Stamp pinned_at on pin, clear on unpin so the banner naturally
        // re-orders after re-pin (most recent at top).
        pinned_at: nextPinned ? nowIso : null,
      })
      .eq("id", messageId);
    if (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, isPinned: !nextPinned } : m,
        ),
      );
      setSendError(`${nextPinned ? "置顶" : "取消置顶"}失败：${error.message}`);
      return;
    }
    if (user) {
      recordAuditEvent({
        actor_id: user.id,
        actor_name: user.username,
        action: nextPinned ? "pin_message" : "unpin_message",
        target_type: "message",
        target_id: messageId,
        target_label: `${target.authorName}: ${target.content}`,
      });
    }
  };

  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Expose to BottomBarComposer so the desktop + button can open the picker.
  useEffect(() => {
    composerImageInputRef.current = fileInputRef.current;
    return () => { composerImageInputRef.current = null; };
  });

  // Expose handleImagePick so external drop targets (the desktop bottom bar,
  // the document-level drop catcher) can route dropped images into the
  // active chat's pending-attachment slot. We re-bind on every render so
  // the closure always sees the latest draft / cursor.
  useEffect(() => {
    if (composerDisabled) {
      composerImageDropHandlerRef.current = null;
      return;
    }
    composerImageDropHandlerRef.current = (file: File) => {
      void handleImagePick(file);
    };
    return () => { composerImageDropHandlerRef.current = null; };
  });

  const handleImagePick = async (file: File) => {
    // Snapshot cursor position BEFORE the async work so the offset
    // reflects where the user was typing when they picked the file.
    const textOffset = textareaRef.current?.selectionStart ?? draft.length;
    setAttachLoading(true);
    const result: ProcessImageResult = await processImageFile(file);
    setAttachLoading(false);
    if (!result.ok) { setSendError(result.error); return; }
    setPendingAttachment({ type: "image", url: result.dataUrl, width: result.width, height: result.height, textOffset });
  };

  // Rate-limit state: track timestamps of last N sends in a module-level
  // ref so the closure always sees the current list without re-renders.
  const sendTimestamps = useRef<number[]>([]);
  const RATE_WINDOW_MS = 3_000;
  const RATE_MAX_MSGS  = 5;

  const send = async (overrideText?: string) => {
    if (composerDisabled) return;
    // `overrideText` lets callers (e.g. the interaction games menu)
    // post a pre-formatted message bypassing the textarea. When
    // provided we DO NOT clear `draft` — the user might have a real
    // message in progress that shouldn't be wiped by a side button.
    const isOverride = typeof overrideText === "string";
    const text = (isOverride ? overrideText : draft).trim();
    if (!text && !pendingAttachment || !user) return;

    // Rate-limit: drop sends that exceed RATE_MAX_MSGS in RATE_WINDOW_MS.
    const now = Date.now();
    sendTimestamps.current = sendTimestamps.current.filter(
      (t) => now - t < RATE_WINDOW_MS,
    );
    if (sendTimestamps.current.length >= RATE_MAX_MSGS) {
      setSendError("发送太频繁，请稍等片刻。");
      return;
    }
    sendTimestamps.current.push(now);

    setSendError(null);
    if (!isOverride) setDraft("");

    // Background readonly re-check (fire-and-forget). Local
    // server.channels refreshes every 60s + on focus, but an admin can
    // lock a channel from another tab in the meantime. Rather than
    // blocking the send (which added 200-1000ms of perceived input lag
    // on every keystroke-Enter), we let the optimistic insert + DB write
    // proceed in parallel and reconcile below if the check returns
    // "locked". Skip for DMs and for admins (announcement posters).
    const lockedCheckPromise: Promise<boolean> =
      serverId && !canPostAnnouncement
        ? (async () => {
            try {
              const { data } = await supabase
                .from("servers")
                .select("*")
                .eq("id", serverId)
                .limit(1);
              const row = ((data || [])[0] || {}) as {
                channels?: { channels: { id: string; type?: string; readonly?: boolean }[] }[];
              };
              if (!row.channels) return false;
              const localId = channelId.includes(":")
                ? channelId.split(":").slice(1).join(":")
                : channelId;
              const ch = row.channels
                .flatMap((c) => c.channels || [])
                .find((c) => c.id === localId);
              if (!ch) return false;
              return ch.type === "announcement"
                ? ch.readonly !== false
                : ch.readonly === true;
            } catch {
              return false;
            }
          })()
        : Promise.resolve(false);

    const nowIso = new Date().toISOString();
    // Optimistic insert: render the message in our own list immediately so
    // it doesn't feel laggy waiting for the watch/poll round-trip. We pick
    // a temp id; when the real INSERT comes back through the realtime
    // pipeline the de-dup in the messages effect will replace this row.
    const tempId = `__pending__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Override sends (e.g. dice / RPS / roll) never carry the
    // pending image attachment — that belongs to the real draft.
    const snapAttachment = isOverride ? null : pendingAttachment;
    if (!isOverride) setPendingAttachment(null);
    const optimistic: UiMessage = {
      id: tempId,
      authorId: user.id,
      authorName: user.username,
      authorColor: user.avatarColor,
      avatar: user.avatar,
      avatarUrl: user.avatarUrl ?? null,
      content: text,
      timestamp: formatTimestamp(Date.now()),
      createdAt: Date.now(),
      attachments: snapAttachment ? [snapAttachment] : undefined,
    };
    setMessages((prev) => [...prev, optimistic]);

    // Snapshot priority at send-time so a user can't race-toggle it after
    // clicking send. The store is reset to "normal" on success below.
    const priority = useComposer.getState().priority;
    // High-priority announcements auto-pin so they remain visible in the
    // pinned banner even after newer messages push them down. Admins can
    // still manually unpin later if they no longer want the banner.
    const autoPin = priority === "high";
    const { data: inserted, error } = await supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        author_id: user.id,
        author_name: user.username,
        author_color: user.avatarColor,
        author_avatar: user.avatar,
        author_avatar_url: user.avatarUrl ?? null,
        content: text,
        created_at: nowIso,
        ...(snapAttachment ? { attachments: JSON.stringify([snapAttachment]) } : {}),
        ...(priority === "high" ? { priority: "high" } : {}),
        ...(autoPin ? { is_pinned: true, pinned_at: nowIso } : {}),
      })
      .select()
      .single();

    if (error) {
      // Offline fallback: if it's a network error, queue the message
      // for later delivery instead of discarding it.
      const isNetworkError =
        error.message?.toLowerCase().includes("fetch") ||
        error.message?.toLowerCase().includes("network") ||
        error.message?.toLowerCase().includes("timeout") ||
        error.message?.toLowerCase().includes("offline") ||
        error.message?.toLowerCase().includes("abort") ||
        !navigator.onLine;

      if (isNetworkError) {
        try {
          const { useOfflineQueue } = await import("@/lib/offline-queue-store");
          useOfflineQueue.getState().enqueue({
            tempId,
            channelId,
            authorId: user.id,
            authorName: user.username,
            authorColor: user.avatarColor,
            authorAvatar: user.avatar,
            authorAvatarUrl: user.avatarUrl ?? null,
            content: text,
            createdAt: nowIso,
            attachments: snapAttachment ? JSON.stringify([snapAttachment]) : undefined,
            priority: priority === "high" ? "high" : undefined,
          });
          // Keep the optimistic message visible, but mark it as pending.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? { ...m, pending: true }
                : m,
            ),
          );
          setSendError("网络离线，消息已暂存，恢复后将自动发送。");
        } catch {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setSendError("离线队列出错，消息丢失。");
        }
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setSendError(error.message);
      }
      if (!isOverride) {
        setDraft(text);
        if (snapAttachment) setPendingAttachment(snapAttachment);
      }
      return;
    }

    // Swap the temp row for the real one (which has the canonical id).
    // Also dedupe: if the realtime INSERT handler already received this
    // row before our await resolved (common on fast connections), the
    // list already contains the real id — adding it via .map would
    // produce two rows with the same key and an avalanche of React
    // "duplicate key" warnings + reconcile churn (the actual cause of
    // the perceived 1-2s send lag for admins).
    if (inserted && (inserted as { id?: string }).id) {
      const realUi = rowToUi(inserted as DbMessage);
      setMessages((prev) => mergeOptimisticSwap(prev, tempId, realUi));
    }

    // Reconcile the parallel readonly-check. If the channel was locked
    // by an admin during this send, hard-delete the row and inform the
    // user. This is intentionally non-blocking — by the time we reach
    // here the message has already been inserted and rendered.
    void lockedCheckPromise.then(async (isLocked) => {
      if (!isLocked) return;
      const realId = (inserted as { id?: string } | null)?.id ?? tempId;
      setSendError("该频道已被管理员锁定，刚才的消息已撤回");
      setMessages((prev) => prev.filter((m) => m.id !== realId && m.id !== tempId));
      try {
        await supabase.from("messages").delete().eq("id", realId);
      } catch {
        // Best-effort cleanup; admins can also delete server-side.
      }
      void useServers.getState().refresh();
    });

    // Reset outgoing priority so the next message isn't accidentally sent
    // at "high" priority too. The toggle must be re-armed per message.
    if (priority === "high") {
      useComposer.getState().setPriority("normal");
      const realId =
        (inserted as { id?: string } | null)?.id ?? tempId;
      recordAuditEvent({
        actor_id: user.id,
        actor_name: user.username,
        action: "high_priority_post",
        target_type: "message",
        target_id: realId,
        target_label: text,
      });
    }

    // For DMs, maintain the thread index so both parties see the conversation
    // in their sidebar (and the partner gets +1 unread).
    if (dmPartner) {
      void touchThread({
        partner: {
          user_id: dmPartner.user_id,
          username: dmPartner.username,
          avatar: dmPartner.avatar,
          avatar_color: dmPartner.avatar_color,
          avatar_url: dmPartner.avatar_url ?? null,
        },
        preview: text,
        ts: new Date().toISOString(),
        incrementPartnerUnread: true,
      });
    }
  };

  // Keep the ref pointed at the freshest closure of `send` so the
  // page-level `fl:send` event always invokes the latest version.
  // This is intentionally executed during render — the lint rule
  // assumes refs are write-only outside of effects, but the value we
  // store is the function definition, not user-visible state.
  // eslint-disable-next-line react-hooks/refs
  sendRef.current = send;

  const {
    unreadCount: notifUnread,
    panelOpen: notifPanelOpen,
    items: notifItems,
    togglePanel: toggleNotifPanel,
    closePanel: closeNotifPanel,
    markAllRead,
    markRead: markNotifRead,
  } = useNotifications();

  // Outside-click close for the notification panel.
  // Skip clicks on the bell button (its own onClick already toggles)
  // and on anything inside the panel itself.
  const notifPanelRef = useRef<HTMLDivElement | null>(null);
  const notifBellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!notifPanelOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (notifPanelRef.current?.contains(t)) return;
      if (notifBellRef.current?.contains(t)) return;
      closeNotifPanel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [notifPanelOpen, closeNotifPanel]);

  return (
    <section
      className="flex-1 min-w-0 flex flex-col bg-[var(--bg-dark)] relative"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (composerDisabled) return;
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
        if (file) handleImagePick(file);
      }}
    >
      {/* Channel header */}
      {!hideHeader && <header className="h-14 px-4 flex items-center gap-3 border-b border-black/30 shadow-sm shrink-0">
        {onOpenNav && (
          <button
            onClick={onOpenNav}
            className="sm:hidden size-8 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            aria-label="打开频道列表"
          >
            <Menu size={20} />
          </button>
        )}
        {isDm && dmPartner ? (
          <>
            <Avatar
              text={dmPartner.avatar}
              color={dmPartner.avatar_color}
              url={partnerAvatarUrl ?? dmPartner.avatar_url}
              size={32}
              className={cn(!partnerOnline && "opacity-60 grayscale")}
            />
            <div className="flex items-center gap-1 min-w-0">
              <AtSign size={16} className="text-[var(--accent)] shrink-0" />
              <h2 className="font-semibold text-white truncate text-[18px]">
                {dmPartner.username}
              </h2>
              <span
                className={cn(
                  "hidden sm:inline text-[11px] ml-1",
                  partnerStatus === "online"
                    ? "text-[var(--success)]"
                    : partnerStatus === "away"
                      ? "text-[var(--warning)]"
                      : "text-[var(--text-muted)]",
                )}
              >
                ·{" "}
                {partnerStatus === "online"
                  ? "在线"
                  : partnerStatus === "away"
                    ? "离开"
                    : "离线"}
              </span>
            </div>
          </>
        ) : (
          <>
            {announcement ? (
              <Megaphone size={24} className="text-[var(--accent)]" />
            ) : (
              <Hash size={24} className="text-[var(--text-muted)]" />
            )}
            <h2 className="font-semibold text-white truncate text-[18px]">{channelName}</h2>
          </>
        )}
        <div className="ml-auto flex items-center gap-2 md:gap-3 text-[var(--text-muted)]">
          {isDm ? (
            <HeaderBtn
              icon={<X size={20} />}
              onClick={onCloseDm}
              className="text-[var(--text-muted)] hover:text-[var(--danger)]"
            />
          ) : (
            <>
              <div ref={notifBellRef} className="relative hidden md:block">
                <HeaderBtn
                  icon={<Bell size={20} />}
                  active={notifPanelOpen}
                  onClick={() => {
                    // Clear the red counter as soon as the bell is
                    // clicked — the act of opening the panel is
                    // acknowledgement enough that the user has
                    // "seen" the pending pings. Each notification
                    // row still retains its own per-row unread
                    // styling until clicked, so context isn't lost.
                    if (notifUnread > 0) markAllRead();
                    toggleNotifPanel();
                  }}
                />
                {notifUnread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-[var(--danger)] text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 pointer-events-none">
                    {notifUnread > 99 ? "99+" : notifUnread}
                  </span>
                )}
              </div>
              <HeaderBtn
                icon={<Users size={20} />}
                active={showMembers}
                onClick={onToggleMembers}
                className="hidden md:grid"
              />
              <div className="hidden md:flex items-center bg-[var(--bg-darkest)] rounded h-7 px-2 w-44 focus-within:w-56 transition-all">
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearchQuery("");
                      searchInputRef.current?.blur();
                    }
                  }}
                  placeholder="搜索"
                  className="flex-1 bg-transparent text-sm placeholder:text-[var(--text-muted)] focus:outline-none text-white min-w-0"
                />
                {searchQuery ? (
                  <>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0 mr-1">
                      {searchedMessages.length}
                    </span>
                    <button
                      onClick={() => setSearchQuery("")}
                      className="shrink-0 text-[var(--text-muted)] hover:text-white"
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <Search size={16} />
                )}
              </div>
            </>
          )}
        </div>
      </header>}

      {/* Pinned messages banner — collapsible. Admins pin via the per-row
          toolbar (Pin icon); all users see the banner so they can't miss
          important moderator announcements. */}
      <PinnedBanner messages={messages} />

      {/* Notification panel */}
      {notifPanelOpen && (
        <div
          ref={notifPanelRef}
          className="absolute top-12 right-0 w-80 max-w-[90vw] bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
        >
          <div className="px-4 py-2.5 border-b border-black/30 flex items-center justify-between shrink-0">
            <span className="font-semibold text-sm text-white">通知</span>
            {notifUnread > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] text-[var(--accent)] hover:underline"
              >
                全部已读
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-72 divide-y divide-[var(--bg-mid)]/40">
            {notifItems.length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--text-muted)]">暂无通知</div>
            ) : (
              notifItems.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markNotifRead(n.id);
                    if (n.kind === "dm" && n.partnerId) {
                      document.dispatchEvent(
                        new CustomEvent("fl:navigate-dm", {
                          detail: {
                            partnerId: n.partnerId,
                            partnerName: n.partnerName ?? "",
                            partnerAvatar: n.partnerAvatar ?? "",
                            partnerColor: n.partnerColor ?? "#888",
                            partnerAvatarUrl: n.partnerAvatarUrl ?? null,
                          },
                        }),
                      );
                      toggleNotifPanel();
                      return;
                    }
                    if (n.channelId) {
                       
                      console.log("[notif] navigate-channel dispatch", {
                        channelId: n.channelId,
                        serverId: n.serverId,
                      });
                      document.dispatchEvent(
                        new CustomEvent("fl:navigate-channel", {
                          detail: {
                            channelId: n.channelId,
                            serverId: n.serverId,
                          },
                        }),
                      );
                      toggleNotifPanel();
                    }
                  }}
                  className={cn(
                    "w-full px-4 py-3 text-left hover:bg-[var(--bg-mid)] transition-colors flex items-start gap-3",
                    !n.read && "bg-[var(--accent)]/5",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full mt-2 shrink-0",
                      n.read ? "bg-transparent" : "bg-[var(--accent)]",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-white truncate">{n.title}</div>
                    <div className="text-[12px] text-[var(--text-muted)] mt-0.5 line-clamp-2 break-words">{n.body}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1">{formatTimestamp(new Date(n.at).getTime())}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Search results banner */}
      {searchQuery && (
        <div className="px-4 py-1.5 text-[11px] text-[var(--text-muted)] bg-[var(--bg-mid)]/40 border-b border-black/20 shrink-0">
          {searchedMessages.length > 0
            ? <>搜索 <span className="text-white">&ldquo;{searchQuery}&rdquo;</span>，共 <span className="text-white">{searchedMessages.length}</span> 条结果</>
            : <>搜索 <span className="text-white">&ldquo;{searchQuery}&rdquo;</span> — 无匹配消息</>}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
        <div className="max-w-[900px] w-full">
        {/* Welcome splash: avatar LEFT, title + subtitle RIGHT. Was
            previously a vertical stack (avatar above, text below) —
            user asked to horizontalize it so the banner reads like a
            profile/header card rather than a portrait. `items-center`
            keeps everything vertically aligned relative to the
            avatar; `min-w-0` on the text column lets long names
            truncate instead of shoving the avatar off-screen.
            NOTE: in voice-channel context (the small ChatView pinned
            beside the voice grid) we render a slimmed-down variant —
            just the channel name as a single heading — because the
            big avatar + flavour subtitle reads as visual noise in the
            narrow column. The `compactWelcome` prop drives that. */}
        {compactWelcome ? (
          <div className="px-4 mb-4">
            <h1 className="text-xl font-bold text-[var(--text-bright)] truncate" style={{ fontFamily: '"Cinzel", "Noto Serif SC", serif' }}>
              {channelName}
            </h1>
          </div>
        ) : (
        <div className="px-4 mb-6 flex items-center gap-4">
          {isDm && dmPartner ? (
            <>
              <Avatar
                text={dmPartner.avatar}
                color={dmPartner.avatar_color}
                url={partnerAvatarUrl ?? dmPartner.avatar_url}
                size={80}
                className={cn(
                  "shrink-0 shadow-[0_0_30px_var(--accent-glow)] ring-2 ring-[var(--accent)]/40",
                  !partnerOnline && "opacity-60 grayscale",
                )}
              />
              <div className="min-w-0 flex-1">
                <h1 className="text-3xl font-bold text-[var(--text-bright)] mb-1 truncate" style={{ fontFamily: '"Cinzel", "Noto Serif SC", serif' }}>
                  {dmPartner.username}
                </h1>
                <p className="text-[var(--text-muted)] italic">
                  这是你与 <span className="text-[var(--accent)]">{dmPartner.username}</span> 的私密符文通讯。只有你们俩能看见。
                </p>
              </div>
            </>
          ) : (
            <>
              <Avatar
                text={server?.iconText ?? "#"}
                color={server?.iconColor ?? "var(--accent)"}
                url={server?.iconUrl}
                size={80}
                shape={server?.is_official ? "squircle" : "round"}
                className="shrink-0 shadow-[0_0_30px_var(--accent-glow)] ring-2 ring-[var(--accent)]/40"
              />
              <div className="min-w-0 flex-1">
                <h1 className="text-3xl font-bold text-[var(--text-bright)] mb-1 truncate" style={{ fontFamily: '"Cinzel", "Noto Serif SC", serif' }}>
                  {server?.name ?? channelName}
                </h1>
                {/* "之地" reads as a guild/server modifier, not a channel
                    one — bind to the server name so renaming the server
                    updates this line in lockstep with the title above. */}
                <p className="text-[var(--text-muted)] italic">这里是 <span className="text-[var(--accent)]">{server?.name ?? channelName}</span> 之地的回响</p>
              </div>
            </>
          )}
        </div>
        )}
        {/* Load more history button — shown when there are older messages */}
        {!loading && hasMore && (
          <div className="flex justify-center py-3">
            <button
              onClick={loadMoreMessages}
              disabled={loadingMore}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium border border-[var(--bg-mid)] text-[var(--text-muted)] hover:text-white hover:border-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {loadingMore ? (
                <><Loader2 size={13} className="animate-spin" />加载中…</>
              ) : (
                <>↑ 加载更多历史消息</>
              )}
            </button>
          </div>
        )}
        {loading && <MessageListSkeleton />}
        {!loading && visibleMessages.length === 0 && (
          <div className="px-4 text-sm text-[var(--text-muted)]">
            {blockedCount > 0
              ? `已隐藏 ${blockedCount} 条来自被屏蔽用户的消息`
              : "还没有消息，发条消息打个招呼吧 👋"}
          </div>
        )}
        {blockedCount > 0 && visibleMessages.length > 0 && (
          <div className="px-4 mb-2 text-[11px] text-[var(--text-muted)] italic">
            已隐藏 {blockedCount} 条来自被屏蔽用户的消息
          </div>
        )}
        {searchedMessages.map((msg, i) => {
          const prev = searchedMessages[i - 1];
          const grouped =
            prev && prev.authorId === msg.authorId && msg.createdAt - prev.createdAt < 5 * 60 * 1000;
          // Date separator: show when day changes between consecutive messages.
          const msgDay = new Date(msg.createdAt).toLocaleDateString("zh-CN", {
            year: "numeric", month: "2-digit", day: "2-digit",
          });
          const prevDay = prev
            ? new Date(prev.createdAt).toLocaleDateString("zh-CN", {
                year: "numeric", month: "2-digit", day: "2-digit",
              })
            : null;
          const showDateSep = !prevDay || prevDay !== msgDay;
          // Prefer the latest profile avatar_url we resolved over whatever
          // the row carried with it (which may be missing or stale).
          const liveUrl = authorAvatars[msg.authorId];
          const resolvedAvatarUrl =
            liveUrl !== undefined ? liveUrl : msg.avatarUrl ?? null;
          const isMine = msg.authorId === user?.id;
          return (
            <div key={msg.id}>
              {showDateSep && (
                <div className="flex items-center gap-3 px-4 my-3 select-none">
                  <div className="flex-1 h-px bg-[var(--bg-mid)]" />
                  <span className="text-[11px] text-[var(--text-muted)] shrink-0 font-medium">
                    {msgDay}
                  </span>
                  <div className="flex-1 h-px bg-[var(--bg-mid)]" />
                </div>
              )}
            <MessageRow
              msg={msg}
              grouped={!!grouped}
              avatarUrl={resolvedAvatarUrl}
              isMe={isMine}
              highlight={searchQuery || undefined}
              validMentionNames={messageMentionNames}
              // Edit: disabled platform-wide — sent messages are immutable.
              // (Soft-delete still allowed below for moderators.)
              canEdit={false}
              // Delete: self-delete requires staff (any tier);
              // cross-user delete requires moderation power for the
              // current server (admin/founder anywhere, mod in official).
              canDelete={
                !msg.isDeleted &&
                (isMine
                  ? canDeleteOwnMessage(msg.authorId, user?.id)
                  : canModerateHere)
              }
              // Pin: admin/founder only (mods explicitly excluded).
              canPin={canPin && !msg.isDeleted}
              onEdit={(text) => editMessage(msg.id, text)}
              onDelete={() => deleteMessage(msg.id)}
              onTogglePin={() => togglePin(msg.id)}
              onImageClick={(url) => setLightboxUrl(url)}
              onAuthorClick={
                onOpenProfileCard
                  ? (anchor) =>
                      onOpenProfileCard(
                        {
                          user_id: msg.authorId,
                          username: msg.authorName,
                          avatar: msg.avatar,
                          avatar_color: msg.authorColor,
                          avatar_url: resolvedAvatarUrl ?? null,
                        },
                        anchor,
                      )
                  : undefined
              }
              onMentionClick={
                onOpenProfileCard
                  ? async (username, anchor) => {
                      // 1) Online user in current presence list — instant.
                      const p = presenceUsers.find((u) => u.username === username);
                      if (p) {
                        onOpenProfileCard(
                          {
                            user_id: p.user_id,
                            username: p.username,
                            avatar: p.avatar,
                            avatar_color: p.avatar_color,
                            avatar_url: p.avatar_url ?? null,
                          },
                          anchor,
                        );
                        return;
                      }
                      // 2) Author of a visible recent message — instant.
                      const m = visibleMessages.find(
                        (v) => v.authorName === username,
                      );
                      if (m) {
                        onOpenProfileCard(
                          {
                            user_id: m.authorId,
                            username: m.authorName,
                            avatar: m.avatar,
                            avatar_color: m.authorColor,
                            avatar_url: m.avatarUrl ?? null,
                          },
                          anchor,
                        );
                        return;
                      }
                      // 3) Fallback: query CloudBase `profiles` by username.
                      // Covers offline users who haven't spoken in this
                      // channel — without this lookup the click was
                      // silently dropped (regression report).
                      try {
                        const { data, error } = await supabase
                          .from("profiles")
                          .select("id, username, avatar, avatar_color, avatar_url")
                          .eq("username", username)
                          .limit(1);
                        if (error || !data || data.length === 0) {
                          console.warn(
                            "[mention] no profile match for",
                            username,
                            error,
                          );
                          return;
                        }
                        const row = data[0] as {
                          id: string;
                          username: string;
                          avatar: string | null;
                          avatar_color: string | null;
                          avatar_url: string | null;
                        };
                        onOpenProfileCard(
                          {
                            user_id: row.id,
                            username: row.username,
                            avatar: row.avatar ?? row.username[0] ?? "?",
                            avatar_color: row.avatar_color ?? "var(--accent)",
                            avatar_url: row.avatar_url,
                          },
                          anchor,
                        );
                      } catch (e) {
                        console.warn("[mention] profile lookup failed:", e);
                      }
                    }
                  : undefined
              }
            />
            </div>
          );
        })}
        </div>
      </div>

      {/* Pending attachment preview — visible on ALL screen sizes so desktop users
          (who use the full-width BottomBarComposer) can also see / remove the queued image. */}
      {pendingAttachment && !composerDisabled && (
        <div className="hidden sm:flex px-4 pb-2 shrink-0 max-w-[900px] mx-auto w-full">
          <div className="relative inline-flex self-start max-h-28 max-w-xs">
            <Image
              src={pendingAttachment.url}
              alt="附件预览"
              fill
              className="rounded border border-[var(--bg-light)] object-contain"
              draggable={false}
            />
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-[var(--danger)] text-white grid place-items-center"
            >
              <X size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Composer — desktop uses the full-width bottom bar; this renders only on mobile */}
      <div className="sm:hidden">
      {composerDisabled ? (
        <div className="pb-6 pt-1 shrink-0 max-w-[900px] mx-auto">
          <div className="px-4">
          {/* Mute banner takes precedence over guest/announcement
              banners — the user wants to know WHY they're locked,
              and "you're muted" is more actionable than the others. */}
          {myMute ? (
            <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/40 rounded-lg px-4 py-3 flex items-start gap-3 text-sm">
              <Lock size={16} className="shrink-0 mt-0.5 text-[var(--warning)]" />
              <span className="flex-1 text-[var(--text-normal)]">
                ⛔ 你已被{" "}
                <span className="font-semibold">{myMute.muted_by_name}</span>{" "}
                禁言至{" "}
                <span className="font-semibold">
                  {new Date(myMute.expires_at).toLocaleString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "numeric",
                    day: "numeric",
                  })}
                </span>
                ，原因：{myMute.reason}
              </span>
            </div>
          ) : guest ? (
            <div className="bg-[var(--accent)]/10 border border-[var(--accent)]/40 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
              <Lock size={16} className="shrink-0 text-[var(--accent)]" />
              <span className="flex-1 text-[var(--text-normal)]">
                加入公会后即可在频道内发送消息、接收通知。
              </span>
              <button
                type="button"
                onClick={onJoinServer}
                className="h-8 px-4 rounded bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors shrink-0"
              >
                加入
              </button>
            </div>
          ) : readonlyChannel ? (
            <div className="bg-[var(--bg-mid)]/60 border border-[var(--bg-mid)] rounded-lg px-4 py-3 flex items-center gap-3 text-[var(--text-muted)] text-sm">
              <Lock size={16} className="shrink-0" />
              <span className="flex-1">此频道已被管理员设为只读模式，仅管理员可发布内容。</span>
            </div>
          ) : (
            <div className="bg-[var(--bg-mid)]/60 border border-[var(--bg-mid)] rounded-lg px-4 py-3 flex items-center gap-3 text-[var(--text-muted)] text-sm">
              <Lock size={16} className="shrink-0" />
              <span className="flex-1">
                你可以将光标悬停在消息上，点击 🙂₊ 添加表情反应。
              </span>
            </div>
          )}
          </div>
        </div>
      ) : (
      <div className="pb-6 pt-1 shrink-0 max-w-[900px] mx-auto">
        <div className="px-4">
        {/* Composer-on path: myMute is necessarily null here because
            it's part of the disabled gate above. */}
        {sendError && (
          <div className="mb-2 text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded p-2">
            发送失败：{sendError}
          </div>
        )}
        <div className="bg-[var(--bg-mid)] rounded-lg flex items-end px-3 py-2 gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImagePick(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            title="上传图片"
            disabled={attachLoading}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "size-7 grid place-items-center rounded-full transition-colors shrink-0 mb-0.5",
              attachLoading
                ? "bg-[var(--text-muted)] text-[var(--bg-mid)] opacity-50 cursor-wait"
                : "bg-[var(--text-muted)] text-[var(--bg-mid)] hover:bg-white",
            )}
          >
            {attachLoading ? <Plus size={20} className="animate-spin" /> : <Plus size={20} />}
          </button>
          <div className="flex-1 flex flex-col gap-1 min-w-0">
          {pendingAttachment && (
            <div className="relative inline-flex self-start max-h-32 max-w-xs">
              <Image
                src={pendingAttachment.url}
                alt="附件预览"
                fill
                className="rounded border border-[var(--bg-light)] object-contain"
                draggable={false}
              />
              <button
                type="button"
                onClick={() => setPendingAttachment(null)}
                className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-[var(--danger)] text-white grid place-items-center"
              >
                <X size={10} />
              </button>
            </div>
          )}
          <div className="relative w-full">
          <MentionAutocomplete
            value={draft}
            caret={composerCaret}
            candidates={mentionCandidates}
            selfId={user?.id}
            onCommit={(newValue, newCaret) => {
              setDraft(newValue);
              setComposerCaret(newCaret);
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (el) {
                  el.focus();
                  el.setSelectionRange(newCaret, newCaret);
                }
              });
            }}
            apiRef={mentionApiRef}
          />
          <div className="relative w-full">
          <MentionHighlightOverlay
            value={draft}
            validNames={validMentionNames}
            style={{
              padding: "0.375rem 0",
              fontSize: 15,
              lineHeight: "1.5",
              fontFamily: "inherit",
            }}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setComposerCaret(e.target.selectionStart ?? 0);
            }}
            onKeyDown={(e) => {
              if (mentionApiRef.current?.handleKeyDown(e)) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
                return;
              }
              if (e.key === "Backspace") {
                const ta = e.currentTarget;
                const r = tryDeleteMentionBeforeCaret(
                  ta.value,
                  ta.selectionStart ?? 0,
                  ta.selectionEnd ?? 0,
                );
                if (r) {
                  e.preventDefault();
                  setDraft(r.value);
                  setComposerCaret(r.caret);
                  requestAnimationFrame(() => {
                    try {
                      ta.setSelectionRange(r.caret, r.caret);
                    } catch { /* unmounted */ }
                  });
                }
              }
            }}
            onKeyUp={(e) => setComposerCaret(e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => setComposerCaret(e.currentTarget.selectionStart ?? 0)}
            onSelect={(e) => setComposerCaret(e.currentTarget.selectionStart ?? 0)}
            placeholder={`发消息到 #${channelName}`}
            rows={1}
            // text-transparent + caret-white lets the highlight
            // overlay show through while keeping the caret visible.
            className="relative w-full bg-transparent resize-none focus:outline-none py-1.5 text-[15px] text-transparent caret-white placeholder:text-[var(--text-muted)] max-h-40"
          />
          </div>
          </div>
          </div>
          <div className="flex items-center gap-3 text-[var(--text-muted)] mb-0.5">
            <Tooltip label="@提及成员">
              <button
                type="button"
                onClick={() => {
                  // Insert "@" at the textarea's current caret position
                  // (or the end if focus has been lost). Previously we
                  // appended unconditionally, which would push extra @'s
                  // to the END while the caret sat at the START — so
                  // each click visually "moved the typing position
                  // backward" relative to the new @'s.
                  const el = textareaRef.current;
                  const pos = el && document.activeElement === el
                    ? el.selectionStart ?? draft.length
                    : draft.length;
                  const next = draft.slice(0, pos) + "@" + draft.slice(pos);
                  setDraft(next);
                  const newCaret = pos + 1;
                  setComposerCaret(newCaret);
                  requestAnimationFrame(() => {
                    const t = textareaRef.current;
                    if (t) {
                      t.focus();
                      t.setSelectionRange(newCaret, newCaret);
                    }
                  });
                }}
                className="hover:text-white transition-colors"
              >
                <AtSign size={20} />
              </button>
            </Tooltip>
            <InteractionMenu
              disabled={composerDisabled}
              onPost={(text) => { void send(text); }}
            />
            <Tooltip label={isRecording ? `录音中 ${voiceDuration}s（松开发送）` : "按住录音"}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); void startVoice(); }}
                onMouseUp={async () => {
                  if (isRecording) {
                    const rec = await stopVoice();
                    voiceBlobRef.current = rec.blob;
                    // TODO: upload voice blob and send as message attachment
                    alert(`录音完成：${rec.duration}秒。语音上传功能即将上线。`);
                    voiceBlobRef.current = null;
                  }
                }}
                onMouseLeave={() => { if (isRecording) cancelVoice(); }}
                className={cn(
                  "transition-colors",
                  isRecording ? "text-red-500 animate-pulse" : "hover:text-white",
                )}
              >
                <Mic size={20} />
              </button>
            </Tooltip>
            <Tooltip label="礼物（即将上线）">
              <Gift size={20} className="hover:text-white cursor-pointer" />
            </Tooltip>
            <Tooltip label="贴纸（即将上线）">
              <Sticker size={20} className="hover:text-white cursor-pointer" />
            </Tooltip>
            <Tooltip label="表情（即将上线）">
              <Smile size={20} className="hover:text-white cursor-pointer" />
            </Tooltip>
            <Tooltip label="上传图片">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="hover:text-white transition-colors"
              >
                <ImageIcon size={20} />
              </button>
            </Tooltip>
            <Tooltip label="发送（Enter）">
              <button
                onClick={() => { void send(); }}
                disabled={!draft.trim() && !pendingAttachment}
                className={cn(
                  "size-7 grid place-items-center rounded transition-colors",
                  (draft.trim() || pendingAttachment) ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]" : "opacity-40 cursor-not-allowed",
                )}
              >
                <Send size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
        </div>
      </div>
      )}
      </div>

      {/* Lightbox — full-screen image preview with zoom + pan. */}
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}
    </section>
  );
}

/**
 * Full-screen image preview with mouse-wheel zoom (0.5×–5×), drag-to-pan
 * when zoomed in, double-click to toggle 1× ↔ 2×, backdrop / Esc / × button
 * to close.
 */
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // Reset transform whenever a new image is opened.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [url]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(5, z * 1.2));
      else if (e.key === "-") setZoom((z) => Math.max(0.5, z / 1.2));
      else if (e.key === "0") { setZoom(1); setPan({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom((z) => Math.max(0.5, Math.min(5, z * factor)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return; // pan only useful when zoomed in
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  };
  const handleMouseUp = () => { dragRef.current = null; };

  const handleDblClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((z) => (z === 1 ? 2 : 1));
    if (zoom !== 1) setPan({ x: 0, y: 0 });
  };

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/85 select-none"
      onClick={onClose}
      onWheel={handleWheel}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <img
          src={url}
          alt="图片预览"
          draggable={false}
          className="max-w-[92vw] max-h-[92vh] object-contain rounded shadow-2xl will-change-transform"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "zoom-in",
            transition: dragRef.current ? "none" : "transform 80ms ease-out",
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDblClick}
        />
      </div>

      {/* Toolbar */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/55 backdrop-blur-sm rounded-full px-2 py-1.5 text-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="缩小"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))}
          className="size-8 grid place-items-center rounded-full hover:bg-white/15"
        >
          −
        </button>
        <span className="text-xs tabular-nums w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          aria-label="放大"
          onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
          className="size-8 grid place-items-center rounded-full hover:bg-white/15"
        >
          +
        </button>
        <div className="w-px h-5 bg-white/25 mx-1" />
        <button
          type="button"
          aria-label="重置"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          className="px-2.5 h-8 rounded-full text-xs hover:bg-white/15"
        >
          重置
        </button>
      </div>

      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute top-4 right-4 size-9 grid place-items-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
      >
        <X size={20} />
      </button>
    </div>
  );
}

function HeaderBtn({
  icon,
  active,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "size-8 grid place-items-center rounded hover:bg-[var(--bg-mid)] transition-colors",
        active ? "text-white bg-[var(--bg-mid)]" : "hover:text-white",
        className,
      )}
    >
      {icon}
    </button>
  );
}

const MessageRow = React.memo(function MessageRow({
  msg,
  grouped,
  avatarUrl,
  isMe,
  highlight,
  canEdit,
  canDelete,
  canPin,
  onEdit,
  onDelete,
  onTogglePin,
  onAuthorClick,
  onMentionClick,
  onImageClick,
  validMentionNames,
}: {
  msg: UiMessage;
  grouped: boolean;
  avatarUrl?: string | null;
  isMe?: boolean;
  /** When set, occurrences of this string in the message content are highlighted. */
  highlight?: string;
  /** Author can edit (own message + not deleted + not optimistic-pending). */
  canEdit?: boolean;
  /** Author or moderator can delete (own message + not already deleted). */
  canDelete?: boolean;
  /** Moderator can pin/unpin any message. */
  canPin?: boolean;
  onEdit?: (nextText: string) => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
  /** When provided, clicking the avatar / name opens the floating profile
   * card anchored to the click position. Disabled for the user's own rows
   * (we never want to pop our own context menu). */
  onAuthorClick?: (anchor: { x: number; y: number }) => void;
  /** When provided, clicking a @mention in the message opens the profile card. */
  onMentionClick?: (username: string, anchor: { x: number; y: number }) => void;
  onImageClick?: (url: string) => void;
  /** Whitelist of usernames that should render as blue clickable
   *  mentions. When `undefined`, every @token is coloured (legacy
   *  behaviour). Pass a Set built from the current channel roster
   *  + recent message authors so typed-but-nonexistent @text stays
   *  plain — fixes the "@是 also goes blue" report. */
  validMentionNames?: Set<string>;
}) {
  // We never let the user open their own profile card from chat — there's
  // nothing useful to do (can't DM or friend yourself).
  const clickable = !!onAuthorClick && !isMe;
  const handleClick = (e: React.MouseEvent) => {
    if (!clickable || !onAuthorClick) return;
    e.preventDefault();
    e.stopPropagation();
    // Clamp anchor inside the viewport so the profile card never spawns
    // off-screen on edge clicks.
    const x = Math.min(e.clientX, window.innerWidth - 280);
    const y = Math.min(e.clientY, window.innerHeight - 320);
    onAuthorClick({ x, y });
  };

  // Inline edit state — drafted locally; only flushed to onEdit on Enter.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  // Optimistic temp messages have ids prefixed `__pending__` — we don't
  // expose edit/delete on those because the row hasn't been persisted yet
  // (the canonical id is unknown until insert resolves).
  const isPending = msg.id.startsWith("__pending__");
  const showActions =
    !msg.isDeleted &&
    !isPending &&
    !editing &&
    ((canEdit && !!onEdit) ||
      (canDelete && !!onDelete) ||
      (canPin && !!onTogglePin));

  const beginEdit = () => {
    setDraft(msg.content);
    setEditing(true);
  };
  const commitEdit = () => {
    setEditing(false);
    if (onEdit) onEdit(draft);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft(msg.content);
  };

  return (
    <div
      className={cn(
        "px-4 hover:bg-black/10 group flex gap-4 relative",
        grouped ? "py-0.5" : "pt-4",
      )}
    >
      {grouped ? (
        <div className="w-10 shrink-0 flex justify-center">
          <span className="text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 mt-1">
            {msg.timestamp.split(" ").pop()}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          onContextMenu={handleClick}
          disabled={!clickable}
          className={cn(
            "shrink-0",
            clickable
              ? "cursor-pointer hover:opacity-80 transition-opacity"
              : "cursor-default",
          )}
          title={clickable ? `查看 ${msg.authorName} 的资料` : undefined}
        >
          <Avatar
            text={msg.avatar}
            color={msg.authorColor}
            url={avatarUrl ?? msg.avatarUrl}
            size={40}
          />
        </button>
      )}
      <div className="flex-1 min-w-0">
        {!grouped && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <button
              type="button"
              onClick={handleClick}
              onContextMenu={handleClick}
              disabled={!clickable}
              className={cn(
                "font-semibold",
                clickable
                  ? "hover:underline cursor-pointer"
                  : "cursor-default",
                staffNameClass(msg.authorId),
              )}
              // Staff name color overrides user's chosen avatarColor so
              // the tier is recognizable regardless of personal styling.
              style={
                getStaffTier(msg.authorId)
                  ? undefined
                  : { color: msg.authorColor }
              }
            >
              {displayUsername(msg.authorName)}
            </button>
            <StaffBadge userId={msg.authorId} size={13} />
            <span className="text-[11px] text-[var(--text-muted)]">{msg.timestamp}</span>
            {msg.isPinned && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] text-[var(--warning)] font-semibold"
                title="已置顶"
              >
                <Pin size={11} />
                已置顶
              </span>
            )}
          </div>
        )}
        {msg.isDeleted ? (
          <div className="text-[14px] text-[var(--text-muted)] italic">
            （此消息已被删除）
          </div>
        ) : editing ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              rows={Math.min(6, draft.split("\n").length)}
              className="w-full bg-[var(--bg-mid)] text-[15px] text-white rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
            />
            <div className="text-[11px] text-[var(--text-muted)]">
              <span className="text-[var(--accent)]">Enter</span> 保存 ·{" "}
              <button
                type="button"
                onClick={cancelEdit}
                className="text-[var(--accent)] hover:underline"
              >
                Esc 取消
              </button>
            </div>
          </div>
        ) : (
          <>
          {/* Interleave text segments and images according to each attachment's
              textOffset. Images with no offset (legacy) are appended at the end. */}
          {(() => {
            const text = msg.content;
            const atts = msg.attachments ?? [];
            if (atts.length === 0) {
              const interactive = parseInteraction(text);
              if (interactive) {
                return (
                  <InteractionCard kind={interactive.kind} value={interactive.value} />
                );
              }
              return (
                <div className="text-[15px] text-[var(--text-normal)] leading-relaxed whitespace-pre-wrap break-words">
                  {renderContent(text, highlight, onMentionClick, validMentionNames)}
                  {msg.editedAt && (
                    <span className="ml-1.5 text-[10px] text-[var(--text-muted)]" title={`编辑于 ${formatTimestamp(msg.editedAt)}`}>
                      （已编辑）
                    </span>
                  )}
                </div>
              );
            }
            // Sort attachments by their textOffset (absent = end of string).
            const sorted = [...atts].sort(
              (a, b) => (a.textOffset ?? text.length) - (b.textOffset ?? text.length),
            );
            const parts: React.ReactNode[] = [];
            let cursor = 0;
            sorted.forEach((att, i) => {
              if (att.type !== "image") return;
              const offset = Math.min(Math.max(0, att.textOffset ?? text.length), text.length);
              const slice = text.slice(cursor, offset);
              if (slice) {
                parts.push(
                  <div key={`t${i}`} className="text-[15px] text-[var(--text-normal)] leading-relaxed whitespace-pre-wrap break-words">
                    {renderContent(slice, highlight, onMentionClick, validMentionNames)}
                  </div>,
                );
              }
              parts.push(
                <div key={`img${i}`} className="relative my-1 max-h-60 max-w-xs">
                  <Image
                    src={att.url}
                    alt="图片附件"
                    fill
                    className="rounded border border-[var(--bg-light)] object-contain cursor-zoom-in hover:opacity-90 transition-opacity"
                    draggable={false}
                    onClick={() => onImageClick?.(att.url)}
                  />
                </div>,
              );
              cursor = offset;
            });
            // Trailing text after the last image.
            const tail = text.slice(cursor);
            parts.push(
              <div key="t-tail" className="text-[15px] text-[var(--text-normal)] leading-relaxed whitespace-pre-wrap break-words">
                {tail ? renderContent(tail, highlight, onMentionClick, validMentionNames) : null}
                {msg.editedAt && (
                  <span className="ml-1.5 text-[10px] text-[var(--text-muted)]" title={`编辑于 ${formatTimestamp(msg.editedAt)}`}>
                    （已编辑）
                  </span>
                )}
              </div>,
            );
            return parts;
          })()}
          </>
        )}
        <MessageReactions messageId={msg.id} />
      </div>

      {/* Hover toolbar — appears top-right of the row. Discord/KOOK style. */}
      {showActions && (
        <div className="absolute -top-3 right-4 hidden group-hover:flex items-center gap-0.5 bg-[var(--bg-darkest)] border border-[var(--bg-mid)] rounded shadow-lg overflow-hidden">
          {canEdit && onEdit && (
            <button
              type="button"
              onClick={beginEdit}
              title="编辑消息"
              className="size-7 grid place-items-center text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            >
              <Pencil size={14} />
            </button>
          )}
          {canPin && onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              title={msg.isPinned ? "取消置顶" : "置顶消息"}
              className={cn(
                "size-7 grid place-items-center hover:bg-[var(--bg-mid)]",
                msg.isPinned
                  ? "text-[var(--warning)]"
                  : "text-[var(--text-muted)] hover:text-white",
              )}
            >
              <Pin size={14} />
            </button>
          )}
          {canDelete && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="删除消息"
              className="size-7 grid place-items-center text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Detect interactive-game messages posted by InteractionMenu.
 * Format conventions (must match `@/components/InteractionMenu.tsx`):
 *   - `🎲 投掷了骰子：N`
 *   - `✊ 出了：石头|剪刀|布`
 *   - `🎯 roll 点：N / 100`
 * Returns null for normal text so the caller falls back to the plain
 * markdown/mention pipeline.
 */
function parseInteraction(
  text: string,
): { kind: "dice" | "rps" | "roll"; value: string } | null {
  const t = (text || "").trim();
  if (!t) return null;
  let m = t.match(/^🎲\s*投掷了骰子：\s*(\d+)\s*$/);
  if (m) return { kind: "dice", value: m[1] };
  m = t.match(/^✊\s*出了：\s*(石头|剪刀|布)\s*$/);
  if (m) return { kind: "rps", value: m[1] };
  m = t.match(/^🎯\s*roll\s*点：\s*(\d+)\s*\/\s*100\s*$/i);
  if (m) return { kind: "roll", value: m[1] };
  return null;
}

/** Compact, distinctively-styled card for interactive messages. */
function InteractionCard({
  kind,
  value,
}: {
  kind: "dice" | "rps" | "roll";
  value: string;
}) {
  const meta =
    kind === "dice"
      ? { emoji: "🎲", label: "骰子", display: value, hint: "1–6" }
      : kind === "rps"
        ? {
            emoji: value === "石头" ? "✊" : value === "剪刀" ? "✌️" : "🖐️",
            label: "石头剪刀布",
            display: value,
            hint: "随机",
          }
        : {
            emoji: "🎯",
            label: "roll 点",
            display: `${value} / 100`,
            hint: Number(value) >= 95 ? "极佳" : Number(value) <= 5 ? "悲剧" : undefined,
          };
  return (
    <div className="inline-flex items-center gap-3 mt-0.5 px-3 py-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/8 max-w-fit">
      <span className="text-2xl leading-none" aria-hidden>
        {meta.emoji}
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] uppercase tracking-wider text-[var(--accent)] font-semibold">
          {meta.label}
        </span>
        <span className="text-[17px] font-bold text-white tabular-nums">
          {meta.display}
        </span>
      </div>
      {meta.hint && (
        <span className="text-[10px] text-[var(--text-muted)] self-end mb-0.5">
          {meta.hint}
        </span>
      )}
    </div>
  );
}

function renderContent(
  text: string,
  highlight: string | undefined,
  onMentionClick?: (username: string, anchor: { x: number; y: number }) => void,
  validNames?: Set<string>,
): React.ReactNode {
  const parts = text.split(/(@[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+)/g);
  if (parts.length <= 1) {
    return highlight ? highlightText(text, highlight) : text;
  }
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith("@") && part.length > 1) {
          const username = part.slice(1);
          // Only render the blue clickable mention when the username
          // actually resolves to a known user. Without this gate any
          // typed `@xxxx` (including nonsense like "@是") was styled
          // as a real mention and was clickable — user-reported bug.
          const isReal = !validNames || validNames.has(username);
          if (!isReal) {
            return highlight ? (
              <span key={i}>{highlightText(part, highlight)}</span>
            ) : (
              <span key={i}>{part}</span>
            );
          }
          return (
            <button
              key={i}
              type="button"
              className="text-[#5b9dff] hover:underline cursor-pointer font-medium"
              onClick={(e) =>
                onMentionClick?.(username, { x: e.clientX, y: e.clientY })
              }
            >
              {part}
            </button>
          );
        }
        return highlight ? (
          <span key={i}>{highlightText(part, highlight)}</span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${escapeRegex(q)})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark
            key={i}
            className="bg-yellow-400/40 text-yellow-100 rounded-[2px] px-[1px]"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pinned banner — shows at the top of the channel when any message is
// pinned. Collapsed by default (just the title + count); expands on click
// to reveal the pinned message previews (max 5 newest). Everyone sees it;
// pinning itself is admin-only (see `canPin` on MessageRow).
// ---------------------------------------------------------------------------
function PinnedBanner({ messages }: { messages: UiMessage[] }) {
  const pinned = useMemo(
    () =>
      messages
        .filter((m) => m.isPinned && !m.isDeleted)
        // Most-recently-pinned first. Legacy rows (pre-`pinned_at`) fall
        // back to created_at so they still have a stable order.
        .sort((a, b) => (b.pinnedAt ?? b.createdAt) - (a.pinnedAt ?? a.createdAt))
        .slice(0, 5),
    [messages],
  );
  const [open, setOpen] = useState(false);
  if (pinned.length === 0) return null;
  return (
    <div className="border-b border-[var(--bg-mid)]/60 bg-[var(--warning)]/5 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-8 px-4 flex items-center gap-2 text-[12px] text-[var(--warning)] hover:bg-[var(--warning)]/10"
      >
        <Pin size={13} />
        <span className="font-semibold">置顶 · {pinned.length}</span>
        <span className="ml-1 text-[var(--text-muted)] truncate">
          {pinned[0].authorName}: {pinned[0].content.slice(0, 60)}
          {pinned[0].content.length > 60 ? "…" : ""}
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open && (
        <ul className="px-4 pb-2 space-y-1 text-[12px]">
          {pinned.map((m) => (
            <li
              key={m.id}
              className="border-l-2 border-[var(--warning)] pl-2 py-0.5"
            >
              <span
                className="font-semibold mr-1.5"
                style={{ color: m.authorColor }}
              >
                {m.authorName}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] mr-1.5">
                {m.timestamp}
              </span>
              <span className="text-[var(--text-normal)] whitespace-pre-wrap break-words">
                {m.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
