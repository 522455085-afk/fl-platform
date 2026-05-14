"use client";

import { create } from "zustand";

// NO PERSISTENCE: refresh = clean slate (user-requested). The previous
// `persist` middleware kept user-created recruitment rooms across reloads
// which contradicted the "refresh = leave all rooms" rule.

export type Room = {
  id: string;
  serverId: string;
  name: string;
  /** 默认上限 5；VIP 可扩充（暂未实现） */
  maxCapacity: number;
  /** user IDs currently in the room */
  occupants: string[];
};

type RoomsStore = {
  rooms: Room[];
  addRoom: (serverId: string, name: string, maxCapacity?: number) => Room;
  /** Inserts the room if absent (used to mirror a room learned from
   *  another client's party data). No-op if a room with the same id
   *  already exists locally. */
  upsertRoom: (room: Room) => void;
  removeRoom: (id: string) => void;
  updateRoom: (id: string, patch: Partial<Pick<Room, "name" | "maxCapacity">>) => void;
  joinRoom: (id: string, userId: string) => boolean;
  leaveRoom: (id: string, userId: string) => void;
};

export const useRooms = create<RoomsStore>()(
    (set, get) => ({
      rooms: [],

      addRoom: (serverId, name, maxCapacity = 5) => {
        const room: Room = {
          id: `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          serverId,
          name,
          maxCapacity: Math.min(Math.max(maxCapacity, 1), 5),
          occupants: [],
        };
        set((s) => ({ rooms: [...s.rooms, room] }));
        return room;
      },

      upsertRoom: (room) =>
        set((s) =>
          s.rooms.some((r) => r.id === room.id)
            ? s
            : { rooms: [...s.rooms, room] },
        ),

      removeRoom: (id) =>
        set((s) => ({ rooms: s.rooms.filter((r) => r.id !== id) })),

      updateRoom: (id, patch) =>
        set((s) => ({
          rooms: s.rooms.map((r) =>
            r.id === id
              ? { ...r, ...patch, maxCapacity: Math.min(Math.max(patch.maxCapacity ?? r.maxCapacity, 1), 5) }
              : r,
          ),
        })),

      joinRoom: (id, userId) => {
        const room = get().rooms.find((r) => r.id === id);
        if (!room || room.occupants.length >= room.maxCapacity) return false;
        if (room.occupants.includes(userId)) return true;
        set((s) => ({
          rooms: s.rooms.map((r) =>
            r.id === id ? { ...r, occupants: [...r.occupants, userId] } : r,
          ),
        }));
        return true;
      },

      leaveRoom: (id, userId) =>
        set((s) => ({
          rooms: s.rooms.map((r) =>
            r.id === id
              ? { ...r, occupants: r.occupants.filter((u) => u !== userId) }
              : r,
          ),
        })),
    }),
);

// Defensive: scrub any legacy persisted rooms from previous builds so a
// hard refresh genuinely starts clean.
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem("fl-rooms");
  } catch {
    /* ignore */
  }
}
