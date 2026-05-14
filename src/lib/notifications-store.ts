import { create } from "zustand";

export type NotificationKind = "mention" | "dm" | "reaction" | "system";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  /** 单行标题，如 "FlameUser 提到了你" */
  title: string;
  /** 消息摘要 / 正文 */
  body: string;
  /** 来源频道 / DM id — 用于跳转 */
  channelId?: string;
  serverId?: string;
  /** DM 通知专用：发起方 user_id，用于点击后打开私信 */
  partnerId?: string;
  partnerName?: string;
  partnerAvatar?: string;
  partnerColor?: string;
  partnerAvatarUrl?: string | null;
  /** 发送者头像字符 + 颜色（可选） */
  avatarText?: string;
  avatarColor?: string;
  at: string;
  read: boolean;
};

type Store = {
  items: AppNotification[];
  unreadCount: number;
  panelOpen: boolean;
  add: (n: Omit<AppNotification, "id" | "at" | "read">) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  togglePanel: () => void;
  closePanel: () => void;
};

export const useNotifications = create<Store>((set) => ({
  items: [],
  unreadCount: 0,
  panelOpen: false,

  add: (n) => {
    const item: AppNotification = {
      ...n,
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      read: false,
    };
    set((s) => ({
      items: [item, ...s.items].slice(0, 100),
      unreadCount: s.unreadCount + 1,
    }));
  },

  markRead: (id) =>
    set((s) => {
      const items = s.items.map((i) => (i.id === id ? { ...i, read: true } : i));
      return { items, unreadCount: items.filter((i) => !i.read).length };
    }),

  markAllRead: () =>
    set((s) => ({
      items: s.items.map((i) => ({ ...i, read: true })),
      unreadCount: 0,
    })),

  clear: () => set({ items: [], unreadCount: 0 }),

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  closePanel: () => set({ panelOpen: false }),
}));
