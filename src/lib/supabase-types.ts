/**
 * Shared DB row types — used by both the legacy Supabase client and the
 * CloudBase-backed adapter. Defined here so swapping backends doesn't
 * change application code.
 */

export type DbMessage = {
  id: string;
  channel_id: string;
  author_id: string;
  author_name: string;
  author_color: string;
  author_avatar: string;
  /** Optional uploaded image URL (data URL or http URL). When present, UI
   *  renders the image; otherwise falls back to the colored letter tile. */
  author_avatar_url?: string | null;
  content: string;
  created_at: string;
  /** When the author last edited this message. Absent for never-edited
   *  messages. UI shows "(已编辑)" tag when set. */
  edited_at?: string | null;
  /** Soft-delete marker. We keep the row so reaction counts / replies
   *  don't break, but render "(消息已删除)" placeholder instead of content. */
  is_deleted?: boolean;
  /** Pinned by a moderator. Pinned messages bubble up into the channel
   *  header banner and are decorated with a pin icon in the timeline. */
  is_pinned?: boolean;
  /** When the moderator pinned this message. Drives the order of the
   *  pinned banner — most recently pinned at the top. Absent on legacy
   *  pinned rows; UI falls back to `created_at` for those. */
  pinned_at?: string | null;
  /** Importance hint for announcement channels.
   *  - "high": clients pop a sitewide toast/banner when a new "high"
   *    message arrives (see `<HighPriorityWatcher />`).
   *  - undefined / "normal": no special behavior. */
  priority?: "normal" | "high";
  /** Inline image attachments. Stored as base64 dataURLs (JPEG, max
   *  ~150 KB each after down-scaling). Serialised as a JSON string in
   *  CloudBase because arrays-of-objects must be stored as strings to
   *  stay within the 512 KB row cap. */
  attachments?: string | null; // JSON: ChatAttachment[]
};

export type ChatAttachment = {
  type: "image";
  url: string;       // base64 dataURL
  width: number;
  height: number;
  /** Character offset in `content` where this image is inserted.
   * Undefined (or absent) = append after all text (legacy behaviour). */
  textOffset?: number;
};

export type DbProfile = {
  id: string;
  username: string;
  email: string;
  avatar: string;
  avatar_color: string;
  /** Uploaded avatar image (data URL or http URL); null = use letter tile. */
  avatar_url?: string | null;
  phone?: string | null;
  phone_verified_at?: string | null;
  /** Marker for future real-name verification (face + ID). null until verified. */
  real_name_verified_at?: string | null;
  created_at: string;
};

export type DbTradeListing = {
  id: string;
  server_id: string;
  seller_id: string;
  seller_name: string;
  item_name: string;
  item_rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "darklegen";
  item_level?: number;
  item_class: string;
  affixes: string[];
  price: number;
  stock: number;
  note: string | null;
  contact?: string;
  created_at: string | number;
  expires_at: string | number | null;
};

export type DbAuctionListing = {
  id: string;
  server_id: string;
  seller_id: string;
  seller_name: string;
  contact?: string;
  item_name: string;
  item_rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "darklegen";
  item_level?: number;
  item_class: string;
  affixes: string[];
  note: string | null;
  starting_price: number;
  current_bid: number;
  bidder_id: string | null;
  bidder_name: string | null;
  bid_count: number;
  buyout_price?: number | null;
  min_bid_step?: number | null;
  ends_at: string | number;
  created_at: string | number;
};

export type PartyMember = {
  user_id: string;
  user_name: string;
};

export type DbParty = {
  id: string;
  server_id: string;
  leader_id: string;
  leader_name: string;
  name: string;
  map: string;
  difficulty: "普通" | "困难" | "噩梦";
  max_size: number;
  voice_required: boolean;
  note: string | null;
  members: PartyMember[];
  /** Optional space linkage. Recruiters must be in a room or a voice
   *  channel to create a party; joiners are auto-added to the same
   *  space. Stored denormalized so cross-client display works without
   *  sharing the rooms localStorage. `room_kind` distinguishes a
   *  lightweight recruitment room ("room") from a real voice channel
   *  ("voice"); joiners route to rooms-store or voice-store accordingly. */
  room_id?: string | null;
  room_name?: string | null;
  room_max_capacity?: number | null;
  room_kind?: "room" | "voice" | null;
  created_at: string;
  expires_at: string;
};
