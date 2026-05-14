"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type PresenceUser } from "@/lib/use-presence";
import ServerSidebar, { type SidebarView } from "@/components/ServerSidebar";
import ChannelSidebar from "@/components/ChannelSidebar";
import DmSidebar from "@/components/DmSidebar";
import InteractionMenu from "@/components/InteractionMenu";
import Tooltip from "@/components/Tooltip";
import AddFriendModal from "@/components/AddFriendModal";
import CreateServerModal from "@/components/CreateServerModal";
import ServerSettingsModal from "@/components/ServerSettingsModal";
import JoinServerModal from "@/components/JoinServerModal";
import ServerContextMenu from "@/components/ServerContextMenu";
import NotificationSettingsModal from "@/components/NotificationSettingsModal";
import PrivacySettingsModal from "@/components/PrivacySettingsModal";
import DmHome from "@/components/DmHome";
import ChatView from "@/components/ChatView";
import MemberList, { type MemberSeed } from "@/components/MemberList";
import TradeMarketView from "@/components/TradeMarketView";
import PartyView from "@/components/PartyView";
import VoiceChannelView from "@/components/VoiceChannelView";
import SecurityCenter from "@/components/SecurityCenter";
import ProfileSettings from "@/components/ProfileSettings";
import SystemSettings from "@/components/SystemSettings";
import ThemeApplier from "@/components/ThemeApplier";
import UserProfileCard from "@/components/UserProfileCard";
import UserPanel from "@/components/UserPanel";
import VoiceConnectionPanel from "@/components/VoiceConnectionPanel";
import { useVoice } from "@/lib/voice-store";
import { cn } from "@/lib/utils";
import { Plus, AtSign, Gift, Sticker, Smile } from "lucide-react";
import { useComposer, composerTextareaRef, composerImageInputRef, composerImageDropHandlerRef } from "@/lib/composer-store";
import HighPriorityWatcher from "@/components/HighPriorityWatcher";
import ConfirmDialog from "@/components/ConfirmDialog";
import { confirm, alert } from "@/lib/confirm-store";
import KickWatcher from "@/components/KickWatcher";
import MuteWatcher from "@/components/MuteWatcher";
import { useMyMute } from "@/lib/mute-store";
import BanWatcher from "@/components/BanWatcher";
import StaffSync from "@/components/StaffSync";
import { channelCategories, servers as mockServers, type Channel } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import { usePartyAutoLeave } from "@/lib/use-party-auto-leave";
import {
  useAllServers,
  useServers,
  useIsServerMember,
  useMyServerRow,
} from "@/lib/servers-store";
import { useMyServerRole } from "@/lib/server-roles-store";
import { useUnreadStore } from "@/lib/unread-store";
import { useLastMessages } from "@/lib/last-messages-store";
import { useDmThreads } from "@/lib/dm-threads-store";
import { tryDeleteMentionBeforeCaret } from "@/lib/mention-backspace";
import MentionHighlightOverlay from "@/components/MentionHighlightOverlay";
import MentionAutocomplete, { type MentionApi } from "@/components/MentionAutocomplete";
import OfflineBanner from "@/components/OfflineBanner";
import { usePresence } from "@/lib/use-presence";

export default function Home() {
  const router = useRouter();
  const { user, hydrated } = useAuth();

  useEffect(() => {
    if (hydrated && !user) router.replace("/login");
  }, [hydrated, user, router]);

  // Global side-effect: when the user changes voice channels (or leaves
  // voice entirely), auto-disband any party they LEAD that's tied to the
  // old room, and auto-leave any party they're a MEMBER of.
  usePartyAutoLeave();

  const [activeServerId, setActiveServerId] = useState("home");
  const [activeChannel, setActiveChannel] = useState<Channel>(() => {
    // Pick the first text/announcement channel of the *initial* official
    // server so we don't briefly show a global-namespaced channel before
    // the per-server effect kicks in.
    const initial = mockServers.find((s) => s.id === "home");
    const flat =
      (initial?.channels ?? channelCategories).flatMap((c) => c.channels);
    return (
      flat.find((c) => c.type === "text" || c.type === "announcement") ??
      flat[0] ??
      channelCategories[1].channels[0]
    );
  });
  // Per-server channel memory. Switching from server A back to server A
  // restores the channel the user last viewed there, instead of the
  // shared global activeChannel leaking between servers (user-reported
  // "我切换为服务器b我依然在服务器b的频道a" bug).
  const [channelByServer, setChannelByServer] = useState<Record<string, Channel>>({});
  const [showMembers, setShowMembers] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityGate, setSecurityGate] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [activeDm, setActiveDm] = useState<PresenceUser | null>(null);
  // Mirror activeDm.user_id onto a window field that `noteIncomingDm`
  // reads to suppress the bottom-right toast when the user is already
  // looking at that DM thread. Window is used (rather than a store)
  // to avoid pulling the dm-threads-store into a circular import.
  useEffect(() => {
    const w = window as unknown as { __flActiveDmPartnerId?: string };
    if (activeDm) w.__flActiveDmPartnerId = activeDm.user_id;
    else delete w.__flActiveDmPartnerId;
  }, [activeDm]);
  const [profileCard, setProfileCard] = useState<{
    seed: MemberSeed;
    anchor: { x: number; y: number };
  } | null>(null);
  const [view, setView] = useState<SidebarView>("server");

  // Presence is now GLOBAL (one row per user, not per-server). The
  // top-level `AuthBootstrap` already keeps that single global row alive,
  // so no per-server subscription is needed here. Switching servers no
  // longer expires/recreates presence rows, which fixes the bug where a
  // user appeared "offline" in server A while still online in server B.

  const [addServerOpen, setAddServerOpen] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [serverSettingsId, setServerSettingsId] = useState<string | null>(null);
  const [joinServerOpen, setJoinServerOpen] = useState(false);
  /** Pre-filled invite code when launching JoinServerModal (e.g. ?invite=ABC123). */
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(null);
  // Right-click contextual menu on a server icon. `null` when closed.
  const [serverMenu, setServerMenu] = useState<{
    serverId: string;
    x: number;
    y: number;
  } | null>(null);
  const [notifyModalId, setNotifyModalId] = useState<string | null>(null);
  const [privacyModalId, setPrivacyModalId] = useState<string | null>(null);

  const leaveServer = useServers((s) => s.leaveServer);

  // Handle ?invite=CODE in URL: pre-fill the JoinServerModal once the user is
  // logged in. If they're not logged in yet, stash the code in localStorage
  // and consume it on next mount after auth.
  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("invite");
    const fromStash = window.localStorage.getItem("fl_pending_invite");
    const code = (fromUrl || fromStash || "").trim();
    if (!code) return;

    if (!user) {
      // Not logged in yet — stash so we can pick it up after login redirect.
      if (fromUrl && !fromStash) {
        window.localStorage.setItem("fl_pending_invite", fromUrl);
      }
      return;
    }

    const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    // Clean up stash + URL immediately so a refresh doesn't re-trigger.
    window.localStorage.removeItem("fl_pending_invite");
    if (fromUrl) {
      params.delete("invite");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
    }
    // Auto-join without showing the modal. On error, fall back to the
    // modal pre-filled so the user can manually retry.
    void useServers.getState().joinByCode(cleanCode).then((r) => {
      if (r.ok && r.serverId) {
        setActiveServerId(r.serverId);
        setView("server");
        setActiveDm(null);
      } else {
        setPendingInviteCode(cleanCode);
        setJoinServerOpen(true);
      }
    });
  }, [hydrated, user]);

  // Handle ?party=ID — open the party deep-link. We resolve the party
  // row, switch to its server, jump to the 组队大厅 channel, and stash
  // the id so PartyView auto-joins on mount. Mirrors the ?invite= flow.
  useEffect(() => {
    if (!hydrated || !user) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const partyId = params.get("party");
    if (!partyId) return;

    // Strip the param so a refresh doesn't re-trigger.
    params.delete("party");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );

    let cancelled = false;
    void supabase
      .from("parties")
      .select("*")
      .eq("id", partyId)
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data || data.length === 0) {
          void alert("队伍链接无效或已过期。");
          return;
        }
        const row = data[0] as { server_id: string; name: string };
        // Find the 组队大厅 (party-type) channel; fall back to global mock.
        const partyChannel =
          channelCategories
            .flatMap((c) => c.channels)
            .find((ch) => ch.type === "party") ?? null;
        // Prime per-server memory BEFORE swapping server, so the
        // post-server-change useEffect restores 组队大厅 (instead of
        // overwriting it with the default first text channel).
        if (partyChannel) {
          setChannelByServer((m) => ({ ...m, [row.server_id]: partyChannel }));
          setActiveChannel(partyChannel);
        }
        setActiveServerId(row.server_id);
        setView("server");
        setActiveDm(null);
        // Stash so PartyView's mount-effect picks it up and triggers join.
        window.localStorage.setItem("fl_pending_party_join", partyId);
        // Notify any already-mounted PartyView too.
        document.dispatchEvent(
          new CustomEvent("fl:auto-join-party", { detail: { partyId } }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, user]);

  /** Build the 1:1 private message channel id for the current user + partner. */
  const buildDmChannelId = (partnerId: string): string => {
    if (!user) return `dm:${partnerId}`;
    const ids = [user.id, partnerId].sort();
    return `dm:${ids[0]}:${ids[1]}`;
  };

  const openDm = (target: PresenceUser) => {
    if (target.user_id === user?.id) return; // don't DM yourself
    setActiveDm(target);
    // Clear the DM thread's unread badge immediately on click — the
    // user expects "tap red dot = red dot gone" everywhere in the
    // app, not "tap, then wait for ChatView to mount + run effects".
    useDmThreads.getState().markRead(target.user_id);
    // Switch to DM view, flipping the left sidebar from "server channels
    // column" to "friends/DM list". This matches Discord/KOOK behaviour.
    // Otherwise: opened DM but the left sidebar still shows the server
    // channel (bug reported by user).
    setView("dm");
    setMobileNavOpen(false);
  };

  /** Open a DM with a friend (no presence row required). */
  const openDmWithSeed = (seed: MemberSeed) => {
    if (seed.user_id === user?.id) return;
    setActiveDm({
      user_id: seed.user_id,
      username: seed.username,
      avatar: seed.avatar,
      avatar_color: seed.avatar_color,
      online_at: new Date().toISOString(),
    });
    setView("dm");
    setMobileNavOpen(false);
  };

  const openProfileCard = (seed: MemberSeed, anchor: { x: number; y: number }) => {
    setProfileCard({ seed, anchor });
  };

  /**
   * Returns true if the user is allowed to perform the gated action; if not,
   * opens the Security Center with a contextual hint and returns false.
   */
  const requirePhone = (gateMessage: string): boolean => {
    if (user?.phoneVerifiedAt) return true;
    setSecurityGate(gateMessage);
    setSecurityOpen(true);
    return false;
  };

  const allServers = useAllServers();

  // Listen for `fl:navigate-voice` — dispatched by PartyView when the user
  // joins a voice-linked party, so they actually land on the voice-channel
  // page instead of being silently connected in the background.
  useEffect(() => {
    const onNavVoice = (e: Event) => {
      const detail = (e as CustomEvent<{ serverId: string; channelId: string }>).detail;
      if (!detail) return;
      const srv = allServers.find((s) => s.id === detail.serverId);
      const flat = (srv?.channels ?? channelCategories).flatMap((c) => c.channels);
      const ch = flat.find((c) => c.id === detail.channelId);
      console.log("[navigate-voice] received", detail, "→ channel:", ch);
      if (!ch) {
        console.warn("[navigate-voice] channel id not found in target server", {
          serverId: detail.serverId,
          channelId: detail.channelId,
          available: flat.map((c) => c.id),
        });
        return;
      }
      // CRUCIAL: prime channelByServer BEFORE setActiveServerId so the
      // post-server-change useEffect restores THIS channel (instead of
      // overriding back to first-text). Without this prime step the
      // join-voice flow flicked the user back to the first text channel.
      setChannelByServer((m) => ({ ...m, [detail.serverId]: ch }));
      setActiveChannel(ch);
      setActiveServerId(detail.serverId);
      setView("server");
      setActiveDm(null);
    };
    document.addEventListener("fl:navigate-voice", onNavVoice);

    // `fl:navigate-channel` — dispatched by the notification inbox
    // (and any future "jump to mention" affordance). Detail accepts
    // `{ channelId, serverId? }`. The serverId hint lets us route
    // even if `server.channels` hasn't loaded yet (race we hit during
    // first login when the realtime mention arrives before the
    // server-channel hydration completes).
    const onNavChannel = (e: Event) => {
      const detail = (e as CustomEvent<{ channelId: string; serverId?: string }>)
        .detail;
       
      console.log("[navigate-channel] received", detail, "allServers:", allServers.length);
      if (!detail?.channelId) return;
      // The notification's channelId is whatever is stored on the
      // `messages.channel_id` column, i.e. the full ChatView key
      // `${serverId}:${channel.id}`. The local Channel.id (what we
      // actually need to drive ChatView) is the part AFTER the
      // colon; without this normalisation the lookup loop missed
      // every match and fell through to a fallback that double-
      // prefixed the id, which is why "通知点击跳转后看不见消息".
      const colonIdx = detail.channelId.indexOf(":");
      const hintedServerId =
        detail.serverId
        ?? (colonIdx > 0 ? detail.channelId.slice(0, colonIdx) : undefined);
      const localChannelId =
        colonIdx > 0 ? detail.channelId.slice(colonIdx + 1) : detail.channelId;
      // Prefer the hinted server first, then fall back to scanning.
      const ordered = hintedServerId
        ? [
            ...allServers.filter((s) => s.id === hintedServerId),
            ...allServers.filter((s) => s.id !== hintedServerId),
          ]
        : allServers;
      for (const srv of ordered) {
        const flat = (srv.channels ?? []).flatMap((cat) => cat.channels);
        // Match by local id first (preferred), then fall back to the
        // raw stored id for legacy data where the colon prefix isn't
        // present.
        const ch =
          flat.find((c) => c.id === localChannelId) ??
          flat.find((c) => c.id === detail.channelId);
        if (!ch) continue;
        setChannelByServer((m) => ({ ...m, [srv.id]: ch }));
        setActiveChannel(ch);
        setActiveServerId(srv.id);
        setView("server");
        setActiveDm(null);
        // Clear mention markers for this destination right away.
        useUnreadStore.getState().markChannelRead(ch.id);
        useUnreadStore.setState((s) => {
          if (!s.serverMentions[srv.id]) return s;
          const sm = { ...s.serverMentions };
          const smc = { ...s.serverMentionCounts };
          delete sm[srv.id];
          delete smc[srv.id];
          return { serverMentions: sm, serverMentionCounts: smc };
        });
        return;
      }
      // Last-resort #1: hinted server exists but its channels array
      // doesn't yet contain the destination (race after first login).
      // Synthesize a Channel using the LOCAL id (not the
      // `${serverId}:${slug}` form, otherwise ChatView would prepend
      // the server prefix again and produce a triple-segment key
      // that doesn't match any DB row).
      if (hintedServerId && allServers.some((s) => s.id === hintedServerId)) {
        const synth = {
          id: localChannelId,
          name: localChannelId,
          type: "text" as const,
        };
        setChannelByServer((m) => ({ ...m, [hintedServerId]: synth }));
        setActiveChannel(synth);
        setActiveServerId(hintedServerId);
        setView("server");
        setActiveDm(null);
        useUnreadStore.getState().markChannelRead(detail.channelId);
        useUnreadStore.setState((s) => {
          if (!s.serverMentions[hintedServerId]) return s;
          const sm = { ...s.serverMentions };
          const smc = { ...s.serverMentionCounts };
          delete sm[hintedServerId];
          delete smc[hintedServerId];
          return { serverMentions: sm, serverMentionCounts: smc };
        });
        return;
      }
      // Last-resort #2: official channels follow the `{serverId}-{slug}`
      // naming convention (see `mock-data.ts`). If the channel id starts
      // with a known server id we still know which server to land on,
      // even when the cached `srv.channels` array is out of sync (e.g.
      // a brand-new mock channel added in code but not yet propagated
      // to the merged server roster). This was the actual reproducer
      // for the "通知点击不跳转" bug — the @ landed in `home-general`,
      // an official channel whose row never made it into `srv.channels`
      // because `MOCK_SERVERS.channels` was overridden by an empty
      // CloudBase override doc.
      const cid = detail.channelId;
      const sepIdx = cid.indexOf(":") >= 0 ? cid.indexOf(":") : cid.indexOf("-");
       
      console.log(
        "[navigate-channel] fallback try",
        { cid, sepIdx, guessedSrvId: sepIdx > 0 ? cid.slice(0, sepIdx) : null,
          allIds: allServers.map((s) => s.id) },
      );
      if (sepIdx > 0) {
        const guessedSrvId = cid.slice(0, sepIdx);
        const guessedSrv = allServers.find((s) => s.id === guessedSrvId);
         
        console.log("[navigate-channel] fallback match?", !!guessedSrv, guessedSrvId);
        if (guessedSrv) {
          const slug = cid.slice(sepIdx + 1);
          setActiveServerId(guessedSrv.id);
          setView("server");
          setActiveDm(null);
          // Synthesize a Channel record so ChatView opens directly on
          // the right id without waiting for the sidebar to re-render.
          setActiveChannel({
            id: cid,
            name: slug,
            type: "text",
          });
          setChannelByServer((m) => ({
            ...m,
            [guessedSrv.id]: {
              id: cid,
              name: slug,
              type: "text",
            },
          }));
          useUnreadStore.getState().markChannelRead(cid);
          useUnreadStore.setState((s) => {
            if (!s.serverMentions[guessedSrv.id]) return s;
            const sm = { ...s.serverMentions };
            delete sm[guessedSrv.id];
            return { serverMentions: sm };
          });
          return;
        }
      }
      console.warn(
        "[navigate-channel] channel id not found in any server",
        detail,
        "scanned:",
        allServers.map((s) => ({
          id: s.id,
          channels: (s.channels ?? []).flatMap((c) =>
            c.channels.map((ch) => ch.id),
          ),
        })),
      );
    };
    document.addEventListener("fl:navigate-channel", onNavChannel);

    // `fl:navigate-dm` — dispatched by the DM toast cards (and any
    // future notification-inbox DM row). Opens the DM with a known
    // partner without requiring the caller to know our internal
    // DmTarget shape.
    const onNavDm = (e: Event) => {
      const detail = (e as CustomEvent<{
        partnerId: string;
        partnerName: string;
        partnerAvatar: string;
        partnerColor: string;
        partnerAvatarUrl?: string | null;
      }>).detail;
      if (!detail?.partnerId) return;
      setActiveDm({
        user_id: detail.partnerId,
        username: detail.partnerName,
        avatar: detail.partnerAvatar,
        avatar_color: detail.partnerColor,
        avatar_url: detail.partnerAvatarUrl ?? null,
        // PresenceUser requires online_at; we don't know it here so
        // stamp now (the DM view doesn't actually use this field).
        online_at: new Date().toISOString(),
      });
      setView("dm");
      setActiveServerId("home");
    };
    document.addEventListener("fl:navigate-dm", onNavDm);

    const onNavFriends = () => {
      setView("dm");
      setActiveServerId("home");
    };
    document.addEventListener("fl:navigate-friends", onNavFriends);

    return () => {
      document.removeEventListener("fl:navigate-voice", onNavVoice);
      document.removeEventListener("fl:navigate-channel", onNavChannel);
      document.removeEventListener("fl:navigate-dm", onNavDm);
      document.removeEventListener("fl:navigate-friends", onNavFriends);
    };
  }, [allServers]);

  const activeServer = allServers.find((s) => s.id === activeServerId);
  const serverName = activeServer?.name ?? "ForgottenLand";
  const myRoleHere = useMyServerRole(activeServerId);
  // True only when the current user is an actual member of the active
  // server. Drives the preview banner + composer lock. Official mock
  // servers always return true; the transient "preview" server returns
  // false until the user clicks 加入.
  const isActiveMember = useIsServerMember(activeServerId);
  const activeServerRow = useMyServerRow(activeServerId);
  const joinById = useServers((s) => s.joinById);
  const setPreview = useServers((s) => s.setPreview);
  const canManageActive =
    isActiveMember &&
    !!activeServer &&
    !activeServer.is_official &&
    (myRoleHere === "creator" || myRoleHere === "admin");

  /**
   * Accept the server preview — fire a real joinById() and, if it fails,
   * surface a simple alert. The store clears `preview` automatically on
   * success so the UI flips to full-member mode.
   */
  const handleJoinPreview = async () => {
    if (!activeServerId || isActiveMember) return;
    const r = await joinById(activeServerId);
    if (!r.ok) {
      void alert(`加入失败：${r.error || "未知错误"}`);
    }
  };

  /** Dismiss preview and fall back to the "home" tab. */
  const handleCancelPreview = () => {
    setPreview(null);
    setActiveServerId("home");
  };

  const handleSelectChannel = (ch: Channel) => {
    setActiveChannel(ch);
    // Clear unread badge for the channel we're now viewing.
    useUnreadStore.getState().markChannelRead(ch.id);
    // Also clear the server-level mention dot — the user is now
    // inside this server, so the cross-server "you have a ping
    // somewhere" indicator is no longer useful here. If the mention
    // is in a DIFFERENT channel of the same server it still flags
    // via mentions[channelId] / unread[channelId].
    if (activeServerId && activeServerId !== "global") {
      useUnreadStore.setState((s) => {
        if (!s.serverMentions[activeServerId]) return s;
        const sm = { ...s.serverMentions };
        delete sm[activeServerId];
        return { serverMentions: sm };
      });
    }
    // Persist this choice as "the channel I last visited on this server"
    // so switching servers and coming back restores it correctly.
    setChannelByServer((prev) => ({ ...prev, [activeServerId]: ch }));
    setActiveDm(null); // leaving DM when switching to a normal channel
    setMobileNavOpen(false);
  };

  const markServerRead = useServers((s) => s.markServerRead);

  const handleSelectServer = (id: string) => {
    markServerRead(id);
    // Per-user request: clicking ANY indicator that's wearing a red
    // dot should cancel it. Server icons aggregate channel-level
    // unreads + the server-level mention flag, so wipe both buckets
    // for every channel in this server. Users still see per-channel
    // unread state inside the ChannelSidebar; the cross-server red
    // dot is the one that gets cleared on click.
    const srv = allServers.find((s) => s.id === id);
    const ids = (srv?.channels ?? []).flatMap((c) =>
      c.channels.map((ch) => ch.id),
    );
    useUnreadStore.getState().markServerRead(ids, id);
    setActiveServerId(id);
    setView("server");
    setActiveDm(null);
  };

  // Subscribe to new messages so we can flag non-active channels as
  // unread (regular dot) or as a mention (red dot).
  //
  // History: this used `filter: server_id=eq.<id>` to scope to the
  // current server, but `messages` rows don't carry a server_id
  // column — only channel_id. The filter therefore matched zero rows
  // and the red-dot path silently never fired (user-reported bug).
  // We now subscribe globally and scope CLIENT-SIDE using the active
  // server's channel list. This also makes the watcher resilient to
  // future schema changes.
  // Keep fresh references in refs so the global watch below only
  // subscribes once per (user, server) and never tears down when the
  // user merely switches channels or when `allServers` gets a new
  // identity (presence/store re-renders). Without this, the watch
  // was being torn down + re-established every few hundred ms,
  // causing the CloudBase WS to time out (pong timed out / wsclient
  // send timedout) and a cascade of `client closed (messages {})`
  // logs reported in the console.
  const activeChannelIdRef = useRef(activeChannel.id);
  activeChannelIdRef.current = activeChannel.id;
  const allServersRef = useRef(allServers);
  allServersRef.current = allServers;
  const usernameRef = useRef(user?.username ?? "");
  usernameRef.current = user?.username ?? "";

  useEffect(() => {
    if (!user || !activeServerId || activeServerId === "global") return;
    const { markChannelUnread } = useUnreadStore.getState();
    const broadcastTokens = ["@everyone", "@all", "@here", "@所有人", "@全体"];
    // Eager one-shot: fetch the latest message for every text /
    // announcement channel in this server so the sidebar can show
    // a preview line immediately (vs. waiting for fresh INSERTs).
    const server = allServersRef.current.find((s) => s.id === activeServerId);
    const previewChannelIds = (server?.channels ?? [])
      .flatMap((cat) => cat.channels)
      .filter((c) => c.type === "text" || c.type === "announcement")
      .map((c) => `${activeServerId}:${c.id}`);
    if (previewChannelIds.length > 0) {
      useLastMessages.getState().loadLatestForChannels(previewChannelIds);
    }
    const ch = supabase
      .channel(`unread-watch:${activeServerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Record<string, unknown> | null;
          if (!msg) return;
          const cid = msg.channel_id as string | undefined;
          if (!cid) return;
          // Channel-membership check: scope the listener to the
          // active server only (cross-server unread is handled by
          // MentionWatcher / dm-threads).
          const srv = allServersRef.current.find(
            (s) => s.id === activeServerId,
          );
          const inServer = (srv?.channels ?? []).some((cat) =>
            cat.channels.some((c) => `${activeServerId}:${c.id}` === cid),
          );
          if (!inServer) return;
          // Live-update the sidebar preview regardless of who
          // posted (including ourself — the sender's own client
          // should also see the row jump to "刚刚 / your text").
          const content =
            typeof msg.content === "string" ? msg.content : "";
          const authorName =
            typeof msg.author_name === "string" ? msg.author_name : "";
          const createdAt =
            typeof msg.created_at === "string"
              ? new Date(msg.created_at).getTime()
              : Date.now();
          useLastMessages.getState().upsert({
            channelId: cid,
            authorName,
            content,
            at: createdAt,
          });
          // Below: mention-unread bookkeeping. Self-posts don't
          // count and the currently-active channel is already
          // "read".
          if (msg.author_id === user.id) return;
          if (cid === activeChannelIdRef.current) return;
          const lower = content.toLowerCase();
          const myMention = `@${usernameRef.current}`.toLowerCase();
          const mention =
            lower.includes(myMention) ||
            broadcastTokens.some((t) => lower.includes(t));
          markChannelUnread(cid, mention);
        },
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [user, activeServerId]);

  const prevServerRef = useRef(activeServerId);
  useEffect(() => {
    if (prevServerRef.current === activeServerId) return;
    const prevId = prevServerRef.current;
    prevServerRef.current = activeServerId;
    // Stash the channel we just left so coming back to it later restores.
    setChannelByServer((m) => ({ ...m, [prevId]: activeChannel }));
    // Restore — or pick a sensible default — for the new server.
    const restored = channelByServer[activeServerId];
    if (restored) {
      setActiveChannel(restored);
      return;
    }
    const target = allServers.find((s) => s.id === activeServerId);
    const cats = target?.channels ?? channelCategories;
    const flat = cats.flatMap((c) => c.channels);
    const firstText =
      flat.find((c) => c.type === "text" || c.type === "announcement") ??
      flat[0];
    if (firstText) setActiveChannel(firstText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId]);

  // When the active server's channel list is refreshed (e.g. after saving
  // settings), re-sync activeChannel so its readonly flag / name stay current.
  // Without this, the stale channel object from before the save is used and
  // locking channel A can appear to lock all channels (the ref is stale).
  useEffect(() => {
    if (!activeServer?.channels) return;
    const flat = activeServer.channels.flatMap((c) => c.channels);
    const updated = flat.find((ch) => ch.id === activeChannel.id);
    if (updated && updated !== activeChannel) {
      setActiveChannel(updated);
    }
  // Only run when the channels reference itself changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServer?.channels]);

  // Document-level drag-and-drop catcher. Without this, dropping an image on
  // anything outside ChatView's <section> (e.g. the BottomBarComposer textarea
  // or the margins) triggers the browser's default behaviour — navigating
  // away to the file's URL. We always preventDefault on dragover/drop, and
  // route any image file into the active composer's pending-attachment slot.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      // Only intercept when files are being dragged. Lets text-drag /
      // selection-drag inside inputs work normally.
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      // If a component-level handler already processed it, skip.
      if (e.defaultPrevented) {
        // We still need to preventDefault on the document level too —
        // some browsers will navigate even after a child preventDefault'd.
        // (Belt + suspenders.)
        return;
      }
      e.preventDefault();
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) composerImageDropHandlerRef.current?.(file);
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  const handleOpenDmView = () => {
    setView("dm");
    setMobileNavOpen(false);
  };

  const renderSidebar = (isMobile: boolean) => {
    if (view === "dm") {
      return (
        <DmSidebar
          presenceRoom={activeServerId}
          onOpenDm={(seed) => {
            openDmWithSeed(seed);
            if (isMobile) setMobileNavOpen(false);
          }}
          onSelectFriendsHome={() => {
            // Clear active DM so the right-side reverts to the friends grid.
            setActiveDm(null);
            if (isMobile) setMobileNavOpen(false);
          }}
          onOpenDiscover={() => {
            setPendingInviteCode(null);
            setJoinServerOpen(true);
            if (isMobile) setMobileNavOpen(false);
          }}
          onAddFriend={() => setAddFriendOpen(true)}
          onOpenSecurity={() => {
            setSecurityGate(null);
            setSecurityOpen(true);
            if (isMobile) setMobileNavOpen(false);
          }}
          onOpenProfile={() => {
            setProfileOpen(true);
            if (isMobile) setMobileNavOpen(false);
          }}
        />
      );
    }
    return (
      <ChannelSidebar
        serverName={serverName}
        activeChannelId={activeChannel.id}
        presenceRoom={activeServerId}
        onSelect={handleSelectChannel}
        onOpenSecurity={() => {
          setSecurityGate(null);
          setSecurityOpen(true);
          if (isMobile) setMobileNavOpen(false);
        }}
        onOpenProfile={() => {
          setProfileOpen(true);
          if (isMobile) setMobileNavOpen(false);
        }}
        manageable={canManageActive}
        isOfficial={!!activeServer?.is_official}
        customCategories={activeServer?.channels}
        onOpenInvite={() => setServerSettingsId(activeServerId)}
        onOpenSettings={() => setServerSettingsId(activeServerId)}
        inviteCode={activeServerRow?.invite_code ?? undefined}
        isMember={isActiveMember}
        onJoinServer={handleJoinPreview}
        onCancelPreview={handleCancelPreview}
        onOpenServerMenu={(x, y) => setServerMenu({ serverId: activeServerId, x, y })}
      />
    );
  };

  const renderMain = () => {
    // DM view with no active conversation — friends grid home.
    if (view === "dm" && !activeDm) {
      return (
        <DmHome
          onOpenNav={() => setMobileNavOpen(true)}
          onOpenDm={(seed) => openDmWithSeed(seed)}
        />
      );
    }
    // DM overrides the normal channel.
    if (activeDm) {
      return (
        <ChatView
          channelId={buildDmChannelId(activeDm.user_id)}
          channelName={activeDm.username}
          showMembers={false}
          onToggleMembers={() => {}}
          onOpenNav={() => setMobileNavOpen(true)}
          dmPartner={{
            user_id: activeDm.user_id,
            username: activeDm.username,
            avatar: activeDm.avatar,
            avatar_color: activeDm.avatar_color,
          }}
          onCloseDm={() => setActiveDm(null)}
          onOpenProfileCard={openProfileCard}
        />
      );
    }

    if (activeChannel.type === "trade" || activeChannel.type === "auction" || activeChannel.type === "coins") {
      return (
        <TradeMarketView
          channelName={activeChannel.name}
          serverId={activeServerId}
          onOpenNav={() => setMobileNavOpen(true)}
          requireGate={() => requirePhone("上架物品需要先绑定手机号。")}
          defaultTab={
            activeChannel.type === "auction" ? "auction" :
            activeChannel.type === "coins" ? "coins" : "items"
          }
          onTabChange={(t) => {
            const targetType =
              t === "coins" ? "coins" :
              t === "auction" || t === "misc" ? "auction" : "trade";
            const server = allServers.find((s) => s.id === activeServerId);
            const flat = (server?.channels ?? channelCategories).flatMap((c) => c.channels);
            const ch = flat.find((c) => c.type === targetType);
            if (ch) handleSelectChannel(ch);
          }}
        />
      );
    }
    if (activeChannel.type === "party") {
      return (
        <PartyView
          channelName={activeChannel.name}
          serverId={activeServerId}
          onOpenNav={() => setMobileNavOpen(true)}
          requireGate={() => requirePhone("创建队伍需要先绑定手机号（防止恶意拉人）。")}
        />
      );
    }
    if (activeChannel.type === "voice" || activeChannel.type === "stream") {
      // Discord-style split: voice grid on the left, channel chat on
      // the right (replaces MemberList which is hidden via the
      // `showMemberPanel` predicate below). Both share the same
      // channelId so messages here are the same `${server}:${channel}`
      // bucket the text-channel ChatView would use.
      return (
        <>
          <VoiceChannelView
            serverId={activeServerId}
            channelId={activeChannel.id}
            channelName={activeChannel.name}
            channelType={activeChannel.type}
            onOpenNav={() => setMobileNavOpen(true)}
          />
          <div className="hidden md:flex w-[567px] shrink-0 relative">
            {/* Horizontal separator at h-14 — extends the VoiceChannelView
                header's border-b across the right ChatView panel so the
                dividing line runs full-width. */}
            <div className="absolute left-0 right-0 top-14 h-px bg-black/30 pointer-events-none z-10" />
            {/* Vertical divider — full height including header row. */}
            <div className="absolute left-0 top-0 bottom-0 w-px bg-[var(--bg-mid)] pointer-events-none z-10" />
            <ChatView
              channelId={`${activeServerId}:${activeChannel.id}`}
              channelName={activeChannel.name}
              showMembers={false}
              onToggleMembers={() => {}}
              onOpenNav={() => setMobileNavOpen(true)}
              announcement={false}
              readonlyChannel={false}
              serverId={activeServerId}
              onOpenProfileCard={openProfileCard}
              guest={!isActiveMember}
              onJoinServer={handleJoinPreview}
              compactWelcome
              hideHeader
            />
          </div>
        </>
      );
    }
    return (
      <ChatView
        channelId={`${activeServerId}:${activeChannel.id}`}
        channelName={activeChannel.name}
        showMembers={showMembers}
        onToggleMembers={() => setShowMembers((v) => !v)}
        onOpenNav={() => setMobileNavOpen(true)}
        announcement={activeChannel.type === "announcement"}
        readonlyChannel={activeChannel.readonly}
        serverId={activeServerId}
        onOpenProfileCard={openProfileCard}
        guest={!isActiveMember}
        onJoinServer={handleJoinPreview}
      />
    );
  };

  const showMemberPanel =
    showMembers &&
    view === "server" &&
    !activeDm &&
    activeChannel.type !== "trade" &&
    activeChannel.type !== "auction" &&
    activeChannel.type !== "coins" &&
    // Voice / stream channels render the chat panel on the right
    // (see renderMain above) so the MemberList is suppressed —
    // otherwise we'd stack chat-then-members and lose the chat.
    activeChannel.type !== "voice" &&
    activeChannel.type !== "stream";

  if (!hydrated || !user) {
    return (
      <div className="h-screen w-screen grid place-items-center bg-[var(--bg-darkest)] text-[var(--text-muted)] italic">
        ✦ 唤醒符文中…      </div>
    );
  }

  return (
    // Fill the entire viewport. We previously capped to 1600px on
    // ultra-wide setups but it produced visible black bars on the side
    // and was reported as ugly. Letting it stretch matches Discord's
    // current behaviour and avoids the seam.
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg-darkest)] flex flex-col">
      <HighPriorityWatcher />
      <OfflineBanner />
      <KickWatcher />
      <MuteWatcher />
      <BanWatcher />
      <StaffSync />
      <ConfirmDialog />
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
      {/* Desktop sidebars */}
      <div className="hidden sm:flex h-full">
        <ServerSidebar
          activeId={activeServerId}
          view={view}
          onSelect={handleSelectServer}
          onOpenDm={handleOpenDmView}
          onOpenDiscover={() => {
            // 「发现公会」现在复用JoinServerModal 的「浏览」tab —
            // 这里有真实数据，不再是占位Modal —
            setPendingInviteCode(null);
            setJoinServerOpen(true);
          }}
          onAddServer={() => setAddServerOpen(true)}
          onJoinServer={() => {
            setPendingInviteCode(null);
            setJoinServerOpen(true);
          }}
          onOpenServerSettings={(id) => setServerSettingsId(id)}
          onOpenServerMenu={(id, x, y) => setServerMenu({ serverId: id, x, y })}
        />
        {renderSidebar(false)}
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <>
          <div
            className="sm:hidden fixed inset-0 bg-black/60 z-40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="sm:hidden fixed inset-y-0 left-0 z-50 flex shadow-2xl">
            <ServerSidebar
              activeId={activeServerId}
              view={view}
              onSelect={handleSelectServer}
              onOpenDm={handleOpenDmView}
              onOpenDiscover={() => {
                setPendingInviteCode(null);
                setJoinServerOpen(true);
                setMobileNavOpen(false);
              }}
              onAddServer={() => setAddServerOpen(true)}
              onJoinServer={() => {
                setPendingInviteCode(null);
                setJoinServerOpen(true);
                setMobileNavOpen(false);
              }}
              onOpenServerSettings={(id) => setServerSettingsId(id)}
              onOpenServerMenu={(id, x, y) => setServerMenu({ serverId: id, x, y })}
            />
            {renderSidebar(true)}
          </div>
        </>
      )}

      {renderMain()}
      {showMemberPanel && (
        <div className="hidden sm:flex h-full">
        <MemberList
          room={activeServerId}
          onOpenDm={openDm}
          onOpenProfileCard={openProfileCard}
        />
        </div>
      )}
      {securityOpen && (
        <SecurityCenter
          gate={securityGate}
          onClose={() => {
            setSecurityOpen(false);
            setSecurityGate(null);
          }}
        />
      )}
      {profileOpen && (
        <ProfileSettings onClose={() => setProfileOpen(false)} />
      )}
      {systemOpen && (
        <SystemSettings onClose={() => setSystemOpen(false)} />
      )}
      <ThemeApplier />
      {profileCard && (
        <UserProfileCard
          seed={profileCard.seed}
          anchor={profileCard.anchor}
          onClose={() => setProfileCard(null)}
          onStartDm={openDmWithSeed}
        />
      )}
      <CreateServerModal
        open={addServerOpen}
        onClose={() => setAddServerOpen(false)}
        onCreated={(serverId) => {
          setActiveServerId(serverId);
          setView("server");
          setActiveDm(null);
        }}
      />
      <JoinServerModal
        open={joinServerOpen}
        initialCode={pendingInviteCode || undefined}
        onClose={() => {
          setJoinServerOpen(false);
          setPendingInviteCode(null);
        }}
        onJoined={(serverId) => {
          setActiveServerId(serverId);
          setView("server");
          setActiveDm(null);
          setMobileNavOpen(false);
        }}
        onPreview={(serverId) => {
          // Switch to the previewed server without joining — the channel
          // sidebar will render the read-only banner. Prime per-server
          // memory so the post-server-change useEffect doesn't fight us.
          const fallback = channelCategories[1].channels[0];
          setChannelByServer((m) => ({ ...m, [serverId]: fallback }));
          setActiveChannel(fallback);
          setActiveServerId(serverId);
          setView("server");
          setActiveDm(null);
          setMobileNavOpen(false);
        }}
      />
      <ServerSettingsModal
        open={!!serverSettingsId}
        serverId={serverSettingsId}
        onClose={() => setServerSettingsId(null)}
        onDisbanded={() => {
          // If we just disbanded the active server, snap back to the home server.
          setActiveServerId("home");
          setServerSettingsId(null);
        }}
      />
      {addFriendOpen && (
        <AddFriendModal onClose={() => setAddFriendOpen(false)} />
      )}
      {/* Right-click contextual menu on server icons */}
      {serverMenu && (
        <ServerContextMenu
          serverId={serverMenu.serverId}
          x={serverMenu.x}
          y={serverMenu.y}
          onClose={() => setServerMenu(null)}
          onMarkRead={() => {
            const srv = allServers.find((s) => s.id === serverMenu.serverId);
            const ids = (srv?.channels ?? []).flatMap((c) => c.channels.map((ch) => ch.id));
            useUnreadStore.getState().markServerRead(ids, serverMenu.serverId);
          }}
          onInvite={() => setServerSettingsId(serverMenu.serverId)}
          onOpenNotify={() => setNotifyModalId(serverMenu.serverId)}
          onOpenPrivacy={() => setPrivacyModalId(serverMenu.serverId)}
          onCollapseAll={() => {
            document.dispatchEvent(new CustomEvent("fl:collapse-all"));
          }}
          onExpandAll={() => {
            document.dispatchEvent(new CustomEvent("fl:expand-all"));
          }}
          onLeave={async () => {
            const sid = serverMenu.serverId;
            const srvName =
              allServers.find((s) => s.id === sid)?.name || "这个服务器";
            if (!(await confirm(`确定要离开「${srvName}」吗？`))) return;
            const r = await leaveServer(sid);
            if (!r.ok) {
              void alert(r.error || "离开失败");
              return;
            }
            // If we just left the active server, fall back to home.
            if (activeServerId === sid) setActiveServerId("home");
          }}
          onCopyName={async () => {
            const name =
              allServers.find((s) => s.id === serverMenu.serverId)?.name ||
              "";
            try {
              await navigator.clipboard.writeText(name);
            } catch {
              /* ignore */
            }
          }}
          onOpenSettings={() => {
            setServerSettingsId(serverMenu.serverId);
            setServerMenu(null);
          }}
        />
      )}
      <NotificationSettingsModal
        open={!!notifyModalId}
        serverId={notifyModalId}
        serverName={
          allServers.find((s) => s.id === notifyModalId)?.name || ""
        }
        onClose={() => setNotifyModalId(null)}
      />
      <PrivacySettingsModal
        open={!!privacyModalId}
        serverId={privacyModalId}
        serverName={
          allServers.find((s) => s.id === privacyModalId)?.name || ""
        }
        onClose={() => setPrivacyModalId(null)}
      />
      </div>

      {/* Full-width bottom bar — desktop only.
          showMemberSpacer flags whether the bottom bar should reserve
          the 324px right column. We pass true whenever EITHER the
          MemberList shows (text/announcement channels) OR the
          voice-channel chat panel shows (voice/stream) so the column
          widths stay flush between the main area and the bottom bar. */}
      <BottomBarComposer
        onOpenSecurity={() => { setSecurityGate(null); setSecurityOpen(true); }}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenSystemSettings={() => setSystemOpen(true)}
        onAddServer={() => setAddServerOpen(true)}
        showMemberSpacer={
          showMemberPanel ||
          (view === "server" &&
            !activeDm &&
            (activeChannel.type === "voice" ||
              activeChannel.type === "stream"))
        }
        rightSpacerBg={
          view === "server" &&
          !activeDm &&
          (activeChannel.type === "voice" ||
            activeChannel.type === "stream")
            ? // Voice/stream: the right column above is a ChatView
              // which paints bg-dark. Spacer beneath must match.
              "bg-[var(--bg-dark)]"
            : // Text/announcement/etc: right column is MemberList
              // (bg-darker). Default.
              "bg-[var(--bg-darker)]"
        }
        rightSpacerWidth={
          view === "server" &&
          !activeDm &&
          (activeChannel.type === "voice" ||
            activeChannel.type === "stream")
            ? // Voice/stream chat panel was scaled up to 1.75× (567px)
              // per user request — bottom spacer follows so columns
              // stay flush vertically.
              "w-[567px]"
            : "w-[324px]"
        }
        activeServerId={activeServerId}
        selfId={user?.id}
        onJumpToVoice={(sid, cid) => {
          const srv = allServers.find((s) => s.id === sid);
          const flat = (srv?.channels ?? channelCategories).flatMap(
            (c) => c.channels,
          );
          const ch = flat.find((c) => c.id === cid);
          // Prime per-server memory BEFORE swapping server (see
          // navigate-voice listener for rationale).
          if (ch) {
            setChannelByServer((m) => ({ ...m, [sid]: ch }));
            setActiveChannel(ch);
          }
          setActiveServerId(sid);
          setView("server");
          setActiveDm(null);
        }}
      />
    </div>
  );
}

function BottomBarComposer({
  onOpenSecurity,
  onOpenProfile,
  onOpenSystemSettings,
  onAddServer,
  showMemberSpacer,
  rightSpacerBg = "bg-[var(--bg-darker)]",
  rightSpacerWidth = "w-[324px]",
  onJumpToVoice,
  activeServerId,
  selfId,
}: {
  onOpenSecurity: () => void;
  onOpenProfile: () => void;
  onOpenSystemSettings: () => void;
  onAddServer: () => void;
  showMemberSpacer?: boolean;
  /**
   * Background tint for the right-side spacer. Defaults to
   * `bg-darker` (matches the MemberList column above). When the main
   * area's right column is the voice-channel chat (a ChatView, bg-dark)
   * the caller passes `bg-dark` so the spacer continues that column's
   * tone — without this the bottom bar painted bg-darker against a
   * bg-dark chat above, producing the colour break the user reported.
   */
  rightSpacerBg?: string;
  /**
   * Width class for the right-side spacer. Defaults to `w-[324px]`
   * (matches MemberList). Voice/stream channels pass `w-[567px]`
   * so the spacer aligns with the wider voice-mode chat panel.
   */
  rightSpacerWidth?: string;
  onJumpToVoice: (serverId: string, channelId: string) => void;
  activeServerId?: string;
  selfId?: string;
}) {
  const { draft, setDraft, placeholder, disabled, disabledReason, canSetPriority, priority, setPriority } = useComposer();
  // Caret tracked locally so MentionAutocomplete knows where to
  // anchor its candidate list. Updated on every keyup / click /
  // selection change for the desktop textarea.
  const [caret, setCaret] = useState(0);
  const presenceAll = usePresence("global", activeServerId);
  // Memoised — see ChatView for the same fix; without this, every
  // presence heartbeat (every ~10s) re-rendered the whole bottom
  // bar including the autocomplete + overlay.
  const mentionCandidates = useMemo(
    () =>
      activeServerId
        ? presenceAll.filter((u) => u.current_server_id === activeServerId)
        : [],
    [presenceAll, activeServerId],
  );
  const validMentionNames = useMemo(
    () => new Set(mentionCandidates.map((u) => u.username)),
    [mentionCandidates],
  );
  const mentionApiRef = useRef<MentionApi | null>(null);
  // Pulled here so the desktop composer (rendered in this layout) can
  // show the same per-tier mute banner as the mobile composer in
  // ChatView. Without this, muted users saw the generic fallback message
  // instead of who/why/when they were muted.
  const myMute = useMyMute();
  // Voice connection drives an OPTIONAL row above the 72px user/composer
  // row so the leftmost (+), the voice card, and the composer all keep
  // their top edges on the same horizontal line — see the comment in
  // UserPanel explaining why we moved off the absolute-float design.
  const voiceCurrent = useVoice((s) => s.current);
  return (
    <div className="hidden sm:flex shrink-0 flex-col">
      <div className="flex shrink-0">
        {/* 72px server-rail spacer at the absolute bottom of the screen.
            Hosts the create-server (+) button per the user-requested
            layout (image 1: + at bottom). */}
        <div className="w-[90px] shrink-0 bg-[var(--bg-darkest)] border-r border-black/30 flex flex-col justify-end">
          <div className="h-[72px] flex flex-col items-center justify-center gap-1.5">
            <div className="w-8 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/40 to-transparent" />
            <button
              type="button"
              onClick={onAddServer}
              title="创建服务器"
              className="size-12 rounded-xl grid place-items-center bg-[var(--bg-darker)] text-[var(--success)] hover:bg-[var(--success)]/15 hover:rounded-2xl transition-all duration-200 border border-[var(--bg-mid)]"
            >
              <Plus size={22} />
            </button>
          </div>
        </div>
        {/* Left: user card row. The (optional) voice block floats UPWARD
            via absolute positioning inside UserPanel so the bottom bar
            row stays a fixed 72px tall — no black gap above it when the
            voice card appears (image 4 bug). */}
        <div className="w-[324px] shrink-0 flex flex-col justify-end px-2 bg-[var(--bg-darker)]">
          {voiceCurrent ? (
            <div className="mt-2 mb-[6px] rounded-2xl bg-[var(--bg-userbar)] shadow-[0_2px_14px_rgba(0,0,0,0.4)]">
              <VoiceConnectionPanel onJumpTo={onJumpToVoice} embedded />
              <div className="h-[69px] relative">
                <UserPanel
                  onOpenSecurity={onOpenSecurity}
                  onOpenProfile={onOpenProfile}
                  onOpenSystemSettings={onOpenSystemSettings}
                  onJumpToVoice={onJumpToVoice}
                  roundedTop={false}
                />
              </div>
            </div>
          ) : (
            <div className="h-[83px] flex items-center">
              <div className="w-full h-[69px] rounded-2xl bg-[var(--bg-userbar)] shadow-[0_2px_14px_rgba(0,0,0,0.4)] relative">
                <UserPanel
                  onOpenSecurity={onOpenSecurity}
                  onOpenProfile={onOpenProfile}
                  onOpenSystemSettings={onOpenSystemSettings}
                  onJumpToVoice={onJumpToVoice}
                />
              </div>
            </div>
          )}
        </div>
        {/* Center: message composer — same bg as ChatView */}
        {disabled ? (
          <div className="flex-1 flex flex-col justify-end bg-[var(--bg-dark)]"><div className="h-[83px] flex items-center px-4">
            {disabledReason === "muted" && myMute ? (
              <span className="text-sm text-[var(--warning)] truncate">
                ⛔ 你已被{" "}
                <span className="font-semibold">{myMute.muted_by_name}</span>{" "}
                禁言至{" "}
                <span className="font-semibold tabular-nums">
                  {new Date(myMute.expires_at).toLocaleString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "numeric",
                    day: "numeric",
                  })}
                </span>
                ，原因：{myMute.reason}
              </span>
            ) : disabledReason === "guest" ? (
              <span className="text-sm text-[var(--text-muted)]">
                加入公会后即可发送消息              </span>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">
                此频道仅管理员可发布
              </span>
            )}
          </div></div>
        ) : (
          <div className="flex-1 flex flex-col justify-end bg-[var(--bg-dark)] min-w-0"><div className="h-[83px] flex items-stretch gap-2 px-4 py-[6px] min-w-0">
            {/* Inner composer pill — vertical padding bumped from
                py-1.5 to py-3 so the bubble visually fills the 72px
                bottom bar (was: a slim pill floating in a tall row,
                which felt unbalanced against the chunky left-side
                UserPanel). The 72px outer height is unchanged so
                no layout reflow elsewhere. */}
            <div className="flex-1 flex items-center gap-2 bg-[var(--bg-mid)] rounded-lg px-3 min-w-0">
              <button
                type="button"
                className="size-6 grid place-items-center rounded-full bg-[var(--bg-light)] text-[var(--text-muted)] hover:text-white hover:bg-[var(--text-muted)] transition-colors shrink-0"
                title="上传图片"
                onClick={() => composerImageInputRef.current?.click()}
              >
                <Plus size={16} />
              </button>
              <div className="relative flex-1 min-w-0">
                <MentionAutocomplete
                  value={draft}
                  caret={caret}
                  candidates={mentionCandidates}
                  selfId={selfId}
                  onCommit={(newValue, newCaret) => {
                    setDraft(newValue);
                    setCaret(newCaret);
                    requestAnimationFrame(() => {
                      const el = composerTextareaRef.current;
                      if (el) {
                        el.focus();
                        el.setSelectionRange(newCaret, newCaret);
                      }
                    });
                  }}
                  apiRef={mentionApiRef}
                />
                <MentionHighlightOverlay
                  value={draft}
                  validNames={validMentionNames}
                  style={{
                    fontSize: 15,
                    lineHeight: "1.25rem",
                    fontFamily: "inherit",
                  }}
                />
                <textarea
                  ref={(el) => { composerTextareaRef.current = el; }}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setCaret(e.target.selectionStart ?? 0);
                  }}
                  onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                  onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                  onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                  onKeyDown={(e) => {
                    // Autocomplete sees the event FIRST so ArrowDown /
                    // Enter inside the dropdown navigate/commit instead
                    // of moving the caret or sending the message.
                    if (mentionApiRef.current?.handleKeyDown(e)) return;
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      document.dispatchEvent(new CustomEvent("fl:send"));
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
                        requestAnimationFrame(() => {
                          try {
                            ta.setSelectionRange(r.caret, r.caret);
                          } catch { /* element may have unmounted */ }
                        });
                      }
                    }
                  }}
                  placeholder={placeholder}
                  rows={1}
                  // Text is rendered transparent so the underlying
                  // MentionHighlightOverlay shows through; caret-color
                  // keeps the cursor visible. Selection still uses
                  // the browser's native highlight layer.
                  className="relative w-full bg-transparent resize-none focus:outline-none text-[15px] text-transparent caret-white placeholder:text-[var(--text-muted)] max-h-32 leading-5"
                />
              </div>
              <div className="flex items-center gap-2 text-[var(--text-muted)] shrink-0">
                {canSetPriority && (
                  <button
                    type="button"
                    title={
                      priority === "high"
                        ? "已开启全站推送 — 所有在线用户会看到浮窗提醒"
                        : "开启全站推送 — 此条公告推送给所有在线用户"
                    }
                    onClick={() =>
                      setPriority(priority === "high" ? "normal" : "high")
                    }
                    className={
                      priority === "high"
                        ? "text-[10px] font-semibold px-2 h-6 rounded-full bg-[var(--danger)]/20 text-[var(--danger)] ring-1 ring-[var(--danger)]/50 transition-colors"
                        : "text-[10px] font-semibold px-2 h-6 rounded-full bg-[var(--bg-light)] text-[var(--text-muted)] hover:text-white transition-colors"
                    }
                  >
                    {priority === "high" ? "全站推送 ✓" : "全站推送"}
                  </button>
                )}
                <Tooltip label="@提及成员">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((d) => d + "@");
                      setTimeout(() => composerTextareaRef.current?.focus(), 0);
                    }}
                    className="hover:text-white transition-colors"
                  >
                    <AtSign size={22} />
                  </button>
                </Tooltip>
                <InteractionMenu
                  onPost={(text) => {
                    // Route through ChatView's send() via custom
                    // event so the dice/RPS/roll result goes through
                    // the same optimistic-insert + dedup path as
                    // regular messages.
                    document.dispatchEvent(
                      new CustomEvent("fl:send-text", {
                        detail: { text },
                      }),
                    );
                  }}
                />
              </div>
            </div>
          </div></div>
        )}
        {/* Right: spacer aligns with the main area's right column.
            When that column is a MemberList it's bg-darker; when
            it's a voice-channel chat it's bg-dark. The caller
            supplies the right tint via `rightSpacerBg` so this
            vertical edge doesn't visibly break colour. */}
        {showMemberSpacer && (
          <div
            className={cn(
              "shrink-0",
              rightSpacerWidth,
              rightSpacerBg,
              // Voice/stream channels show a ChatView on the right (w-[567px]);
              // extend the same vertical divider from above (bg-[var(--bg-mid)])
              // through the bottom bar so the line covers the full height.
              rightSpacerWidth === "w-[567px]" && "border-l border-[var(--bg-mid)]",
            )}
          />
        )}
      </div>
    </div>
  );
}
