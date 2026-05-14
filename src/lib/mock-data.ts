// Mock data for the ForgottenLand platform - to be replaced with real API calls.

export type Server = {
  id: string;
  name: string;
  iconText: string;
  iconColor: string;
  /** Optional uploaded image (dataURL or http URL) — overrides iconText when present. */
  iconUrl?: string | null;
  /** 8-digit human-readable id (公会号). Custom servers only. */
  numericId?: string | null;
  unread?: number;
  /**
   * Official platform server: admins are configured by the platform
   * (NEXT_PUBLIC_ADMIN_USER_IDS). User-created servers will instead use
   * per-server roles in the `server_members` collection.
   */
  is_official?: boolean;
  /** Cached membership count for admin-slot calculation. */
  member_count?: number;
  /**
   * Admin-customised channel layout. When present, overrides the global
   * `channelCategories` mock for this server. Persisted on the `servers`
   * collection as a JSON field so CRUD edits survive reloads without
   * needing a separate `server_channels` collection.
   */
  channels?: ChannelCategory[];
};

export type ChannelCategory = {
  id: string;
  name: string;
  channels: Channel[];
};

export type Channel = {
  id: string;
  name: string;
  /**
   * Channel kind:
   *  - text: ordinary chat, anyone can post
   *  - announcement: only admins can post; everyone can react with emoji
   *    (Discord-style “Announcement” / “Rules” channel)
   *  - voice / stream / trade / party: specialised UIs
   */
  type: "text" | "announcement" | "voice" | "stream" | "trade" | "auction" | "party" | "coins";
  members?: string[]; // for voice channels
  maxOccupants?: number; // max players shown in voice channel (default 25)
  unread?: boolean; // legacy field, runtime state is in unread-store.ts
  /** When true, only server admins/creators can post. Members read only. */
  readonly?: boolean;
};

export type Message = {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  avatar: string;
  content: string;
  timestamp: string;
  attachments?: { type: "image" | "trade-card"; data: unknown }[];
};

export type Member = {
  id: string;
  name: string;
  avatar: string;
  status: "online" | "idle" | "dnd" | "offline";
  activity?: string; // e.g. "局内 - 暮光森林"
  role?: "owner" | "admin" | "member";
  roleColor?: string;
};

export type TradeListing = {
  id: string;
  itemName: string;
  itemRarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  iconText: string;
  price: number;
  seller: string;
  affixes: string[];
  postedAt: string;
};

export type Party = {
  id: string;
  name: string;
  leader: string;
  map: string;
  difficulty: "普通" | "困难" | "噩梦";
  current: number;
  max: number;
  voiceRequired: boolean;
  note?: string;
};

// ----------------------------------------------------------------------------
// Per-server channel layouts. Each official server gets its OWN channel
// list — channel ids are namespaced with the server id so voice rooms,
// presence and the channel sidebar all stay distinct between servers.
// Without this, every official server falls back to the same global
// `channelCategories` and switching servers shows identical channels +
// users (user-reported "服务器仍然是通用频道" bug).
// ----------------------------------------------------------------------------
const baseCategories = (sid: string): ChannelCategory[] => [
  {
    id: `${sid}-info`,
    name: "信息",
    channels: [
      { id: `${sid}-rules`, name: "规则与公告", type: "announcement" },
      { id: `${sid}-patch`, name: "版本更新", type: "announcement" },
    ],
  },
  {
    id: `${sid}-general`,
    name: "综合",
    channels: [
      { id: `${sid}-general`, name: "闲聊大厅", type: "text" },
      { id: `${sid}-screenshots`, name: "截图分享", type: "text" },
      { id: `${sid}-trade-talk`, name: "交易喊话", type: "trade" },
    ],
  },
  {
    id: `${sid}-raid`,
    name: "组队",
    channels: [
      { id: `${sid}-lfg`, name: "组队大厅", type: "party" },
      { id: `${sid}-v-1`, name: "突袭语音 1", type: "voice", members: [] },
      { id: `${sid}-v-2`, name: "突袭语音 2", type: "voice", members: [] },
      { id: `${sid}-v-3`, name: "野团语音", type: "voice", members: [] },
    ],
  },
  {
    id: `${sid}-live`,
    name: "直播",
    channels: [
      { id: `${sid}-live-1`, name: "直播间 1", type: "stream" },
      { id: `${sid}-live-2`, name: "直播间 2", type: "stream" },
    ],
  },
];

// Official servers expose a SLIMMER channel set: only the announcement /
// general-chat channels. Voice rooms, party halls, livestreams and screenshot
// sharing live exclusively in user-created servers per product direction.
//
// `withTrade` opts in to the platform-wide 交易喊话 channel — currently only
// the 大殿 (home) server uses it so the global marketplace lives in one
// canonical place.
const officialCategories = (
  sid: string,
  opts: { withTrade?: boolean } = {},
): ChannelCategory[] => [
  {
    id: `${sid}-info`,
    name: "信息",
    channels: [
      { id: `${sid}-rules`, name: "规则与公告", type: "announcement" },
      { id: `${sid}-patch`, name: "版本更新", type: "announcement" },
      // Discussion thread tied to the read-only announcements above
      // — gives users a place to react / ask follow-up questions
      // without polluting the announcement feed itself.
      { id: `${sid}-feedback`, name: "公告反馈", type: "text" },
    ],
  },
  {
    id: `${sid}-general`,
    name: "综合",
    channels: [
      { id: `${sid}-general`, name: "闲聊大厅", type: "text" },
      { id: `${sid}-screenshots`, name: "截图分享", type: "text" },
      // Per user request: official guilds should also feel "alive"
      // with a small set of secondary text channels rather than just
      // 闲聊大厅 + 公告. Activity / off-topic chat slots match what
      // KOOK ships out-of-the-box for community servers.
      { id: `${sid}-activity`, name: "活动召集", type: "text" },
      { id: `${sid}-offtopic`, name: "灌水闲聊", type: "text" },
      ...(opts.withTrade
        ? [{ id: `${sid}-trade-talk`, name: "交易喊话", type: "trade" as const }]
        : []),
    ],
  },
];

const guildCategories = (sid: string): ChannelCategory[] => [
  {
    id: `${sid}-info`,
    name: "商会公告",
    channels: [
      { id: `${sid}-rules`, name: "商会规章", type: "announcement" },
      { id: `${sid}-news`, name: "行情快报", type: "text" },
    ],
  },
  {
    id: `${sid}-market`,
    name: "交易中心",
    channels: [
      { id: `${sid}-market`, name: "物品交易", type: "trade" },
      { id: `${sid}-coins`, name: "金币兑换", type: "coins" },
      { id: `${sid}-auction`, name: "拍卖行", type: "auction" },
      { id: `${sid}-trade-talk`, name: "交易喊话", type: "text" },
    ],
  },
  {
    id: `${sid}-general`,
    name: "社区",
    channels: [
      { id: `${sid}-general`, name: "闲聊大厅", type: "text" },
    ],
  },
];

export const servers: Server[] = [
  { id: "home", name: "大殿", iconText: "FL", iconColor: "#d4a056", is_official: true, channels: officialCategories("home", { withTrade: true }) },
  { id: "official", name: "御林骑士团", iconText: "御", iconColor: "#9b6dd9", is_official: true, channels: officialCategories("official") },
  { id: "raid", name: "暮光突袭团", iconText: "暮", iconColor: "#7e3a8c", is_official: true, channels: baseCategories("raid") },
  { id: "trade", name: "黄金商会", iconText: "金", iconColor: "#c9a44c", is_official: true, channels: guildCategories("trade") },
  { id: "newbie", name: "新人庇护所", iconText: "新", iconColor: "#5a8c7d", is_official: true, channels: baseCategories("newbie") },
];

// Backwards-compat: legacy global channels (still used as the default
// activeChannel before any server is selected, and as a fallback for
// servers that genuinely have no per-server channel data — e.g. the
// transient "preview" server).
export const channelCategories: ChannelCategory[] = [
  {
    id: "info",
    name: "信息",
    channels: [
      { id: "rules", name: "规则与公告", type: "announcement" },
      { id: "patch", name: "版本更新", type: "announcement" },
    ],
  },
  {
    id: "general",
    name: "综合",
    channels: [
      { id: "general", name: "闲聊大厅", type: "text" },
      { id: "screenshots", name: "截图分享", type: "text" },
      { id: "trade-talk", name: "交易喊话", type: "trade" },
    ],
  },
  {
    id: "raid",
    name: "组队",
    channels: [
      { id: "lfg", name: "组队大厅", type: "party" },
      // Voice channels: members[] is now driven by real presence rather
      // than hardcoded sample names, so an empty room actually shows empty.
      { id: "v-1", name: "突袭语音 1", type: "voice", members: [] },
      { id: "v-2", name: "突袭语音 2", type: "voice", members: [] },
      { id: "v-3", name: "野团语音", type: "voice", members: [] },
    ],
  },
  {
    id: "live",
    name: "直播",
    channels: [
      { id: "live-1", name: "直播间 1", type: "stream" },
      { id: "live-2", name: "直播间 2", type: "stream" },
    ],
  },
];

export const mockMessages: Message[] = [
  {
    id: "m1",
    authorId: "u1",
    authorName: "公会长 · 凯撒",
    authorColor: "#f0b232",
    avatar: "凯",
    content: "本周日晚上 8 点暮光森林集合，五人团缺一个奶。报名接龙。",
    timestamp: "今天 12:04",
  },
  {
    id: "m2",
    authorId: "u2",
    authorName: "剑圣阿黎",
    authorColor: "#5865f2",
    avatar: "黎",
    content: "+1 战士",
    timestamp: "今天 12:06",
  },
  {
    id: "m3",
    authorId: "u3",
    authorName: "夜行者",
    authorColor: "#9b59b6",
    avatar: "夜",
    content: "+1 盗贼，已在大厅装好毒刃",
    timestamp: "今天 12:08",
  },
  {
    id: "m4",
    authorId: "u4",
    authorName: "牧师小白",
    authorColor: "#23a55a",
    avatar: "白",
    content: "想出一把紫色匕首，词条不错，谁要？",
    timestamp: "今天 12:31",
    attachments: [
      {
        type: "trade-card",
        data: {
          name: "毒蛇之牙",
          rarity: "epic",
          price: 1280,
          affixes: ["+45 物理伤害", "+12% 暴击", "命中附加 5s 流血", "+8% 移动速度"],
        },
      },
    ],
  },
  {
    id: "m5",
    authorId: "u5",
    authorName: "流浪法师",
    authorColor: "#3498db",
    avatar: "法",
    content: "求一个噩梦本带飞的，价格好商量",
    timestamp: "今天 13:02",
  },
  {
    id: "m6",
    authorId: "u1",
    authorName: "公会长 · 凯撒",
    authorColor: "#f0b232",
    avatar: "凯",
    content: "@牧师小白 这把匕首挺香的，给阿黎冲一冲？",
    timestamp: "今天 13:14",
  },
];

export const mockMembers: Member[] = [
  { id: "u1", name: "公会长 · 凯撒", avatar: "凯", status: "online", activity: "大厅 - 整理库存", role: "owner", roleColor: "#f0b232" },
  { id: "u2", name: "剑圣阿黎", avatar: "黎", status: "online", activity: "局内 - 暮光森林", role: "admin", roleColor: "#5865f2" },
  { id: "u3", name: "夜行者", avatar: "夜", status: "online", activity: "大厅 - 在交易市场", role: "admin", roleColor: "#5865f2" },
  { id: "u4", name: "牧师小白", avatar: "白", status: "idle", activity: "AFK", role: "member" },
  { id: "u5", name: "流浪法师", avatar: "法", status: "online", activity: "局内 - 黑石矿洞", role: "member" },
  { id: "u6", name: "霜狼战士", avatar: "霜", status: "dnd", activity: "副本中，请勿打扰", role: "member" },
  { id: "u7", name: "野蛮人小红", avatar: "红", status: "offline", role: "member" },
  { id: "u8", name: "弓箭手", avatar: "弓", status: "offline", role: "member" },
];

export const mockTradeListings: TradeListing[] = [
  {
    id: "t1",
    itemName: "毒蛇之牙",
    itemRarity: "epic",
    iconText: "🗡",
    price: 1280,
    seller: "牧师小白",
    affixes: ["+45 物理伤害", "+12% 暴击", "命中附加 5s 流血", "+8% 移动速度"],
    postedAt: "5 分钟前",
  },
  {
    id: "t2",
    itemName: "霜冻法杖",
    itemRarity: "rare",
    iconText: "🪄",
    price: 480,
    seller: "流浪法师",
    affixes: ["+30 法术伤害", "+15 法力回复", "冰霜法术 +20% 伤害"],
    postedAt: "12 分钟前",
  },
  {
    id: "t3",
    itemName: "暮光披风",
    itemRarity: "legendary",
    iconText: "🧥",
    price: 5500,
    seller: "夜行者",
    affixes: ["+80 防御", "+60 魔抗", "+15% 闪避", "受到致命伤害时召唤暮光护盾", "暗影属性 +25%"],
    postedAt: "1 小时前",
  },
  {
    id: "t4",
    itemName: "学徒长袍",
    itemRarity: "common",
    iconText: "👘",
    price: 35,
    seller: "新手玩家",
    affixes: ["+8 智力"],
    postedAt: "2 小时前",
  },
  {
    id: "t5",
    itemName: "巨龙之心",
    itemRarity: "legendary",
    iconText: "💎",
    price: 12000,
    seller: "公会长 · 凯撒",
    affixes: ["+100 全属性", "+250 最大生命", "受伤时回复 5% 生命", "免疫龙类伤害减免"],
    postedAt: "昨天",
  },
  {
    id: "t6",
    itemName: "森林行者之靴",
    itemRarity: "uncommon",
    iconText: "👢",
    price: 120,
    seller: "霜狼战士",
    affixes: ["+12 敏捷", "+5% 移动速度"],
    postedAt: "今天",
  },
];

export const mockParties: Party[] = [
  {
    id: "p1",
    name: "周日噩梦五宝车",
    leader: "公会长 · 凯撒",
    map: "暮光森林",
    difficulty: "噩梦",
    current: 4,
    max: 5,
    voiceRequired: true,
    note: "缺一个奶，要求装等 280+",
  },
  {
    id: "p2",
    name: "黑石矿洞速刷",
    leader: "流浪法师",
    map: "黑石矿洞",
    difficulty: "困难",
    current: 2,
    max: 3,
    voiceRequired: false,
    note: "刷材料，能打就行",
  },
  {
    id: "p3",
    name: "新手带飞",
    leader: "剑圣阿黎",
    map: "迷雾沼泽",
    difficulty: "普通",
    current: 1,
    max: 4,
    voiceRequired: false,
    note: "新人友好，免费带",
  },
  {
    id: "p4",
    name: "PVP 突击小队",
    leader: "夜行者",
    map: "争议平原",
    difficulty: "噩梦",
    current: 3,
    max: 5,
    voiceRequired: true,
    note: "需开麦配合，目标击杀对面公会团",
  },
];

export const rarityColor = {
  common: "#b9bbbe",
  uncommon: "#23a55a",
  rare: "#3b82f6",
  epic: "#9b59b6",
  legendary: "#f0b232",
  darklegen: "#c07030",
} as const;

export const rarityLabel = {
  common: "普通",
  uncommon: "优秀",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  darklegen: "暗金",
} as const;
