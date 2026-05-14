/**
 * User balance — 人民币余额 (RMB) + 游戏币余额 (gold).
 *
 * Stored in the `user_balances` CloudBase collection.
 * Schema: { user_id: string, rmb: number, gold: number, updated_at: string }
 *
 * TODO: Replace `supabase` calls with the game API once provided.
 */

import { supabase } from "@/lib/supabase";
import { create } from "zustand";

export type UserBalance = {
  user_id: string;
  rmb: number;
  gold: number;
  updated_at: string;
};

type BalanceStore = {
  balance: UserBalance | null;
  loading: boolean;
  fetch: (userId: string) => Promise<void>;
  /** Deduct from gold balance; returns true on success. */
  deductGold: (userId: string, amount: number) => Promise<boolean>;
  /** Deduct from RMB balance; returns true on success. */
  deductRmb: (userId: string, amount: number) => Promise<boolean>;
  /** Add RMB balance (after payment confirmation). */
  creditRmb: (userId: string, amount: number) => Promise<void>;
  /** Add to gold balance (e.g. seller receives payment). */
  creditGold: (userId: string, amount: number) => Promise<void>;
};

/**
 * Credit gold to ANY user's balance directly via DB (does not touch the
 * local zustand store — use this when crediting a user other than the
 * currently logged-in one, e.g. paying a seller after a buyout).
 */
export async function creditGoldRaw(userId: string, amount: number): Promise<boolean> {
  const ts = new Date().toISOString();
  const { data } = await supabase.from("user_balances").select("gold, rmb, updated_at").eq("user_id", userId).single();
  const next = (data?.gold ?? 0) + amount;
  const { error } = (data as { updated_at?: string } | null)?.updated_at
    ? await supabase.from("user_balances").update({ gold: next, updated_at: ts } as never).eq("user_id", userId)
    : await supabase.from("user_balances").insert({ user_id: userId, gold: next, rmb: (data as { rmb?: number } | null)?.rmb ?? 0, updated_at: ts } as never);
  return !error;
}

export const useBalance = create<BalanceStore>((set, get) => ({
  balance: null,
  loading: false,

  fetch: async (userId: string) => {
    set({ loading: true });
    const { data } = await supabase
      .from("user_balances")
      .select("*")
      .eq("user_id", userId)
      .single();
    set({
      balance: data ? (data as unknown as UserBalance) : { user_id: userId, rmb: 0, gold: 0, updated_at: "" },
      loading: false,
    });
  },

  deductGold: async (userId: string, amount: number) => {
    const { balance } = get();
    const cur = balance?.gold ?? 0;
    if (cur < amount) return false;
    const next = cur - amount;
    const ts = new Date().toISOString();
    const { error } = balance?.updated_at
      ? await supabase.from("user_balances").update({ gold: next, updated_at: ts } as never).eq("user_id", userId)
      : await supabase.from("user_balances").insert({ user_id: userId, gold: next, rmb: balance?.rmb ?? 0, updated_at: ts } as never);
    if (error) return false;
    set({ balance: balance ? { ...balance, gold: next } : null });
    return true;
  },

  deductRmb: async (userId: string, amount: number) => {
    const { balance } = get();
    const cur = balance?.rmb ?? 0;
    if (cur < amount) return false;
    const next = +(cur - amount).toFixed(2);
    const ts = new Date().toISOString();
    const { error } = balance?.updated_at
      ? await supabase.from("user_balances").update({ rmb: next, updated_at: ts } as never).eq("user_id", userId)
      : await supabase.from("user_balances").insert({ user_id: userId, rmb: next, gold: balance?.gold ?? 0, updated_at: ts } as never);
    if (error) return false;
    set({ balance: balance ? { ...balance, rmb: next } : null });
    return true;
  },

  /** Add RMB balance (e.g. after payment confirmation). */
  creditRmb: async (userId: string, amount: number) => {
    const { balance } = get();
    const next = +(( balance?.rmb ?? 0) + amount).toFixed(2);
    const ts = new Date().toISOString();
    if (balance?.updated_at) {
      await supabase.from("user_balances").update({ rmb: next, updated_at: ts } as never).eq("user_id", userId);
    } else {
      await supabase.from("user_balances").insert({ user_id: userId, rmb: next, gold: balance?.gold ?? 0, updated_at: ts } as never);
    }
    set({ balance: balance ? { ...balance, rmb: next } : null });
  },

  creditGold: async (userId: string, amount: number) => {
    const { balance } = get();
    const next = (balance?.gold ?? 0) + amount;
    const ts = new Date().toISOString();
    if (balance?.updated_at) {
      await supabase.from("user_balances").update({ gold: next, updated_at: ts } as never).eq("user_id", userId);
    } else {
      await supabase.from("user_balances").insert({ user_id: userId, gold: next, rmb: balance?.rmb ?? 0, updated_at: ts } as never);
    }
    set({ balance: balance ? { ...balance, gold: next } : null });
  },
}));
