/**
 * Database Row Types
 * 
 * Type definitions for all database collections.
 * These types are used by cloudbase-supabase.ts and all store modules.
 */

// ============================================================
// Core Entity IDs
// ============================================================

export type ServerId = string;
export type ChannelId = string;
export type UserId = string;
export type MessageId = string;
export type RoleId = string;

// ============================================================
// Server & Channel Types
// ============================================================

export interface DbServer {
  id: ServerId;
  name: string;
  /** URL to server icon image */
  icon?: string;
  /** User ID of the server creator */
  creator_id: UserId;
  /** Server description */
  description?: string;
  /** Whether this is an official/verified server */
  is_official?: boolean;
  /** Whether this is a public server */
  is_public?: boolean;
  /** Server creation timestamp */
  created_at: number;
  /** Last activity timestamp */
  updated_at?: number;
}

export interface DbChannel {
  id: ChannelId;
  /** Server this channel belongs to */
  server_id: ServerId;
  /** Channel name */
  name: string;
  /** Channel topic/description */
  topic?: string;
  /** Position in the channel list */
  position: number;
  /** Channel type: 'text' | 'voice' | 'announcement' */
  type: "text" | "voice" | "announcement";
  /** Parent category ID (for grouped channels) */
  category_id?: string;
  /** User who created this channel */
  creator_id: UserId;
  /** Creation timestamp */
  created_at: number;
}

export interface DbServerMember {
  /** Membership ID */
  id: string;
  /** Server ID */
  server_id: ServerId;
  /** User ID */
  user_id: UserId;
  /** User's nickname in this server */
  nickname?: string;
  /** User's avatar override for this server */
  avatar?: string;
  /** Role ID */
  role_id: RoleId;
  /** Whether user can send messages */
  can_send_messages: boolean;
  /** Whether user can manage messages */
  can_manage_messages: boolean;
  /** Whether user can kick members */
  can_kick_members: boolean;
  /** Whether user can ban members */
  can_ban_members: boolean;
  /** Whether user can manage roles */
  can_manage_roles: boolean;
  /** Whether user can manage channel */
  can_manage_channel: boolean;
  /** Whether user can mention everyone */
  can_mention_everyone: boolean;
  /** Join timestamp */
  joined_at: number;
  /** Last activity timestamp */
  last_active_at?: number;
}

// ============================================================
// Message Types
// ============================================================

export interface DbMessage {
  id: MessageId;
  /** Channel this message belongs to */
  channel_id: ChannelId;
  /** Author user ID */
  author_id: UserId;
  /** Message content (may be empty for system messages) */
  content: string;
  /** Message type: 'text' | 'image' | 'system' | 'voice' */
  type: "text" | "image" | "system" | "voice";
  /** Image URLs (for type='image') */
  image_urls?: string[];
  /** Voice duration in seconds (for type='voice') */
  voice_duration?: number;
  /** Voice URL (for type='voice') */
  voice_url?: string;
  /** Whether message mentions @everyone */
  mentions_everyone: boolean;
  /** User IDs mentioned in this message */
  mentioned_user_ids: UserId[];
  /** Whether this is a temporary message (auto-delete) */
  is_temporary?: boolean;
  /** Reply-to message ID */
  reply_to_id?: MessageId;
  /** Edit timestamp (null if never edited) */
  edited_at?: number;
  /** Creation timestamp */
  created_at: number;
}

export interface DbReaction {
  id: string;
  /** Message ID this reaction belongs to */
  message_id: MessageId;
  /** Channel ID (for efficient querying) */
  channel_id: ChannelId;
  /** User ID who added this reaction */
  user_id: UserId;
  /** Emoji identifier (e.g., '👍' or 'smile:123456') */
  emoji: string;
  /** When reaction was added */
  created_at: number;
}

// ============================================================
// Direct Message Types
// ============================================================

export interface DbDmThread {
  /** Thread ID (composite: user_a_id + ':' + user_b_id, sorted) */
  id: string;
  /** First user's ID */
  user_a_id: UserId;
  /** Second user's ID */
  user_b_id: UserId;
  /** Last message content preview */
  last_message_content?: string;
  /** Last message timestamp */
  last_message_at?: number;
  /** Number of unread messages for user_a */
  unread_a: number;
  /** Number of unread messages for user_b */
  unread_b: number;
  /** Creation timestamp */
  created_at: number;
}

export interface DbDmMessage {
  id: string;
  /** DM thread ID */
  thread_id: string;
  /** Sender user ID */
  sender_id: UserId;
  /** Message content */
  content: string;
  /** Whether sender has deleted this message */
  deleted_by_sender: boolean;
  /** Whether recipient has deleted this message */
  deleted_by_recipient: boolean;
  /** Creation timestamp */
  created_at: number;
}

// ============================================================
// User & Profile Types
// ============================================================

export interface DbUserProfile {
  id: UserId;
  /** User's display name */
  username: string;
  /** User's avatar URL */
  avatar_url?: string;
  /** User's email (optional) */
  email?: string;
  /** User's phone number */
  phone?: string;
  /** User's bio/description */
  bio?: string;
  /** Whether user has verified email */
  email_verified: boolean;
  /** Whether user has verified phone */
  phone_verified: boolean;
  /** Account creation timestamp */
  created_at: number;
  /** Last profile update timestamp */
  updated_at: number;
}

export interface DbFriendRequest {
  id: string;
  /** Sender user ID */
  from_user_id: UserId;
  /** Recipient user ID */
  to_user_id: UserId;
  /** Request status: 'pending' | 'accepted' | 'rejected' */
  status: "pending" | "accepted" | "rejected";
  /** Optional message with the request */
  message?: string;
  /** When request was created */
  created_at: number;
  /** When request was responded to */
  responded_at?: number;
}

export interface DbFriendship {
  id: string;
  /** First user ID */
  user_a_id: UserId;
  /** Second user ID */
  user_b_id: UserId;
  /** Who initiated the friendship */
  requested_by: UserId;
  /** When friendship was created */
  created_at: number;
}

// ============================================================
// Trade & Economy Types
// ============================================================

export interface DbTradeListing {
  id: string;
  /** Listing creator */
  seller_id: UserId;
  /** Server this listing belongs to (null for global) */
  server_id?: ServerId;
  /** Item category */
  category: string;
  /** Item name */
  item_name: string;
  /** Item rarity: common | uncommon | rare | epic | legendary | mythical */
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythical";
  /** Item level requirement */
  level: number;
  /** Price in gold coins */
  price: number;
  /** Item description */
  description?: string;
  /** Item image URLs */
  images?: string[];
  /** Listing status: 'active' | 'sold' | 'removed' */
  status: "active" | "sold" | "removed";
  /** Creation timestamp */
  created_at: number;
  /** Expiration timestamp (for auto-removal) */
  expires_at?: number;
}

export interface DbTradeTransaction {
  id: string;
  /** Listing that was sold */
  listing_id: string;
  /** Seller user ID */
  seller_id: UserId;
  /** Buyer user ID */
  buyer_id: UserId;
  /** Final sale price */
  price: number;
  /** Transaction timestamp */
  created_at: number;
}

// ============================================================
// Party & LFG Types
// ============================================================

export interface DbParty {
  id: string;
  /** Party leader user ID */
  leader_id: UserId;
  /** Party name/title */
  name: string;
  /** Game/dungeon they want to run */
  game_mode?: string;
  /** Max party size */
  max_size: number;
  /** Party status: 'open' | 'closed' | 'in_progress' | 'completed' */
  status: "open" | "closed" | "in_progress" | "completed";
  /** Required minimum level */
  min_level?: number;
  /** Required role/archetype */
  required_role?: string;
  /** Party creation timestamp */
  created_at: number;
  /** When party started */
  started_at?: number;
  /** When party ended */
  ended_at?: number;
}

export interface DbPartyMember {
  id: string;
  /** Party ID */
  party_id: string;
  /** User ID */
  user_id: UserId;
  /** User's role in party */
  role: "leader" | "member";
  /** When user joined */
  joined_at: number;
}

// ============================================================
// Moderation & Admin Types
// ============================================================

export interface DbBan {
  id: string;
  /** Banned user ID */
  user_id: UserId;
  /** Server ID (null for global ban) */
  server_id?: ServerId;
  /** Who issued this ban */
  banned_by: UserId;
  /** Ban reason */
  reason?: string;
  /** When ban expires (null for permanent) */
  expires_at?: number;
  /** When ban was issued */
  created_at: number;
}

export interface DbMute {
  id: string;
  /** Muted user ID */
  user_id: UserId;
  /** Server ID */
  server_id: ServerId;
  /** Who issued this mute */
  muted_by: UserId;
  /** Mute reason */
  reason?: string;
  /** When mute expires */
  expires_at: number;
  /** When mute was issued */
  created_at: number;
}

export interface DbReport {
  id: string;
  /** Reporter user ID */
  reporter_id: UserId;
  /** Reported user ID */
  reported_user_id: UserId;
  /** Server ID (if related to server) */
  server_id?: ServerId;
  /** Channel ID (if related to channel) */
  channel_id?: ChannelId;
  /** Message ID (if related to message) */
  message_id?: string;
  /** Report reason */
  reason: string;
  /** Additional details */
  details?: string;
  /** Report status: 'pending' | 'reviewed' | 'resolved' | 'dismissed' */
  status: "pending" | "reviewed" | "resolved" | "dismissed";
  /** When report was created */
  created_at: number;
  /** When report was reviewed */
  reviewed_at?: number;
}

// ============================================================
// Role Types
// ============================================================

export interface DbRole {
  id: RoleId;
  /** Server this role belongs to */
  server_id: ServerId;
  /** Role name */
  name: string;
  /** Role color (hex) */
  color: string;
  /** Role position (higher = more powerful) */
  position: number;
  /** Role permissions bitmask */
  permissions: number;
  /** Whether this is the default everyone role */
  is_default: boolean;
  /** Whether this role is hoisted in member list */
  hoist: boolean;
  /** Role creation timestamp */
  created_at: number;
}

// ============================================================
// Notification Types
// ============================================================

export interface DbNotification {
  id: string;
  /** Recipient user ID */
  user_id: UserId;
  /** Notification type: 'mention' | 'dm' | 'friend_request' | 'party_invite' */
  type: "mention" | "dm" | "friend_request" | "party_invite";
  /** Notification title */
  title: string;
  /** Notification content */
  content: string;
  /** Related entity ID (message_id, user_id, party_id, etc.) */
  entity_id?: string;
  /** Related server ID */
  server_id?: ServerId;
  /** Related channel ID */
  channel_id?: ChannelId;
  /** Whether notification has been read */
  is_read: boolean;
  /** Creation timestamp */
  created_at: number;
}
