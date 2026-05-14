/**
 * CloudBase SDK Type Definitions
 * 
 * 实际的 CloudBase Web SDK 类型定义。
 * 基于 @cloudbase/js-sdk 的实际 API。
 */

// ============================================================
// Core SDK Types
// ============================================================

/** User info returned by getUserInfo() */
export interface IUserInfo {
  /** User's unique identifier (from auth) */
  id?: string;
  
  /** User's unique identifier */
  uid: string;
  
  /** User's display name */
  nickName?: string;
  
  /** User's username (for login) */
  username?: string;
  
  /** User's avatar URL */
  avatarUrl?: string;
  
  /** User's email */
  email?: string;
  
  /** User's phone number */
  phoneNumber?: string;
}

/** Login state returned by getLoginState() */
export interface ILoginState {
  /** Whether user is logged in */
  login: boolean;
  
  /** User's unique identifier */
  uid?: string;
  
  /** Custom login state */
  custom?: boolean;
}

/** Session object in auth state change callback */
export interface ISession {
  /** User ID */
  uid: string;
  
  /** Login type */
  loginType: string;
  
  /** Custom token */
  customToken?: string;
}

// ============================================================
// Auth Types
// ============================================================

/** CloudBase auth instance */
export interface IAuth {
  /** Get current login state */
  getLoginState(): Promise<ILoginState | null>;
  
  /** Sign in with email and password */
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: IUserInfo | null };
    error: Error | null;
  }>;
  
  /** Sign up with email and password */
  signUp(params: { email: string; password: string; name?: string }): Promise<{
    data: { user: { id?: string; email?: string; username?: string } | null };
    error: Error | null;
  }>;
  
  /** Sign in anonymously */
  signInAnonymously(): Promise<{ err: string | null }>;
  
  /** Get current user info */
  getUserInfo(): Promise<{ err: string | null; userInfo: IUserInfo | null }>;
  
  /** Sign out */
  signOut(): Promise<{ err: string | null }>;
  
  /** Link anonymous user to anonymous */
  linkAnonymousProvider(): Promise<{ err: string | null }>;
  
  /** Custom authentication */
  signInWithTicket(ticket: string): Promise<{ err: string | null }>;
  
  /** Watch for auth state changes */
  onLoginStateChanged(callback: (loginState: ILoginState | null) => void): void;
  
  /** Watch for auth state changes (alias) */
  onAuthStateChanged(callback: (session: ISession | null) => void): void;
}

// ============================================================
// Database Types
// ============================================================

/** Realtime snapshot for watch() */
export interface RealtimeSnapshot<T = Record<string, unknown>> {
  /** Document changes */
  docChanges?: Array<{
    /** Change type */
    dataType?: "add" | "update" | "remove";
    /** Changed document */
    doc?: T;
    /** Document ID */
    id?: string;
    /** Whether this is the initial snapshot */
    isInit?: boolean;
  }>;
  
  /** All documents in the query */
  docs?: T[];
  
  /** Snapshot ID */
  id?: number;
  
  /** Snapshot type */
  type?: string;
}

/** CloudBase document reference */
export interface IDocReference {
  /** Get document data */
  get(): Promise<{ data: Record<string, unknown> | null; err: string | null }>;
  
  /** Update document */
  update(doc: Record<string, unknown>): Promise<{ updated: number; err: string | null }>;
  
  /** Remove document */
  remove(): Promise<{ deleted: number; err: string | null }>;
  
  /** Set document (replace or create) */
  set(doc: Record<string, unknown>): Promise<{ id: string; err: string | null }>;
}

/** CloudBase query result (after where/limit/orderBy) with watch support */
export interface ICollectionQuery {
  /** Execute query */
  get(): Promise<{ data: Record<string, unknown>[]; err: string | null }>;
  
  /** Watch for realtime changes */
  watch(callbacks: {
    onChange: (snapshot: RealtimeSnapshot) => void;
    onError?: (error: Error) => void;
  }): { close: () => void };
}

/** CloudBase database collection reference */
export interface ICollection {
  /** Add a document to the collection */
  add<T extends Record<string, unknown>>(doc: T): Promise<{ id: string; err: string | null }>;
  
  /** Query documents */
  get(): Promise<{ data: Record<string, unknown>[]; err: string | null }>;
  
  /** Apply where clause */
  where(query: Record<string, unknown>): ICollectionQuery;
  
  /** Apply limit */
  limit(count: number): ICollectionQuery;
  
  /** Apply order by */
  orderBy(field: string, order: "asc" | "desc"): ICollectionQuery;
  
  /** Update matching documents */
  update(doc: Record<string, unknown>): Promise<{ updated: number; err: string | null }>;
  
  /** Remove matching documents */
  remove(): Promise<{ deleted: number; err: string | null }>;
  
  /** Get a specific document by ID */
  doc(id: string): IDocReference;
  
  /** Watch for realtime changes */
  watch(callbacks: {
    onChange: (snapshot: RealtimeSnapshot) => void;
    onError?: (error: Error) => void;
  }): { close: () => void };
}

/** CloudBase database command operators */
export interface IDatabaseCommand {
  /** Equal to */
  eq(value: unknown): Record<string, unknown>;
  
  /** Not equal to */
  neq(value: unknown): Record<string, unknown>;
  
  /** Greater than */
  gt(value: number): Record<string, unknown>;
  
  /** Greater than or equal */
  gte(value: number): Record<string, unknown>;
  
  /** Less than */
  lt(value: number): Record<string, unknown>;
  
  /** Less than or equal */
  lte(value: number): Record<string, unknown>;
  
  /** In array */
  in(values: unknown[]): Record<string, unknown>;
  
  /** Not in array */
  nin(values: unknown[]): Record<string, unknown>;
  
  /** AND operator */
  and(conditions: Record<string, unknown>[]): Record<string, unknown>;
  
  /** OR operator */
  or(conditions: Record<string, unknown>[]): Record<string, unknown>;
  
  /** Push to array */
  push(...values: unknown[]): Record<string, unknown>;
  
  /** Pull from array */
  pull(...values: unknown[]): Record<string, unknown>;
  
  /** Increment value */
  inc(value: number): Record<string, unknown>;
  
  /** Multiply value */
  mul(value: number): Record<string, unknown>;
  
  /** Set field if not exists */
  set(value: unknown): Record<string, unknown>;
  
  /** Remove field */
  remove(): Record<string, unknown>;
}

/** CloudBase database instance */
export interface IDatabase {
  /** Get a collection reference */
  collection(name: string): ICollection;
  
  /** Get database command operators */
  command: IDatabaseCommand;
  
  /** Get server timestamp */
  serverDate(): Record<string, unknown>;
}

// ============================================================
// App Types
// ============================================================

/** CloudBase application instance */
export interface ICloudBaseApp {
  /** Database instance */
  database(): IDatabase;
  
  /** Auth instance */
  auth(): IAuth;
  
  /** Call cloud function */
  callFunction?<R = unknown>(options: {
    name: string;
    data?: Record<string, unknown>;
  }): Promise<{ result: R; err: string | null }>;
  
  /** Storage instance */
  storage?: {
    /** Upload file */
    uploadFile(options: {
      cloudPath: string;
      fileContent: File | Blob;
    }): Promise<{ fileID: string; err: string | null }>;
    
    /** Download file */
    downloadFile(options: {
      fileID: string;
    }): Promise<{ fileContent: Blob; err: string | null }>;
    
    /** Delete file */
    deleteFile(options: {
      fileList: string[];
    }): Promise<{ fileList: Array<{ fileID: string; code: string }>; err: string | null }>;
  };
}

// ============================================================
// Auth State Change Types
// ============================================================

export type AuthEventType = 
  | "signIn"
  | "signOut" 
  | "signInFailed"
  | "tokenRefresh"
  | "anonymousConvert";

export type AuthChangePayload = {
  event: AuthEventType;
  session?: ISession | null;
  error?: Error | null;
};

// ============================================================
// Realtime Subscription Types
// ============================================================

export type RealtimeEventType = "insert" | "update" | "remove";

export interface RealtimeDocChange<T = Record<string, unknown>> {
  /** Change type */
  dataType: RealtimeEventType;
  
  /** Changed document */
  doc: T;
  
  /** Document ID */
  id: string;
  
  /** Whether this is the initial snapshot */
  isInit?: boolean;
}

/** Callback type for realtime document changes */
export type RealtimeChangeCallback<T = Record<string, unknown>> = (
  snapshot: RealtimeSnapshot<T>
) => void;

/** Callback type for realtime errors */
export type RealtimeErrorCallback = (error: Error) => void;

/** Listener unsubscribe function */
export type Unsubscribe = () => void;

// ============================================================
// Presence Types
// ============================================================

export interface PresenceState {
  /** User ID */
  uid: string;
  
  /** Online status */
  status: "online" | "offline";
  
  /** Last seen timestamp */
  lastSeen?: number;
  
  /** Custom status message */
  statusMessage?: string;
}

export interface PresenceChangeEvent {
  /** User ID */
  uid: string;
  
  /** New status */
  status: "online" | "offline";
  
  /** Timestamp */
  timestamp: number;
}

// ============================================================
// Database Query Result Types
// ============================================================

/** Standard query result matching Supabase API shape */
export interface QueryResult<T = Record<string, unknown>> {
  data: T[] | null;
  error: Error | null;
  count?: number | null;
}

/** Single document result */
export interface SingleResult<T = Record<string, unknown>> {
  data: T | null;
  error: Error | null;
}

/** Query error */
export interface QueryError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

// ============================================================
// Cloud Function Types
// ============================================================

/** Cloud function call result */
export interface CloudFunctionResult<T = unknown> {
  /** Function return value */
  result: T;
  
  /** Error message */
  err: string | null;
  
  /** Request ID */
  requestId?: string;
}

/** Admin action result */
export interface AdminActionResult {
  /** Error code (0 = success) */
  code: number;
  
  /** Error message */
  message: string;
  
  /** Additional data */
  data?: Record<string, unknown>;
}
