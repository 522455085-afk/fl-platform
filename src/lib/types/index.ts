/**
 * Global type exports
 * Re-exports all type definitions for easy importing.
 */

// CloudBase SDK types
export type {
  ICollection,
  IDocReference,
  IDatabaseCommand,
  IDatabase,
  IAuth,
  ILoginState,
  IUserInfo,
  ICloudBaseApp,
  AuthEventType,
  AuthChangePayload,
  ISession,
  RealtimeEventType,
  RealtimeDocChange,
  RealtimeSnapshot,
  RealtimeChangeCallback,
  RealtimeErrorCallback,
  Unsubscribe,
  PresenceState,
  PresenceChangeEvent,
  QueryResult,
  QueryError,
  SingleResult,
} from "./cloudbase-types";

// Supabase-compatible API types
export type {
  QueryOperator,
  QueryFilter,
  QueryMode,
  OrderOptions,
  SupabaseResult,
  SupabaseError,
  RealtimeEvent,
  RealtimeChannelConfig,
  PresenceChannelConfig,
  PostgresChangeEvent,
  PostgresChangeCallback,
  SubscriptionStatus,
  RealtimeChannel,
  PresenceChange,
  PresenceCallback,
} from "./supabase-types";

// Database row types
export type {
  ServerId,
  ChannelId,
  UserId,
  MessageId,
  RoleId,
} from "./db-types";

export type {
  DbServer,
  DbChannel,
  DbServerMember,
  DbMessage,
  DbReaction,
  DbDmThread,
  DbDmMessage,
  DbUserProfile,
  DbFriendRequest,
  DbFriendship,
  DbTradeListing,
  DbTradeTransaction,
  DbParty,
  DbPartyMember,
  DbBan,
  DbMute,
  DbReport,
  DbRole,
  DbNotification,
} from "./db-types";
