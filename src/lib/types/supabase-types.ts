/**
 * Supabase-compatible API types
 * 
 * These types define the interface exposed by cloudbase-supabase.ts,
 * which provides a Supabase-like API backed by CloudBase.
 */

// ============================================================
// Query Builder Types
// ============================================================

export type QueryOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

export interface QueryFilter {
  field: string;
  op: QueryOperator;
  value: unknown;
}

export type QueryMode = "select" | "insert" | "update" | "delete";

export interface OrderOptions {
  ascending?: boolean;
}

/** Standard result shape matching Supabase JS client */
export interface SupabaseResult<T = unknown> {
  data: T | null;
  error: SupabaseError | null;
}

export interface SupabaseError {
  message: string;
  details?: string;
  hint?: string;
}

// ============================================================
// Realtime Channel Types  
// ============================================================

export type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export interface RealtimeChannelConfig {
  table: string;
  filter?: string;  // e.g., "channel_id=eq.123"
  event?: RealtimeEvent;
}

export interface PresenceChannelConfig {
  table?: string;
  room: string;
  config?: {
    presence?: {
      key: string;
    };
  };
}

/** Event payload for postgres_changes events */
export interface PostgresChangeEvent<T = unknown> {
  /** Event type */
  eventType: RealtimeEvent;
  
  /** The affected table */
  table: string;
  
  /** The affected record */
  record: T;
  
  /** Old record values (for UPDATE/DELETE) */
  old_record?: T;
}

/** Callback for postgres_changes events */
export type PostgresChangeCallback<T = unknown> = (
  payload: PostgresChangeEvent<T>
) => void;

// ============================================================
// Channel Subscription Types
// ============================================================

export type SubscriptionStatus = 
  | "joined" 
  | "joining" 
  | "left" 
  | "error"
  | "closed";

export interface RealtimeChannel {
  /** Unique channel name */
  name: string;
  
  /** Current subscription status */
  status: SubscriptionStatus;
  
  /** Subscribe to realtime events */
  subscribe(callback?: (status: SubscriptionStatus) => void): RealtimeChannel;
  
  /** Unsubscribe and clean up */
  unsubscribe(): void;
  
  /** Whether channel is currently subscribed */
  isSubscribed(): boolean;
  
  /** Whether channel has an error */
  onError(): Error | null;
}

// ============================================================
// Presence Types (best-effort via polling)
// ============================================================

export interface PresenceState {
  [key: string]: Record<string, unknown>;
}

export interface PresenceChange {
  type: "sync" | "enter" | "leave" | "update";
  key: string;
  state: Record<string, unknown>;
}

export type PresenceCallback = (changes: PresenceChange[]) => void;
