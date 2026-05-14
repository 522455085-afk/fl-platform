"use client";

/**
 * Backend re-export hub.
 *
 * The codebase was originally written against the Supabase JS SDK. We later
 * migrated to Tencent CloudBase (better China connectivity). This module
 * re-exports a Supabase-shaped client that is actually backed by CloudBase
 * via `cloudbase-supabase.ts`, so application code (auth-store, ChatView,
 * TradeMarketView, PartyView, MemberList) continues to work unmodified.
 *
 * If you ever need to swap the backend again (e.g. self-hosted Supabase),
 * change only this file to re-export the new adapter.
 */

export { supabase } from "./cloudbase-supabase";
export type {
  DbMessage,
  DbProfile,
  DbTradeListing,
  DbAuctionListing,
  DbParty,
  PartyMember,
} from "./supabase-types";
