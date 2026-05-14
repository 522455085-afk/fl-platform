"use client";

import {
  Volume2,
  Radio,
  Menu,
  MicOff,
  UserX,
  Users,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useVoice } from "@/lib/voice-store";
import { useAuth } from "@/lib/auth-store";
import { usePresence, type PresenceUser } from "@/lib/use-presence";
import { cn } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import StaffBadge, { staffNameClass } from "@/components/AdminBadge";
import { canModerateServer, isAnyStaffId } from "@/lib/roles";
import { sendKickSignal } from "@/lib/force-kick";
import { useMicLevel } from "@/lib/use-mic-level";
import NotificationBell from "@/components/NotificationBell";
import { confirm, alert } from "@/lib/confirm-store";

/**
 * Voice / stream channel page. The user is *not* joined just by visiting
 * this page — they double-click the channel in the sidebar to join, and
 * the connection persists across channel switches.
 *
 * The page itself shows a grid of occupant tiles (image 3-style):
 * each tile = one connected user. The current speaker's tile gets a
 * green outer glow. Mic-off users show a small mic-off badge.
 */
export default function VoiceChannelView({
  serverId,
  channelId,
  channelName,
  channelType,
  onOpenNav,
}: {
  serverId: string;
  channelId: string;
  channelName: string;
  channelType: "voice" | "stream";
  onOpenNav?: () => void;
}) {
  const { user } = useAuth();
  const current = useVoice((s) => s.current);
  const muted = useVoice((s) => s.muted);
  // Connection check: channelId is the canonical match. serverId may
  // legitimately differ (e.g. voice-store stores the presence-room id
  // while this page receives activeServerId), so we don't insist on it
  // for "am I in THIS voice channel?" purposes.
  const connectedHere = !!current && current.channelId === channelId;

  // Real microphone capture for the *local* speaking outline. Other
  // occupants' speaking status would require a real WebRTC pipeline;
  // for now they render with a static frame.
  const { level } = useMicLevel(connectedHere && !muted);
  const localSpeaking = connectedHere && !muted && level > 0.08;

  // Pull the global presence list and filter to users currently in
  // THIS voice channel. Channel IDs are unique across servers (mock-data
  // uses `voice-<nnn>` ids) so matching on channelId alone is safe and
  // avoids false negatives when a client's voice_server_id lag-echoes.
  const presenceUsers = usePresence("global");
  const occupants: PresenceUser[] = presenceUsers.filter(
    (p) => p.voice_channel_id === channelId,
  );
  // If we're connected here but presence sync hasn't echoed our row yet,
  // synthesize a placeholder so the grid never shows empty for ourselves.
  const haveSelf = !!user && occupants.some((p) => p.user_id === user.id);
  if (connectedHere && user && !haveSelf) {
    occupants.unshift({
      user_id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatar_color: user.avatarColor,
      avatar_url: user.avatarUrl ?? null,
      voice_channel_id: channelId,
      voice_server_id: serverId,
      online_at: new Date().toISOString(),
    });
  }

  const isVoice = channelType === "voice";
  const Icon = isVoice ? Volume2 : Radio;

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-[var(--bg-dark)]">
      {/* Header — same dimensions as ChatView for visual consistency */}
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
        <Icon size={24} className="text-[var(--accent)] shrink-0" />
        <h2 className="font-semibold text-white truncate text-[18px]">{channelName}</h2>
        <span className="text-sm text-[var(--text-muted)] shrink-0">
          · {occupants.length} 在线
        </span>
        {/* Right-side actions — mirrors the normal ChatView header (image 2
            style) so the voice channel header looks like any other channel. */}
        <div className="ml-auto flex items-center gap-2 md:gap-3 text-[var(--text-muted)]">
          <NotificationBell className="hidden md:block" />
          <button
            type="button"
            className="hidden md:grid size-8 place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)] transition-colors"
            title="成员列表"
          >
            <Users size={20} />
          </button>
          <div className="hidden md:flex items-center bg-[var(--bg-darkest)] rounded h-7 px-2 w-44">
            <input
              placeholder="搜索"
              className="flex-1 bg-transparent text-sm placeholder:text-[var(--text-muted)] focus:outline-none text-white min-w-0"
            />
            <Search size={16} />
          </div>
        </div>
      </header>

      {/* Grid body. Centred both axes. Tiles use `flex-wrap` with
          `justify-center` so:
            - 1 occupant  → single tile centred, NOT stretched
            - 2 occupants → two tiles side-by-side, centred
            - 3 occupants → three tiles centred (full row)
            - 4-5+        → wrap onto additional rows, also centred
          Each tile caps at ~1/3 of the container width so it never
          balloons to a full-row eyesore when there's only one user. */}
      <div className="flex-1 overflow-y-auto p-4 grid place-items-center">
        {occupants.length === 0 ? (
          <div className="text-[var(--text-muted)] text-sm italic">
            暂无人在此频道 · 双击侧栏频道加入
          </div>
        ) : (
          <div
            className="flex flex-wrap gap-3 justify-center w-full"
            style={{ maxWidth: "1740px" }}
          >
            {occupants.map((p) => {
              const isMe = !!user && p.user_id === user.id;
              const isSpeaking = isMe && localSpeaking;
              const isMuted = isMe && muted;
              return (
                <OccupantTile
                  key={p.user_id}
                  user={p}
                  speaking={isSpeaking}
                  muted={isMuted}
                  isMe={isMe}
                  channelId={current?.channelId ?? null}
                  serverId={serverId}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function OccupantTile({
  user,
  speaking,
  muted,
  isMe,
  channelId,
  serverId,
}: {
  user: PresenceUser;
  speaking: boolean;
  muted: boolean;
  isMe: boolean;
  /** Voice channel id the local client is currently in (or null). Used
   *  to scope the force-kick signal so admins don't accidentally kick
   *  someone from a channel they're not in. */
  channelId: string | null;
  /** Server id this voice channel lives in — used to gate kick power
   *  (mods can only kick within the official server). */
  serverId: string;
}) {
  const me = useAuth((s) => s.user);
  // Kick gate: founder/admin anywhere, mod only within official server.
  const canKickHere = canModerateServer(me?.id, serverId);
  // Track tile size so the avatar scales fluidly when the user resizes
  // the window or when the column count changes (1/2/3 occupant layouts).
  const tileRef = useRef<HTMLDivElement>(null);
  const [tileWidth, setTileWidth] = useState(0);
  useEffect(() => {
    const el = tileRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setTileWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Avatar fills 22.5% of tile width (per user request). Vertical cap
  // at 50% of tile height keeps it well clear of the username label.
  // Floor at 32px so it never disappears on tiny tiles.
  const tileHeight = (tileWidth * 9) / 16;
  const avatarSize = Math.max(
    32,
    Math.round(Math.min(tileWidth * 0.225, tileHeight * 0.5)),
  );
  // Scale the username label and mute badge proportionally too.
  const labelFont = Math.max(11, Math.round(tileWidth * 0.04));
  const badgeSize = Math.max(20, Math.round(tileWidth * 0.07));
  return (
    <div
      ref={tileRef}
      className={cn(
        "group relative aspect-video rounded-lg bg-[var(--bg-darkest)] border-2 transition-all duration-150 grid place-items-center",
        speaking
          ? "border-[var(--success)] shadow-[0_0_24px_var(--success-glow,rgba(75,191,107,0.5))]"
          : "border-[var(--bg-mid)]",
      )}
      style={{
        // Tile size: 1.25× the previous 450px = 562px ideal width.
        // maxWidth caps at 1/3 of container so 3 always fit per row.
        //
        // minWidth was bumped from 260px → 440px so when the user
        // shrinks the window the centre voice card holds its size
        // instead of collapsing down to a postage-stamp. With
        // `flex: "0 1 562px"` the tile is still allowed to shrink
        // between 562 and 440px to fit alongside siblings; below
        // that it wraps or — for the single-occupant case the user
        // showed — simply stays at 440px even when the surrounding
        // chat panel narrows.
        flex: "0 1 562px",
        maxWidth: "calc((100% - 1.5rem) / 3)",
        minWidth: "440px",
      }}
    >
      <Avatar
        text={user.avatar || user.username?.[0] || "?"}
        color={user.avatar_color || "var(--accent)"}
        url={user.avatar_url}
        size={avatarSize || 80}
      />
      <div
        className="absolute bottom-2 left-2 px-2 py-0.5 rounded font-medium text-white bg-black/60 inline-flex items-center gap-1 max-w-[70%]"
        style={{ fontSize: `${labelFont}px` }}
      >
        <span className={cn("truncate", staffNameClass(user.user_id))}>
          {user.username}
        </span>
        <StaffBadge
          userId={user.user_id}
          size={Math.max(11, Math.round(labelFont * 0.95))}
          className="shrink-0"
        />
      </div>
      {muted && (
        <div
          className="absolute top-2 right-2 grid place-items-center rounded bg-[var(--danger)]/80 text-white"
          style={{ width: badgeSize, height: badgeSize }}
          title="已静音"
        >
          <MicOff size={Math.max(12, Math.round(badgeSize * 0.55))} />
        </div>
      )}
      {canKickHere && !isMe && !isAnyStaffId(user.user_id) && (
        <button
          type="button"
          title={`强制踢出 ${user.username}`}
          onClick={async () => {
            if (!me) return;
            if (!(await confirm(`强制将「${user.username}」移出语音房？`))) return;
            const res = await sendKickSignal({
              targetUserId: user.user_id,
              targetChannelId: channelId,
              issuedBy: me.id,
              issuedByName: me.username,
              targetName: user.username,
            });
            if (!res.ok) void alert(res.message);
          }}
          className="absolute top-2 left-2 grid place-items-center rounded bg-black/60 hover:bg-[var(--danger)]/80 text-white transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
          style={{ width: badgeSize, height: badgeSize }}
        >
          <UserX size={Math.max(12, Math.round(badgeSize * 0.55))} />
        </button>
      )}
    </div>
  );
}
