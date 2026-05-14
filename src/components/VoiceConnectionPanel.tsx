"use client";

/**
 * Inline voice-connection panel, rendered above UserPanel inside the
 * left 396px column of the desktop bottom bar.
 *
 * Replaces the older floating `VoiceConnectionOverlay`. The Discord-
 * style design unifies these two elements visually:
 *   ┌────────────────────────────────┐
 *   │  📶 已连接           突袭语音 1   ⏻ │  ← header row (status + leave)
 *   │  [屏幕分享]  [REC]  [音乐]         │  ← optional placeholder actions
 *   │  语音感应         [感应] 🎤 🎧    │  ← mic / deafen toggles
 *   └────────────────────────────────┘
 *   │  [avatar]  username · 在线          │  ← UserPanel (separate component)
 *   └────────────────────────────────┘
 *
 * The mute / deafen state is shared via voice-store so the channel-page
 * speaking-indicator and any future real-audio pipeline stay in sync.
 */

import {
  PhoneOff,
  Volume2,
  Wifi,
  ScreenShare,
  Disc,
  Music2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useVoice } from "@/lib/voice-store";
import { useAllServers } from "@/lib/servers-store";
import { cn } from "@/lib/utils";

/**
 * Lightweight network-quality probe based on navigator.connection +
 * navigator.onLine. Returns one of:
 *   - "good"     — 4g / wifi (rtt < 200ms)
 *   - "medium"   — 3g / mediocre rtt (200–500ms)
 *   - "bad"      — 2g / slow-2g / rtt > 500ms
 *   - "offline"  — navigator.onLine === false
 *
 * Falls back to "good" on browsers that don't expose the connection API.
 */

/** Network Information API type definition */
interface NetworkInformation {
  effectiveType?: string;
  rtt?: number;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

type ExtendedNavigator = Navigator & { connection?: NetworkInformation };

function useNetworkQuality(): "good" | "medium" | "bad" | "offline" {
  const [quality, setQuality] = useState<"good" | "medium" | "bad" | "offline">("good");
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const update = () => {
      if (!navigator.onLine) {
        setQuality("offline");
        return;
      }
      const nav = navigator as ExtendedNavigator;
      const conn = nav.connection;
      if (!conn) {
        setQuality("good");
        return;
      }
      const eff: string | undefined = conn.effectiveType;
      const rtt: number = typeof conn.rtt === "number" ? conn.rtt : 0;
      if (eff === "slow-2g" || eff === "2g" || rtt > 500) {
        setQuality("bad");
      } else if (eff === "3g" || rtt > 200) {
        setQuality("medium");
      } else {
        setQuality("good");
      }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const nav = navigator as ExtendedNavigator;
    const conn = nav.connection;
    if (conn && typeof conn.addEventListener === "function") {
      conn.addEventListener("change", update);
    }
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      if (conn && typeof conn.removeEventListener === "function") {
        conn.removeEventListener("change", update);
      }
    };
  }, []);
  return quality;
}

export default function VoiceConnectionPanel({
  onJumpTo,
  embedded = false,
}: {
  onJumpTo?: (serverId: string, channelId: string) => void;
  /** When true, the panel renders flush against the user card below
      (no bottom border, slightly tighter padding) so the two read as
      a single unit. Set by `UserPanel` when it embeds this panel. */
  embedded?: boolean;
}) {
  const current = useVoice((s) => s.current);
  const leave = useVoice((s) => s.leave);
  const netQuality = useNetworkQuality();
  // Look up the server name so we can render "<channel> · <server>"
  // — user-requested change to make the connection chip self-
  // explanatory when you're connected from another server.
  const allServers = useAllServers();
  const serverName = current
    ? allServers.find((s) => s.id === current.serverId)?.name
    : undefined;

  if (!current) return null;

  return (
    <div
      className={cn(
        // Per user request: text + icons scaled ~1.25× and the
        // panel itself tightened up vertically so the bigger
        // contents don't crowd the bottom bar.
        // gap-2.5 between the header and the action row was producing
        // a faint horizontal banding the user described as 漏光线
        // (because the action buttons' `bg-mid/60` paint left a clear
        // edge against the panel bg). Tightened to gap-1.5 so the two
        // rows read as one continuous block — no visible seam.
        "bg-[var(--bg-userbar)] px-3.5 pt-3 pb-[8px] flex flex-col gap-2",
        embedded ? "rounded-t-2xl" : "border-b border-[var(--bg-mid)]",
      )}
      role="status"
      aria-label="语音连接面板"
    >
      {/* Row 1 — channel name (left) + Wifi/已连接 (right of channel). */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => onJumpTo?.(current.serverId, current.channelId)}
          disabled={!onJumpTo}
          title={
            serverName
              ? `${current.channelName} · ${serverName}`
              : current.channelName
          }
          className={cn(
            "flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-0.5 rounded text-left",
            onJumpTo
              ? "hover:bg-[var(--bg-mid)] cursor-pointer"
              : "cursor-default",
          )}
        >
          <Volume2 size={16} className="text-[var(--accent)] shrink-0" />
          <span className="text-[15px] font-semibold text-white truncate">
            {current.channelName}
            {serverName && (
              <span className="ml-1 text-[var(--text-muted)] font-normal">
                · {serverName}
              </span>
            )}
          </span>
        </button>
        <Wifi
          size={16}
          className={cn(
            "shrink-0",
            netQuality === "good" && "text-[var(--success)]/80",
            netQuality === "medium" && "text-[var(--warning)]",
            netQuality === "bad" && "text-[var(--danger)]",
            netQuality === "offline" && "text-[var(--danger)] opacity-50",
          )}
        />
        <span
          className={cn(
            "text-[12px] uppercase tracking-wider font-semibold shrink-0",
            netQuality === "good" && "text-[var(--success)]",
            netQuality === "medium" && "text-[var(--warning)]",
            netQuality === "bad" && "text-[var(--danger)]",
            netQuality === "offline" && "text-[var(--danger)]",
          )}
        >
          {netQuality === "offline" ? "离线" : "已连接"}
        </span>
      </div>

      {/* Row 2 — 4 buttons evenly spaced (placeholders + hangup). */}
      <div className="flex items-center justify-evenly mt-[4px]">
        <PlaceholderButton icon={<ScreenShare size={16} />} label="屏幕分享" />
        <PlaceholderButton icon={<Disc size={16} />} label="录制" />
        <PlaceholderButton icon={<Music2 size={16} />} label="音乐" />
        <button
          type="button"
          onClick={() => leave()}
          title="挂断"
          className="size-9 grid place-items-center rounded-lg hover:bg-[var(--danger)]/15 text-[var(--danger)] transition-colors shrink-0"
        >
          <PhoneOff size={16} />
        </button>
      </div>
    </div>
  );
}

function PlaceholderButton({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      title={`${label}（即将推出）`}
      className="size-9 grid place-items-center rounded-lg hover:bg-[var(--bg-mid)]/60 text-[var(--text-muted)] hover:text-white transition-colors shrink-0"
    >
      {icon}
    </button>
  );
}
