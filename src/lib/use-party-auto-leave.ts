"use client";

/**
 * Global side-effect hook: keeps party state consistent with the user's
 * current voice channel.
 *
 * Rules (per product request "切换房间 = 关闭招募"):
 *   1. If the current user is the LEADER of a voice-linked party and they
 *      are no longer present in that party's voice room (because they
 *      switched to another voice channel, or disconnected from voice
 *      entirely), the party is auto-DISBANDED (deleted from the DB).
 *   2. If the current user is a non-leader MEMBER of a voice-linked party
 *      and they leave that party's voice room, they are auto-REMOVED from
 *      the party's `members` list. The party itself stays alive for the
 *      remaining members.
 *
 * Mount this once at the app root so it runs regardless of which view
 * (chat / voice / party hall) is active.
 */

import { useEffect, useRef } from "react";
import { supabase, type DbParty, type PartyMember } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-store";
import { useVoice } from "@/lib/voice-store";

export function usePartyAutoLeave() {
  const user = useAuth((s) => s.user);
  const voiceChannelId = useVoice((s) => s.current?.channelId ?? null);
  // Guard against firing on the initial mount (where voice = null is the
  // expected starting state and shouldn't disband anything).
  const initRef = useRef(true);

  useEffect(() => {
    if (!user) return;
    if (initRef.current) {
      initRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      // Pull every party tied to a voice room. We can't filter in SQL on
      // `room_kind` portably (older rows may have NULL), so just pull
      // them all and filter in JS — the table is tiny.
      const { data, error } = await supabase.from("parties").select("*");
      if (error || !data || cancelled) {
        if (error) console.warn("[party-auto] fetch FAILED:", error);
        return;
      }
      console.log("[party-auto] checking", {
        currentVoice: voiceChannelId,
        userId: user.id,
        partyCount: data.length,
      });
      for (const p of data as DbParty[]) {
        // Only care about parties tied to a specific voice room. Parties
        // with no `room_id` are recruitment-only and aren't location-bound.
        if (!p.room_id || p.room_kind !== "voice") continue;
        // We're still in the linked room → nothing to do.
        if (voiceChannelId && p.room_id === voiceChannelId) continue;
        if (p.leader_id === user.id) {
          // Leader left the party's voice room → disband.
          console.log("[party-auto] disband: leader left voice room", {
            partyId: p.id,
            partyRoom: p.room_id,
            currentVoice: voiceChannelId,
          });
          await supabase.from("parties").delete().eq("id", p.id);
          // Notify any mounted PartyView so the row disappears
          // instantly without waiting on Supabase realtime DELETE
          // (which is unreliable when the channel has a filter).
          if (typeof document !== "undefined") {
            document.dispatchEvent(
              new CustomEvent("fl:party-deleted", { detail: { partyId: p.id } }),
            );
          }
        } else if (p.members.some((m) => m.user_id === user.id)) {
          // Non-leader member left → remove just this member.
          const nextMembers: PartyMember[] = p.members.filter(
            (m) => m.user_id !== user.id,
          );
          console.log("[party-auto] remove self: member left voice room", {
            partyId: p.id,
            partyRoom: p.room_id,
            currentVoice: voiceChannelId,
          });
          await supabase
            .from("parties")
            .update({ members: nextMembers })
            .eq("id", p.id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, voiceChannelId]);
}
