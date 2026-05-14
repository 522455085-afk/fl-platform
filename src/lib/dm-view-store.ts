"use client";

/**
 * Tiny UI-only store: which category is currently selected in the DM
 * "好友" sidebar. Shared between DmSidebar (link highlight) and DmHome
 * (which friend grid to render).
 *
 * Not persisted — reset to "online" on each full reload.
 */

import { create } from "zustand";

export type DmCategory =
  | "online" // friends currently online
  | "all" // every friend
  | "close" // "亲密关系" — placeholder for future feature
  | "requests" // incoming + outgoing friend requests
  | "blocked"; // blocked users

type Store = {
  category: DmCategory;
  setCategory: (c: DmCategory) => void;
};

export const useDmView = create<Store>()((set) => ({
  category: "online",
  setCategory: (c) => set({ category: c }),
}));
