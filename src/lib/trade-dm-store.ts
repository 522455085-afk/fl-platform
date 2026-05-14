"use client";

/**
 * Lightweight store that tracks which DM partner IDs were opened via the
 * trade market ("联系卖家" button). Used by DmSidebar to show a separate
 * "交易行私信" section so trade conversations don't clutter regular DMs.
 *
 * IDs are persisted to sessionStorage so they survive navigation within
 * a tab but reset when the tab is closed.
 */

import { create } from "zustand";

const SESSION_KEY = "fl_trade_dm_partners";

function loadFromSession(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveToSession(ids: Set<string>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...ids]));
  } catch {}
}

type TradeDmState = {
  /** Set of partner_ids contacted via the trade market. */
  partnerIds: Set<string>;
  /** Mark a partner as a trade contact. */
  add: (partnerId: string) => void;
  /** Check if a given partner was a trade contact. */
  has: (partnerId: string) => boolean;
};

export const useTradeDm = create<TradeDmState>()((set, get) => ({
  partnerIds: loadFromSession(),

  add: (partnerId) => {
    const next = new Set(get().partnerIds);
    next.add(partnerId);
    saveToSession(next);
    set({ partnerIds: next });
  },

  has: (partnerId) => get().partnerIds.has(partnerId),
}));
