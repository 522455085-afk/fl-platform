"use client";

import { Users, Plus, Mic, MapPin, Shield, Menu, X, LogOut, Trash2, Loader2, DoorOpen, Share2, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, type DbParty, type PartyMember } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import { canModerateServer } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit-log";
import StaffBadge, { staffNameClass } from "@/components/AdminBadge";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import {
  claimOccupation,
  releaseOccupation,
  onOccupationLost,
} from "@/lib/occupation";
import { DEVICE_LABEL } from "@/lib/device-type";
import { useRooms, type Room } from "@/lib/rooms-store";
import { useVoice } from "@/lib/voice-store";
import { useAllServers } from "@/lib/servers-store";
import { prompt } from "@/lib/prompt-store";
import { confirm, alert } from "@/lib/confirm-store";

const DIFFICULTY_COLOR: Record<DbParty["difficulty"], string> = {
  普通: "#6db26d",
  困难: "#e8b04a",
  // 噩梦 retained as a fallback for legacy rows; new parties can only
  // pick 普通 / 困难 (the only difficulties exposed in the create modal).
  噩梦: "#c64b3e",
};

const MAPS = ["遗忘者地牢"];

export default function PartyView({
  channelName,
  onOpenNav,
  serverId = "global",
  requireGate,
}: {
  channelName: string;
  onOpenNav?: () => void;
  serverId?: string;
  /** Returns true if user passes the gate; otherwise opens Security Center. */
  requireGate?: () => boolean;
}) {
  // Dev preview: append `?ghost=N` to the URL to inject N fake parties so
  // you can preview the grid layout without manufacturing real DB rows.
  // The fake parties carry a `__ghost` flag (untyped — local only) and
  // are concatenated AFTER the real list so they don't interfere with
  // realtime / poll merges.
  const ghostParties = useGhostParties(serverId);

  const [parties, setParties] = useState<DbParty[]>([]);
  // No `loading` gate: rendering an empty list immediately is much
  // faster perceived UX than blocking the whole view behind a spinner
  // while the initial fetch round-trips Supabase. New rows pop in via
  // the realtime/poll handlers below as they arrive.
  const [hydrated, setHydrated] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const { user } = useAuth();
  // "强解" power: founder/admin anywhere, mod only in the official
  // server. We check against the current serverId so mod permissions
  // don't leak into user-created servers.
  const canForceDisbandHere = canModerateServer(user?.id, serverId);

  useEffect(() => {
    let mounted = true;

    supabase
      .from("parties")
      .select("*")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.warn("[parties] load failed:", error);
          // Permission failures are the #1 cause of "我创建的队伍别人看
          // 不见" — surface a hint so it's not swallowed silently.
          if (/permission|denied|forbidden|unauthor|access/i.test(error.message || "")) {
            console.warn(
              "[parties] CloudBase rejected the read. Open the parties collection's permissions and set «所有用户可读，仅创建者可写» (or 登录用户可读写).",
            );
          }
        }
        const rows = (data || []) as DbParty[];
        console.log(`[parties] loaded ${rows.length} rows for server_id=${serverId} (uid=${user?.id ?? "?"})`);
        setParties(rows);
        setHydrated(true);
      });

    // Polling fallback: CloudBase realtime UPDATE events can be flaky
    // on jsonb-array writes. Re-fetch every 5s so the leader always
    // sees new joiners within at most one tick even if realtime drops
    // an event.
    const poll = setInterval(() => {
      if (!mounted) return;
      supabase
        .from("parties")
        .select("*")
        .eq("server_id", serverId)
        .order("created_at", { ascending: false })
        .limit(100)
        .then(({ data, error }) => {
          if (!mounted || error) return;
          setParties((data || []) as DbParty[]);
        });
    }, 60_000);

    const channel = supabase
      .channel(`parties:${serverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "parties", filter: `server_id=eq.${serverId}` },
        (payload) => {
          if (!mounted) return;
          if (payload.eventType === "INSERT") {
            const row = payload.new as DbParty;
            setParties((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as DbParty;
            setParties((prev) => prev.filter((p) => p.id !== row.id));
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as DbParty;
            setParties((prev) => prev.map((p) => (p.id === row.id ? row : p)));
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // We intentionally only re-run on serverId change — including
    // `user?.id` would tear down the realtime subscription on every
    // login state ripple, and the user id is only used for a debug log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  // ----------------------------------------------------------------
  // Deep-link auto-join: ONLY respect the localStorage stash when the
  // current URL actually carries a ?party= param, OR when the live
  // `fl:auto-join-party` event fires. Otherwise navigating into the
  // 组队大厅 in a normal session would replay the last deep-link and
  // briefly yank the user back into their previous party's voice room
  // (user-reported "短暂的回到上一次所在的房间" bug).
  // ----------------------------------------------------------------
  const [pendingJoinId, setPendingJoinId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("party")) {
      // Clean up any stale stash so subsequent mounts don't replay it.
      window.localStorage.removeItem("fl_pending_party_join");
      return null;
    }
    return window.localStorage.getItem("fl_pending_party_join");
  });

  useEffect(() => {
    const onAutoJoin = (e: Event) => {
      const detail = (e as CustomEvent<{ partyId: string }>).detail;
      if (detail?.partyId) setPendingJoinId(detail.partyId);
    };
    document.addEventListener("fl:auto-join-party", onAutoJoin);
    return () => document.removeEventListener("fl:auto-join-party", onAutoJoin);
  }, []);

  // Space helpers — either a recruitment room (rooms-store) OR a voice
  // channel (voice-store) on this server qualifies as “being in a room”
  // for party-recruitment purposes.
  const localRooms = useRooms((s) => s.rooms);
  const upsertRoom = useRooms((s) => s.upsertRoom);
  const joinRoomLocal = useRooms((s) => s.joinRoom);
  const voiceCurrent = useVoice((s) => s.current);
  const joinVoice = useVoice((s) => s.join);
  const localRoom: Room | undefined = user
    ? localRooms.find(
        (r) => r.serverId === serverId && r.occupants.includes(user.id),
      )
    : undefined;
  const voiceOnThisServer =
    voiceCurrent && voiceCurrent.serverId === serverId ? voiceCurrent : null;
  // Look up the actual voice-channel definition so we can read its
  // `maxOccupants` cap (the "01/03" you see in ChannelSidebar). The
  // voice-store only carries channelId+channelName — without this
  // lookup the create-party dialog defaulted to a hardcoded 99 cap
  // (user report: "创建的队伍没有读取对应频道的人数").
  const allServers = useAllServers();
  const voiceChannelMaxOccupants = useMemo<number | null>(() => {
    if (!voiceOnThisServer) return null;
    const srv = allServers.find((s) => s.id === voiceOnThisServer.serverId);
    if (!srv) return null;
    for (const cat of srv.channels ?? []) {
      const ch = cat.channels.find((c) => c.id === voiceOnThisServer.channelId);
      if (ch) return ch.maxOccupants ?? null;
    }
    return null;
  }, [allServers, voiceOnThisServer]);

  // Debug telemetry: print the resolved "current space" so we can tell
  // whether the create-party button being disabled is caused by (a) no
  // local room, (b) voice on a *different* server, or (c) no voice/room
  // at all. Fires once per render, cheap.
  useEffect(() => {
    console.log("[party] myCurrentSpace check", {
      serverId,
      uid: user?.id,
      voiceCurrent: voiceCurrent
        ? { serverId: voiceCurrent.serverId, channelId: voiceCurrent.channelId }
        : null,
      voiceOnThisServer: !!voiceOnThisServer,
      localRoom: localRoom
        ? { id: localRoom.id, serverId: localRoom.serverId, name: localRoom.name }
        : null,
    });
  }, [serverId, user?.id, voiceCurrent, voiceOnThisServer, localRoom]);
  // Unified "current space" — prefer an explicit recruitment room over
  // voice if the user happens to be in both.
  const myCurrentSpace: {
    kind: "room" | "voice";
    id: string;
    name: string;
    maxCapacity: number;
  } | null = localRoom
    ? {
        kind: "room",
        id: localRoom.id,
        name: localRoom.name,
        maxCapacity: localRoom.maxCapacity,
      }
    : voiceOnThisServer
      ? {
          kind: "voice",
          id: voiceOnThisServer.channelId,
          name: voiceOnThisServer.channelName,
          // Read from the channel definition (maxOccupants — same
          // number ChannelSidebar prints as the "/03" denominator
          // in 01/03). Falls back to 25 (the default echoed by
          // ChannelSidebar) if the channel was created before
          // maxOccupants was added.
          maxCapacity: voiceChannelMaxOccupants ?? 25,
        }
      : null;

  const handleJoin = async (party: DbParty) => {
    if (!user) return;
    if (party.members.some((m) => m.user_id === user.id)) {
      console.log("[party] already a member — skipping join", party.id);
      return;
    }
    if (party.members.length >= party.max_size) {
      void alert("队伍已满");
      return;
    }
    console.log("[party] handleJoin start", {
      partyId: party.id,
      room_kind: party.room_kind,
      room_id: party.room_id,
      room_name: party.room_name,
      server_id: party.server_id,
      voice_required: party.voice_required,
      uid: user.id,
    });

    // If the party is linked to a space, route the joiner there.
    // - kind="voice" → hop the joiner into the voice channel
    //   (voice-store auto-disconnects them from any other voice room first)
    //   AND navigate the main view to that voice channel so they land in
    //   the grid of occupants (user-reported "无法进入队伍的房间" bug).
    // - kind="room"  → mirror the room into rooms-store and occupy a slot.
    if (party.room_id && party.room_name) {
      if (party.room_kind === "voice") {
        joinVoice({
          serverId: party.server_id,
          channelId: party.room_id,
          channelName: party.room_name,
        });
        // Notify the shell to switch the active server + channel so the
        // joiner actually lands on the voice-channel page.
        if (typeof document !== "undefined") {
          document.dispatchEvent(
            new CustomEvent("fl:navigate-voice", {
              detail: {
                serverId: party.server_id,
                channelId: party.room_id,
              },
            }),
          );
        }
      } else {
        upsertRoom({
          id: party.room_id,
          serverId: party.server_id,
          name: party.room_name,
          maxCapacity: party.room_max_capacity ?? 5,
          occupants: [],
        });
        const ok = joinRoomLocal(party.room_id, user.id);
        if (!ok) {
          void alert(`招募房间「${party.room_name}」已满，无法加入。`);
          return;
        }
      }
    }

    // Voice-required parties count as a real-time activity. Per
    // single-end occupation policy (Q2-4): a user can only be in one
    // voice/stream/party at a time, GLOBALLY across their devices.
    // Text-only parties skip this check entirely.
    if (party.voice_required) {
      let result = await claimOccupation(user.id, "party", party.id);
      if (!result.ok && "conflict" in result) {
        const dev = DEVICE_LABEL[result.conflict.device_type] || "另一端";
        const ok = await confirm(
          `你正在 ${dev} 使用语音/直播功能。是否切换到此设备？\n切换后另一端会自动退出。`,
        );
        if (!ok) return;
        result = await claimOccupation(user.id, "party", party.id, {
          force: true,
        });
      }
      if (!result.ok) {
        void alert("无法占用语音通道：" + (("error" in result && result.error) || result.reason));
        return;
      }
    }

    const newMembers: PartyMember[] = [
      ...party.members,
      { user_id: user.id, user_name: user.username },
    ];
    const { error } = await supabase
      .from("parties")
      .update({ members: newMembers })
      .eq("id", party.id);
    if (error) {
      // Surface the full CloudBase error so we can diagnose permission
      // rule problems (the most common cause of "only the leader can
      // join" symptom on user-created parties).
      console.error("[party] join failed:", {
        partyId: party.id,
        leaderId: party.leader_id,
        userId: user.id,
        error,
      });
      if (party.voice_required) {
        try {
          await releaseOccupation(user.id);
        } catch {
          /* ignore */
        }
      }
      const msg = error.message || "未知错误";
      const isPermission = /permission|denied|forbidden|unauthor|access/i.test(msg);
      void alert(
        isPermission
          ? `加入失败：云数据库拒绝了这次写入。\n请在 CloudBase 控制台为 parties 集合开启「登录用户可读写」权限。\n\n错误详情：${msg}`
          : `加入失败：${msg}`,
      );
      return;
    }
    // Optimistically merge so the UI reflects membership immediately;
    // realtime will echo back and reconcile.
    setParties((prev) =>
      prev.map((p) => (p.id === party.id ? { ...p, members: newMembers } : p)),
    );
  };

  const handleLeave = async (party: DbParty) => {
    if (!user) return;
    const newMembers = party.members.filter((m) => m.user_id !== user.id);
    const { error } = await supabase
      .from("parties")
      .update({ members: newMembers })
      .eq("id", party.id);
    if (error) {
      console.error("[party] leave failed:", error);
      void alert("退出失败：" + error.message);
      return;
    }
    setParties((prev) =>
      prev.map((p) => (p.id === party.id ? { ...p, members: newMembers } : p)),
    );
    if (party.voice_required) {
      try {
        await releaseOccupation(user.id);
      } catch (e) {
        console.warn("[party] releaseOccupation failed:", e);
      }
    }
  };

  // If another device of ours took over the voice/stream/party slot, we
  // lose our occupation. Auto-leave any voice-required parties we're in
  // so the UI matches the truth.
  useEffect(() => {
    if (!user) return;
    const off = onOccupationLost(() => {
      const myActiveVoiceParty = parties.find(
        (p) =>
          p.voice_required && p.members.some((m) => m.user_id === user.id),
      );
      if (!myActiveVoiceParty) return;
      console.warn(
        "[party] occupation lost, auto-leaving voice party",
        myActiveVoiceParty.id,
      );
      const newMembers = myActiveVoiceParty.members.filter(
        (m) => m.user_id !== user.id,
      );
      void supabase
        .from("parties")
        .update({ members: newMembers })
        .eq("id", myActiveVoiceParty.id);
    });
    return () => {
      off();
    };
  }, [user, parties]);

  // Drain pendingJoinId once the matching party row is in state.
  // The actual mutation runs in an async tick so the synchronous body
  // of the effect doesn't trigger react-hooks/set-state-in-effect; the
  // cancellation guard prevents a fast unmount-after-mount from acting
  // on stale data.
  useEffect(() => {
    if (!pendingJoinId || !user || !hydrated) return;
    const target = parties.find((p) => p.id === pendingJoinId);
    if (!target) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      // Clear stash + state BEFORE awaiting so we can't re-fire.
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("fl_pending_party_join");
      }
      setPendingJoinId(null);
      if (target.members.some((m) => m.user_id === user.id)) return;
      await handleJoin(target);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJoinId, parties, user, hydrated]);

  const handleDelete = async (party: DbParty) => {
    // Ghost preview parties (`?ghost=N`) are local-only — no DB row to
    // delete. Just visually remove them so the admin "强解" button
    // remains useful for layout testing.
    if (party.id.startsWith("__ghost__")) {
      setParties((prev) => prev.filter((p) => p.id !== party.id));
      return;
    }
    const isAdminAction =
      !!user && party.leader_id !== user.id && canForceDisbandHere;
    const prompt = isAdminAction
      ? `主教强制解散「${party.name}」（队长：${party.leader_name}）？`
      : "确认解散队伍？";
    if (!(await confirm(prompt))) return;
    // Optimistic removal: Supabase Realtime DELETE events with a filter
    // can be dropped (the WAL payload omits filterable columns unless
    // the table has REPLICA IDENTITY FULL), and the 5s polling fallback
    // is too slow. Strip the row locally first.
    setParties((prev) => prev.filter((p) => p.id !== party.id));
    const { error } = await supabase.from("parties").delete().eq("id", party.id);
    if (error) {
      void alert("解散失败：" + error.message);
      // Rollback if delete actually failed.
      setParties((prev) => (prev.some((p) => p.id === party.id) ? prev : [party, ...prev]));
      return;
    }
    if (isAdminAction && user) {
      recordAuditEvent({
        actor_id: user.id,
        actor_name: user.username,
        action: "force_disband_party",
        target_type: "party",
        target_id: party.id,
        target_label: `${party.name} / 队长 ${party.leader_name}`,
      });
    }
  };

  // Listen for global party deletions (e.g. usePartyAutoLeave's
  // disband-on-voice-switch) so the list updates instantly without
  // waiting on realtime/poll round-trip.
  useEffect(() => {
    const onLocalDelete = (e: Event) => {
      const detail = (e as CustomEvent<{ partyId: string }>).detail;
      if (!detail?.partyId) return;
      setParties((prev) => prev.filter((p) => p.id !== detail.partyId));
    };
    document.addEventListener("fl:party-deleted", onLocalDelete);
    return () => document.removeEventListener("fl:party-deleted", onLocalDelete);
  }, []);

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-[var(--bg-dark)]">
      <header className="h-14 px-4 flex items-center gap-3 border-b border-black/30 shadow-sm shrink-0">
        {onOpenNav && (
          <button
            onClick={onOpenNav}
            className="md:hidden size-8 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
            aria-label="打开频道列表"
          >
            <Menu size={20} />
          </button>
        )}
        <Users size={20} className="text-[var(--accent)] shrink-0" />
        <h2 className="font-semibold text-white truncate">{channelName}</h2>
        <span className="hidden md:block w-px h-6 bg-[var(--bg-mid)] mx-1" />
        <span className="hidden md:block text-sm text-[var(--text-muted)]">
          创建队伍或加入现有队伍
        </span>
        {myCurrentSpace ? (
          <span className="hidden md:flex items-center gap-1 ml-auto mr-2 text-[12px] text-[var(--text-muted)]">
            <DoorOpen size={13} className="text-[var(--accent)]" />
            招募中：<span className="text-white font-medium">{myCurrentSpace.name}</span>
          </span>
        ) : (
          <span className="hidden md:flex items-center gap-1 ml-auto mr-2 text-[12px] text-[var(--warning)] italic">
            不在房间中 · 无法创建队伍
          </span>
        )}
        <button
          onClick={() => {
            if (requireGate && !requireGate()) return;
            if (!myCurrentSpace) {
              void alert("你需要先加入一个招募房间或语音频道才能创建队伍。");
              return;
            }
            setShowCreate(true);
          }}
          disabled={!myCurrentSpace}
          className={cn(
            "text-sm font-semibold px-3 py-1.5 rounded flex items-center gap-1.5 shrink-0",
            myCurrentSpace
              ? "ml-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325]"
              : "ml-0 bg-[var(--bg-mid)] text-[var(--text-muted)] cursor-not-allowed opacity-60",
          )}
        >
          <Plus size={16} />
          <span className="hidden sm:inline">创建队伍</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {parties.length === 0 && ghostParties.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] mt-20">
            <p className="mb-2">暂无队伍</p>
            <button
              onClick={() => {
                if (requireGate && !requireGate()) return;
                if (!myCurrentSpace) {
                  void alert("你需要先加入一个招募房间或语音频道才能创建队伍。");
                  return;
                }
                setShowCreate(true);
              }}
              className="text-[var(--accent)] hover:underline text-sm"
            >
              创建第一支队伍
            </button>
          </div>
        ) : (
          // Fixed-size cards (~378px = 280px × 1.35 per user
          // request) with `auto-fill` so the grid always packs 4-5
          // cards per row on typical desktop widths and leaves
          // empty slots on the right when there are too few. The
          // earlier `minmax(280px, 1fr)` stretched a single card
          // edge-to-edge once it was alone in a row.
          <div
            className="grid gap-4 justify-start"
            style={{ gridTemplateColumns: "repeat(auto-fill, 378px)" }}
          >
            {[...parties, ...ghostParties].map((p) => (
              <PartyCard
                key={p.id}
                party={p}
                isLeader={user?.id === p.leader_id}
                isMember={!!user && p.members.some((m) => m.user_id === user.id)}
                isPlatformAdmin={canForceDisbandHere}
                onJoin={() => handleJoin(p)}
                onLeave={() => handleLeave(p)}
                onDelete={() => handleDelete(p)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && myCurrentSpace && (
        <CreatePartyModal
          serverId={serverId}
          space={myCurrentSpace}
          onClose={() => setShowCreate(false)}
        />
      )}
    </section>
  );
}

function PartyCard({
  party,
  isLeader,
  isMember,
  isPlatformAdmin,
  onJoin,
  onLeave,
  onDelete,
}: {
  party: DbParty;
  isLeader: boolean;
  isMember: boolean;
  /** Platform admin can force-disband any party (overrides leader-only). */
  isPlatformAdmin?: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const full = party.members.length >= party.max_size;
  const diffColor = DIFFICULTY_COLOR[party.difficulty];
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/?party=${party.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await prompt("复制以下链接分享给伙伴：", url);
    }
  };

  return (
    <article className="bg-[var(--bg-darker)] rounded-lg p-3 md:p-4 hover:bg-[var(--bg-mid)]/50 transition-colors border border-[var(--bg-mid)] min-w-0">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate mb-1">{party.name}</h3>
          <div className="text-xs text-[var(--text-muted)] flex items-center gap-1 min-w-0 whitespace-nowrap">
            <span className="truncate min-w-0">
              队长：
              <span className={cn(staffNameClass(party.leader_id))}>
                {party.leader_name}
              </span>
            </span>
            <StaffBadge userId={party.leader_id} size={11} className="shrink-0" />
          </div>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
          style={{ background: `${diffColor}22`, color: diffColor }}
        >
          {party.difficulty}
        </span>
      </div>

      <div className="flex items-center gap-3 text-sm text-[var(--text-muted)] mb-3 flex-wrap">
        <span className="flex items-center gap-1">
          <MapPin size={14} />
          {party.map}
        </span>
        {party.room_name && (
          <span className="flex items-center gap-1 text-[var(--magic)]">
            <DoorOpen size={14} />
            {party.room_name}
          </span>
        )}
        {party.voice_required && (
          <span className="flex items-center gap-1 text-[var(--accent)]">
            <Mic size={14} />
            需开麦
          </span>
        )}
      </div>

      {party.note && (
        <p className="text-sm text-[var(--text-normal)] bg-[var(--bg-darkest)] rounded p-2 mb-3 break-words">
          {party.note}
        </p>
      )}

      {party.members.length > 0 && (
        <div className="text-xs text-[var(--text-muted)] mb-3 flex flex-wrap gap-1">
          {party.members.map((m) => (
            <span
              key={m.user_id}
              className="bg-[var(--bg-darkest)] px-2 py-0.5 rounded"
            >
              {m.user_name}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Shield size={16} className="text-[var(--text-muted)] shrink-0" />
          <span className="text-sm font-semibold text-white shrink-0">
            {party.members.length} / {party.max_size}
          </span>
          {/* Capacity pips only render when there's room — below a
              4-slot card these add visual noise without fitting. */}
          <div className="hidden sm:flex gap-0.5 flex-wrap">
            {Array.from({ length: party.max_size }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-2 rounded-full",
                  i < party.members.length ? "bg-[var(--success)]" : "bg-[var(--bg-darkest)]",
                )}
              />
            ))}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0 ml-auto">
          <button
            onClick={handleShare}
            title={copied ? "已复制链接" : "分享队伍链接"}
            className={cn(
              "text-sm font-semibold px-2.5 py-1.5 rounded flex items-center gap-1 transition-colors",
              copied
                ? "bg-[var(--success)]/20 text-[var(--success)]"
                : "bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-[var(--text-muted)] hover:text-white",
            )}
          >
            {copied ? <Check size={14} /> : <Share2 size={14} />}
          </button>
          {isLeader ? (
            <button
              onClick={onDelete}
              className="text-sm font-semibold px-3 py-1.5 rounded bg-[var(--danger)]/20 hover:bg-[var(--danger)]/40 text-[var(--danger)] flex items-center gap-1"
            >
              <Trash2 size={14} />
              解散
            </button>
          ) : isPlatformAdmin ? (
            <button
              onClick={onDelete}
              title="主教强制解散"
              className="text-sm font-semibold px-3 py-1.5 rounded bg-[var(--danger)]/30 hover:bg-[var(--danger)]/50 text-[var(--danger)] flex items-center gap-1 ring-1 ring-[var(--danger)]/40"
            >
              <Trash2 size={14} />
              强解
            </button>
          ) : isMember ? (
            <button
              onClick={onLeave}
              className="text-sm font-semibold px-3 py-1.5 rounded bg-[var(--bg-light)] hover:bg-[var(--bg-mid)] text-white flex items-center gap-1"
            >
              <LogOut size={14} />
              退出
            </button>
          ) : (
            <button
              onClick={onJoin}
              disabled={full}
              className={cn(
                "text-sm font-semibold px-4 py-1.5 rounded transition-colors",
                full
                  ? "bg-[var(--bg-light)] text-[var(--text-muted)] cursor-not-allowed"
                  : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325]",
              )}
            >
              {full ? "队伍已满" : "加入"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function CreatePartyModal({
  serverId,
  space,
  onClose,
}: {
  serverId: string;
  space: {
    kind: "room" | "voice";
    id: string;
    name: string;
    maxCapacity: number;
  };
  onClose: () => void;
}) {
  const { user } = useAuth();
  const backdrop = useDismissOnBackdrop(onClose);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Hard double-submit guard: React's `disabled={submitting}` reacts on
  // the next render, but a fast double-click can fire both events
  // BEFORE the re-render lands, producing two duplicate parties. The
  // ref synchronously rejects the second call inside the same tick.
  const inFlightRef = useRef(false);
  const [form, setForm] = useState({
    name: "",
    map: MAPS[0],
    difficulty: "普通" as DbParty["difficulty"],
    max_size: 3,
    voice_required: false,
    note: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (inFlightRef.current) return;
    if (!form.name.trim()) return setErr("请填写队伍名");
    inFlightRef.current = true;
    setSubmitting(true);
    setErr(null);

    // Server-side guard against duplicate parties: even if the UI race
    // somehow lets a second submit through, refuse to insert if the
    // user is already leading an active party. We check the live DB
    // (not local state) so a stale optimistic cache doesn't fool us.
    const { data: existing } = await supabase
      .from("parties")
      .select("id")
      .eq("leader_id", user.id)
      .limit(1);
    if (existing && existing.length > 0) {
      inFlightRef.current = false;
      setSubmitting(false);
      setErr("你已经有一支正在招募的队伍。请先解散后再创建。");
      return;
    }

    const initialMembers: PartyMember[] = [{ user_id: user.id, user_name: user.username }];

    const payload = {
      server_id: serverId,
      leader_id: user.id,
      leader_name: user.username,
      name: form.name.trim(),
      map: form.map,
      difficulty: form.difficulty,
      max_size: form.max_size,
      voice_required: form.voice_required,
      note: form.note.trim() || null,
      members: initialMembers,
      // Room linkage — stored denormalized so cross-client display
      // works without sharing the rooms localStorage.
      room_id: space.id,
      room_name: space.name,
      room_max_capacity: space.maxCapacity,
      room_kind: space.kind,
    };
    console.log("[party] CreatePartyModal.submit payload:", payload);
    const { error } = await supabase.from("parties").insert(payload);
    setSubmitting(false);
    inFlightRef.current = false;
    if (error) {
      console.error("[party] create FAILED:", error, "payload was:", payload);
      setErr(error.message);
      return;
    }
    console.log("[party] create OK", { id: payload.room_id, name: payload.name });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70" {...backdrop}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--text-bright)]">创建队伍</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <Field label="队伍名">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例：暮光速通 — 求治疗一名"
            className="modal-input"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="地图">
            <select
              value={form.map}
              onChange={(e) => setForm({ ...form, map: e.target.value })}
              className="modal-input"
            >
              {MAPS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="难度">
            <select
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value as DbParty["difficulty"] })}
              className="modal-input"
            >
              <option value="普通">普通</option>
              <option value="困难">困难</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="人数上限">
            <input
              type="number"
              min={2}
              max={50}
              value={form.max_size}
              onChange={(e) => setForm({ ...form, max_size: parseInt(e.target.value) || 3 })}
              className="modal-input"
            />
          </Field>
          <label className="flex items-center gap-2 mt-6 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={form.voice_required}
              onChange={(e) => setForm({ ...form, voice_required: e.target.checked })}
              className="size-4 accent-[var(--accent)]"
            />
            <span className="text-sm text-[var(--text-normal)]">需开麦</span>
          </label>
        </div>

        <Field label="备注（选填）">
          <textarea
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="例：求一治疗 + 一坦克，会打的来"
            rows={3}
            className="modal-input resize-none"
          />
        </Field>

        {err && <div className="text-sm text-[var(--danger)]">{err}</div>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 h-10 rounded-md bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] hover:shadow-[0_0_20px_var(--accent-glow)] text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            创建
          </button>
        </div>

        <style jsx>{`
          .modal-input {
            width: 100%;
            height: 38px;
            padding: 0 10px;
            border-radius: 6px;
            background: var(--bg-darkest);
            color: white;
            border: 1px solid var(--bg-mid);
            font-size: 14px;
          }
          textarea.modal-input {
            height: auto;
            padding: 8px 10px;
          }
          .modal-input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 10px var(--accent-glow);
          }
        `}</style>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]/80 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

// ----------------------------------------------------------------------------
// Dev preview: ghost parties for layout testing.
//   ?ghost=5  → inject 5 fake party cards into the grid (read-only).
// The fake parties are NOT written to the DB and never appear to other users.
// ----------------------------------------------------------------------------
function useGhostParties(serverId: string): DbParty[] {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      const n = parseInt(
        new URL(window.location.href).searchParams.get("ghost") || "0",
        10,
      );
      setCount(Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 0);
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return useMemo(() => {
    if (count <= 0) return [];
    const NAMES = ["夜行突击", "霜烬执行", "黄金商队护航", "新人引路", "幻影试炼", "极地侦察", "暮色守望", "灵翼远征"];
    const MAPS_LOCAL = ["长弓溪谷", "零号大坝", "巴克什", "航天基地", "潮汐监狱", "刀锋山脉"];
    const DIFFS: DbParty["difficulty"][] = ["普通", "困难", "噩梦"];
    const out: DbParty[] = [];
    for (let i = 0; i < count; i++) {
      const max = 3 + (i % 4);
      const filled = 1 + (i % max);
      const members: PartyMember[] = Array.from({ length: filled }, (_, k) => ({
        user_id: `ghost-${i}-${k}`,
        user_name: k === 0 ? `幽灵队长${i + 1}` : `幽灵${i + 1}-${k}`,
      }));
      out.push({
        id: `__ghost__-${i}`,
        server_id: serverId,
        leader_id: `ghost-${i}-0`,
        leader_name: members[0].user_name,
        name: `${NAMES[i % NAMES.length]} #${i + 1}`,
        map: MAPS_LOCAL[i % MAPS_LOCAL.length],
        difficulty: DIFFS[i % DIFFS.length],
        max_size: max,
        voice_required: i % 2 === 0,
        note: i % 3 === 0 ? "求带，新人一枚" : null,
        members,
        room_id: null,
        room_name: null,
        room_max_capacity: null,
        room_kind: null,
        // eslint-disable-next-line react-hooks/purity -- ghost dev preview only
        created_at: new Date(Date.now() - i * 60_000).toISOString(),
      } as unknown as DbParty);
    }
    return out;
  }, [count, serverId]);
}
