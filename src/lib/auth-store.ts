"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { app, db } from "@/lib/cloudbase";
import { genVanityId } from "@/lib/vanity-id";
import { isDeletedUser } from "@/lib/deleted-user";
import { deriveAvatarText } from "@/lib/avatar-upload";
import { claimSession, releaseSession, resetKickLatch } from "@/lib/sessions";

// ============================================================
// localStorage profile cache
// When CloudBase is unreachable on bootstrap, queries fail with
// empty {} network errors. We persist the last successfully
// loaded profile so the user sees their own data immediately
// instead of an empty/default state every time the backend hiccups.
// ============================================================
import type { ICloudBaseApp } from "@/lib/types";

const PROFILE_CACHE_PREFIX = "fl_pcache_";
// Cache expires after 5 minutes — frequent enough to stay fresh but
// short enough to avoid stale data issues (avatar default, etc.)
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

interface CachedProfile {
  user: AuthUser;
  cachedAt: number;
}

function saveProfileToCache(p: AuthUser): void {
  if (typeof window === "undefined") return;
  try {
    const cached: CachedProfile = { user: p, cachedAt: Date.now() };
    localStorage.setItem(PROFILE_CACHE_PREFIX + p.id, JSON.stringify(cached));
  } catch { /* quota */ }
}
function loadProfileFromCache(userId: string): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + userId);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedProfile;
    // Check if cache has expired
    if (Date.now() - cached.cachedAt > CACHE_EXPIRY_MS) {
      localStorage.removeItem(PROFILE_CACHE_PREFIX + userId);
      return null;
    }
    return cached.user;
  } catch { return null; }
}
function clearProfileCache(userId: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(PROFILE_CACHE_PREFIX + userId); } catch {}
}

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  avatar: string;
  avatarColor: string;
  /** Optional uploaded image (dataURL or http URL). When present, render
   * <img src> instead of the letter + color avatar. */
  avatarUrl?: string | null;
  /** 8-digit human-readable id (玩家号). Generated on first profile creation. */
  numericId?: string | null;
  phone?: string | null;
  phoneVerifiedAt?: string | null;
  realNameVerifiedAt?: string | null;
};

type RegisterResult =
  | { ok: true; needVerify: false }
  | { ok: true; needVerify: true; pendingEmail: string; pendingUsername: string }
  | { ok: false; error: string };

type AuthState = {
  user: AuthUser | null;
  hydrated: boolean;
  setUser: (u: AuthUser | null) => void;
  setHydrated: (v: boolean) => void;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (
    username: string,
    email: string,
    password: string,
  ) => Promise<RegisterResult>;
  /**
   * Complete signup by submitting the OTP code that CloudBase emailed.
   * Pass back the `pendingEmail` / `pendingUsername` returned by `register`.
   */
  verifySignUp: (
    email: string,
    code: string,
    username: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Mock phone-binding: pretends to send an SMS. Returns a token client-side
   * so we can later swap in a real CloudBase OTP call without changing the UI.
   */
  requestPhoneCode: (
    phone: string,
  ) => Promise<{ ok: boolean; error?: string; mockCode?: string }>;
  /**
   * Mock confirm: any 6-digit numeric code is accepted. Updates the local
   * auth user + writes phone/phone_verified_at into the profiles row.
   */
  bindPhone: (
    phone: string,
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  unbindPhone: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Update one or more editable fields on the user's profile row.
   * Returns {ok:true} and patches the local zustand user on success.
   */
  updateProfile: (patch: {
    username?: string;
    avatar?: string;
    avatar_color?: string;
    /** Pass `null` to clear the uploaded image and fall back to the letter. */
    avatar_url?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Update the CloudBase auth password. Requires the current password for
   * re-authentication before change.
   */
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Soft-delete the current user's account. Marks the profile row with
   * `deleted_at`, redacts identifying fields, removes membership rows,
   * then signs out. The CloudBase auth row itself stays — fully purging
   * it requires an admin / cloud-function call we haven't built yet.
   */
  deleteAccount: () => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
};

/**
 * CloudBase's `auth.signUp()` returns a `verifyOtp` callback in its response
 * that already has the internal messageId baked in. We stash it here between
 * the "send code" step and the "input code" step so the call site doesn't
 * need to know about messageId at all.
 *
 * Lives at module scope (not in zustand) because it's a runtime-only
 * function reference, not serializable state.
 */
type VerifyOtpResult = { user: AuthUser | null; error: string | null };
let pendingVerifyOtp: ((params: { token: string }) => Promise<VerifyOtpResult>) | null = null;

/**
 * Username the user typed during the LAST register call. Stashed here so
 * that `onAuthStateChange` — which fires automatically once CloudBase
 * verifies the OTP and may RACE with our explicit `ensureProfile` call in
 * `verifySignUp` — can still pick up the chosen name. Without this, the
 * auth-state-change branch inserts a profile row with `username = email
 * prefix`, and the user's chosen handle is lost forever.
 *
 * Cleared after a successful insert/update so it doesn't leak into a
 * future login of a different account.
 */
let pendingRegisterUsername: { email: string; username: string } | null = null;

const AVATAR_COLORS = [
  "#d4a056", // ember gold
  "#9b6dd9", // arcane purple
  "#7e3a8c", // royal violet
  "#c64b3e", // ember red
  "#5a8c7d", // moss teal
  "#b8763a", // bronze
  "#6db26d", // forest
  "#3a6e9b", // twilight blue
];

function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export const useAuth = create<AuthState>()((set, get) => ({
  user: null,
  hydrated: false,
  setUser: (u) => set({ user: u }),
  setHydrated: (v) => set({ hydrated: v }),

  login: async (email, password) => {
    if (!email.trim() || !password.trim()) {
      return { ok: false, error: "邮箱和密码不能为空" };
    }
     
    console.log("[auth] login start:", email.trim());
    try {
      const result = await withTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        12000,
        "登录请求超时（12s）。请检查网络后重试。",
      );
      const { data, error } = result;
       
      console.log("[auth] login result:", { hasUser: !!data?.user, error: error?.message });
      if (error) return { ok: false, error: translateAuthError(error.message) };
      if (!data?.user) return { ok: false, error: "登录失败：服务器未返回用户" };

      // ----- Tombstone check -----
      // If this profile was tombstoned by deleteAccount (deleted_at set or
      // username starts with __deleted_), refuse to load it. We sign back
      // out and surface a generic "账号或密码错误" so the user sees the
      // exact same message they'd get for a non-existent account — no info
      // leak, and no chance of resurrection via `ensureProfile`.
      try {
        const { data: tomb } = await supabase
          .from("profiles")
          .select("deleted_at, username")
          .eq("id", data.user.id)
          .maybeSingle();
        const tRow = tomb as { deleted_at?: unknown; username?: string } | null;
        if (
          tRow &&
          (tRow.deleted_at || isDeletedUser(tRow.username))
        ) {
          console.warn("[auth] login blocked: account is tombstoned", {
            userId: data.user.id,
          });
          try {
            await supabase.auth.signOut();
          } catch {
            /* ignore */
          }
          return { ok: false, error: "账号或密码错误" };
        }
      } catch (e) {
        // Non-fatal — fall through to normal ensureProfile path.
        console.warn("[auth] tombstone pre-check failed (non-fatal):", e);
      }

      // ----- Permanent ban check -----
      // Block login if this account has any rows in `bans`. We do this
      // BEFORE setting the auth user so a banned account never reaches
      // the in-app state. The reason is surfaced in the login error
      // so the user understands why they were rejected (and who).
      try {
        const { getActiveBan } = await import("@/lib/ban-store");
        const ban = await getActiveBan(data.user.id);
        if (ban) {
          console.warn("[auth] login blocked: account is banned", {
            userId: data.user.id,
            banId: ban.id,
          });
          try {
            await supabase.auth.signOut();
          } catch {
            /* ignore */
          }
          return {
            ok: false,
            error: `账号已被「${ban.banned_by_name}」永久封禁。原因：${ban.reason}`,
          };
        }
      } catch (e) {
        // Missing collection or transient failure — non-fatal. The
        // BanWatcher will catch any outstanding bans within 30s.
        console.warn("[auth] ban pre-check failed (non-fatal):", e);
      }

      const profile = await ensureProfile(
        data.user.id,
        data.user.email || data.user.username || email.trim(),
      );
      set({ user: profile });

      // Claim our session slot. Kicks any other active session of the
      // same device-type for this user (PC ↔ PC, Android ↔ Android,
      // iOS ↔ iOS). Per Q2-2 (默认踢) we don't ask the user first —
      // the kicked tab will see kicked_at within ~8s and self-logout.
      resetKickLatch();
      try {
        await claimSession(profile.id);
      } catch (e) {
        console.warn("[auth] claimSession failed (non-fatal):", e);
      }

      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
       
      console.error("[auth] login exception:", e);
      // ensureProfile throws "此账号已注销" for tombstoned profiles
      // (defense in depth); re-map to the same generic error.
      if (typeof msg === "string" && msg.includes("已注销")) {
        return { ok: false, error: "账号或密码错误" };
      }
      return { ok: false, error: msg };
    }
  },

  register: async (username, email, password) => {
    if (!username.trim() || !email.trim() || !password.trim()) {
      return { ok: false, error: "请填写所有字段" };
    }
    if (!email.includes("@")) return { ok: false, error: "邮箱格式不正确" };
    if (password.length < 6) return { ok: false, error: "密码至少 6 位" };

    // Stash IMMEDIATELY (before any async I/O) so the onAuthStateChange
    // listener — which CloudBase may fire as soon as signUp completes
    // either with-or-without OTP — has the chosen username available.
    // Was previously only set in the OTP branch; the direct-registration
    // path (CloudBase configs that don't require email verification) was
    // dropping the username on the floor.
    pendingRegisterUsername = {
      email: email.trim(),
      username: username.trim(),
    };

     
    console.log("[auth] register start:", email.trim());
    try {
      const result = await withTimeout<{ user?: { id: string; email?: string; username?: string }; verifyOtp?: typeof pendingVerifyOtp; error?: { message: string } }>(
        supabase.auth.signUp({
          email: email.trim(),
          password,
          name: username.trim(),
        }) as Promise<{ user?: { id: string; email?: string; username?: string }; verifyOtp?: typeof pendingVerifyOtp; error?: { message: string } }>,
        12000,
        "注册请求超时（12s）。请检查网络后重试。",
      );
      const { data, error } = result;
       
      console.log("[auth] register result:", {
        hasUser: !!data?.user,
        hasVerifyOtp: !!data?.verifyOtp,
        error: error?.message,
      });
      if (error) {
        pendingRegisterUsername = null; // unstash on failure
        return { ok: false, error: translateAuthError(error.message) };
      }

      // CloudBase 启用了"邮箱验证码"时，signUp 不会立刻返回 user/session，
      // 而是返回 data.verifyOtp 回调（已携带 messageId），让我们在用户输入
      // 验证码后调用它来完成验证。把它暂存到模块作用域。
      if (!data?.user) {
        pendingVerifyOtp = data?.verifyOtp || null;
        return {
          ok: true,
          needVerify: true,
          pendingEmail: email.trim(),
          pendingUsername: username.trim(),
        };
      }
      // 已经直接返回 user 的少数情况：清掉残留的 verifyOtp。
      pendingVerifyOtp = null;

      // 万一已经直接发了 session（极少数配置下），就走完整流程
      const profile = await ensureProfile(
        data.user.id,
        data.user.email || data.user.username || email.trim(),
        username.trim(),
      );
      // Defensive: if a racing onAuthStateChange listener inserted the
      // row before we could and our `chosen` lost the race, force the
      // canonical value here. Idempotent if it's already correct.
      if (profile.username !== username.trim()) {
         
        console.warn(
          "[auth] register: profile username mismatch after ensureProfile, forcing override",
          { got: profile.username, want: username.trim() },
        );
        await enforceUsername(profile.id, username.trim());
        profile.username = username.trim();
      }
      set({ user: profile });
      return { ok: true, needVerify: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
       
      console.error("[auth] register exception:", e);
      return { ok: false, error: msg };
    }
  },

  verifySignUp: async (email, code, username) => {
    if (!code.trim()) return { ok: false, error: "请输入邮件中的验证码" };
     
    console.log("[auth] verifySignUp:", email, "hasCallback:", !!pendingVerifyOtp);
    try {
      // 优先用 signUp 返回的 verifyOtp 回调（自带 messageId）。
      // 万一调用方不是从 register 流程进来（如刷新过页），降级走全局 verifyOtp。
      const verifyPromise: Promise<CloudBaseVerifyOtpResponse> = pendingVerifyOtp
        ? pendingVerifyOtp({ token: code.trim() })
        : (supabase.auth.verifyOtp({
            email: email.trim(),
            token: code.trim(),
            type: "signup",
          }) as Promise<CloudBaseVerifyOtpResponse>);
      const result = await withTimeout<CloudBaseVerifyOtpResponse>(
        verifyPromise,
        12000,
        "验证请求超时（12s），请检查网络后重试。",
      );
      const { data, error } = result;
       
      console.log("[auth] verifySignUp result:", {
        hasUser: !!data?.user,
        error: error?.message,
      });
      if (error) return { ok: false, error: translateAuthError(error.message) };
      if (!data?.user) return { ok: false, error: "验证失败：未返回用户" };

      // 验证成功，清掉缓存的回调
      pendingVerifyOtp = null;

      const profile = await ensureProfile(
        data.user.id,
        data.user.email || data.user.username || email.trim(),
        username.trim(),
      );
      // Defensive: race with the listener may have written the row first
      // with the email-prefix fallback. Force-write the chosen username
      // before the UI snapshots it.
      if (profile.username !== username.trim()) {
         
        console.warn(
          "[auth] verifySignUp: profile username mismatch, forcing override",
          { got: profile.username, want: username.trim() },
        );
        await enforceUsername(profile.id, username.trim());
        profile.username = username.trim();
      }
      set({ user: profile });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
       
      console.error("[auth] verifySignUp exception:", e);
      return { ok: false, error: msg };
    }
  },

  // ---------------------------------------------------------------
  // Phone binding (MOCK mode for now)
  //
  // - requestPhoneCode: pretends an SMS was sent. Returns mockCode = "123456"
  //   so the dev / tester can confirm without a real SMS provider. When you
  //   open the SMS template + signature on Tencent Cloud, replace the body
  //   of this function with `await supabase.auth.signInWithOtp({ phone })`.
  //
  // - bindPhone: any 6-digit numeric code is accepted. Writes phone +
  //   phone_verified_at to the user's profiles row and updates the local
  //   zustand store.
  // ---------------------------------------------------------------
  requestPhoneCode: async (phone) => {
    if (!/^\+?\d{6,15}$/.test(phone.replace(/\s|-/g, ""))) {
      return { ok: false, error: "手机号格式不正确" };
    }
     
    console.log("[auth] (mock) requestPhoneCode for:", phone);
    // Simulate latency.
    await new Promise((r) => setTimeout(r, 600));
    return { ok: true, mockCode: "123456" };
  },

  bindPhone: async (phone, code) => {
    const cleanPhone = phone.replace(/\s|-/g, "");
    if (!/^\+?\d{6,15}$/.test(cleanPhone)) {
      return { ok: false, error: "手机号格式不正确" };
    }
    if (!/^\d{6}$/.test(code.trim())) {
      return { ok: false, error: "验证码必须是 6 位数字" };
    }
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };

    const now = new Date().toISOString();
     
    console.log("[auth] bindPhone start, uid=", me.id, "phone=", cleanPhone);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ phone: cleanPhone, phone_verified_at: now })
        .eq("id", me.id);
      if (error) {
         
        console.error("[auth] bindPhone update error:", error);
        return {
          ok: false,
          error:
            error.message ||
            "写入失败。若持续出现请重新登录后再试（session 可能已过期）。",
        };
      }

      set({
        user: {
          ...me,
          phone: cleanPhone,
          phoneVerifiedAt: now,
        },
      });
       
      console.log("[auth] bindPhone success");
      return { ok: true };
    } catch (e) {
       
      console.error("[auth] bindPhone exception:", e);
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },

  unbindPhone: async () => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ phone: null, phone_verified_at: null })
        .eq("id", me.id);
      if (error) return { ok: false, error: error.message };

      set({
        user: { ...me, phone: null, phoneVerifiedAt: null },
      });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },

  updateProfile: async (patch) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };

    // Validate / normalize
    const dbPatch: Record<string, unknown> = {};
    if (patch.username !== undefined) {
      const u = patch.username.trim();
      if (u.length < 2 || u.length > 32) {
        return { ok: false, error: "用户名需 2-32 字符" };
      }
      dbPatch.username = u;
    }
    if (patch.avatar !== undefined) {
      const a = patch.avatar.trim().slice(0, 2) || me.avatar;
      dbPatch.avatar = a;
    }
    if (patch.avatar_color !== undefined) {
      dbPatch.avatar_color = patch.avatar_color;
    }
    if (patch.avatar_url !== undefined) {
      // Allow null/empty to clear the image. CloudBase treats `null` as
      // "remove field" effectively for our render checks.
      dbPatch.avatar_url = patch.avatar_url || null;
    }
    if (Object.keys(dbPatch).length === 0) {
      return { ok: false, error: "没有需要保存的改动" };
    }

     
    console.log("[auth] updateProfile patch:", dbPatch);

    try {
      const { error } = await supabase
        .from("profiles")
        .update(dbPatch)
        .eq("id", me.id);
      if (error) {
         
        console.error("[auth] updateProfile error:", error);
        return { ok: false, error: error.message || "保存失败" };
      }

      set({
        user: {
          ...me,
          username: (dbPatch.username as string) ?? me.username,
          avatar: (dbPatch.avatar as string) ?? me.avatar,
          avatarColor: (dbPatch.avatar_color as string) ?? me.avatarColor,
          avatarUrl:
            patch.avatar_url !== undefined
              ? (dbPatch.avatar_url as string | null)
              : me.avatarUrl,
        },
      });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "请先登录" };
    if (newPassword.length < 6) {
      return { ok: false, error: "新密码至少 6 位" };
    }
    if (newPassword === currentPassword) {
      return { ok: false, error: "新密码不能与旧密码相同" };
    }

    try {
      // CloudBase v3: re-auth with current password, then update via a
      // dedicated endpoint. The SDK exposes `auth.resetPasswordForOld(...)`.
      const authApi = supabase.auth as {
        resetPasswordForOld?: (opts: { old_password: string; new_password: string }) => Promise<{ error?: { message?: string } | null }>;
        signInWithPassword: (opts: { email: string; password: string }) => Promise<{ error?: { message?: string } | null }>;
        updateUser: (opts: { password: string }) => Promise<{ error?: { message?: string } | null }>;
      };
      if (typeof authApi.resetPasswordForOld === "function") {
        const { error } = await authApi.resetPasswordForOld({
          old_password: currentPassword,
          new_password: newPassword,
        });
        if (error) {
          return {
            ok: false,
            error: translateAuthError(error.message || "修改密码失败"),
          };
        }
        return { ok: true };
      }

      // Fallback: re-sign in to verify current password, then updateUser.
      const { error: verifyErr } = await authApi.signInWithPassword({
        email: me.email,
        password: currentPassword,
      });
      if (verifyErr) {
        return { ok: false, error: "当前密码不正确" };
      }
      const { error: updErr } = await authApi.updateUser({
        password: newPassword,
      });
      if (updErr) {
        return { ok: false, error: updErr.message || "修改密码失败" };
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
       
      console.error("[auth] changePassword exception:", e);
      return { ok: false, error: msg };
    }
  },

  deleteAccount: async () => {
    const me = useAuth.getState().user;
    if (!me) return { ok: false, error: "未登录" };

    // ---------------- Pre-flight guard (item A) ----------------
    // Refuse to注销 while the user is still creator of any custom server.
    // Otherwise the server keeps running with a "ghost" creator nobody can
    // reach, and the creator's slot is permanently locked. Force the user
    // to either transfer ownership or disband first.
    try {
      const owned = await db
        .collection("servers")
        .where({ creator_id: me.id })
        .limit(20)
        .get();
      const ownedRows = (owned?.data || []) as { name?: string }[];
      if (ownedRows.length > 0) {
        const names = ownedRows
          .map((s) => s.name || "未命名")
          .slice(0, 5)
          .join("、");
        const more =
          ownedRows.length > 5 ? `等 ${ownedRows.length} 个` : "";
        return {
          ok: false,
          error: `你仍是 ${ownedRows.length} 个服务器的领主（${names}${more}）。请先在服务器设置中「转让领主」或「解散服务器」，再回来注销账号。`,
        };
      }
    } catch (e) {
       
      console.warn("[auth] deleteAccount pre-flight check failed:", e);
      // Non-fatal — fall through and let the deletion attempt proceed. The
      // user can re-try later if data races against the rule.
    }

    // ---------------- Try the cloud function (item D) ----------------
    // The proper "hard delete" path: a privileged cloud function purges
    // both the CloudBase auth row and all owned data. If it isn't deployed
    // yet, the catch falls back to client-side soft delete so注销 still
    // does something useful.
    let hardDeleted = false;
    try {
      const appWithCallFn = app as ICloudBaseApp & {
        callFunction?: <R = unknown>(options: { name: string; data?: Record<string, unknown> }) => Promise<R>;
      };
      if (appWithCallFn && typeof appWithCallFn.callFunction === "function") {
        const res = await appWithCallFn.callFunction<{ ok?: boolean; error?: string }>({
          name: "delete-user",
          data: {},
        });
        // CloudBase shape: { result: { ok: boolean, error?: string } }
        const inner = res?.ok;
        if (inner) {
          hardDeleted = true;
          console.log("[auth] deleteAccount: hard-deleted via cloud function");
        } else {
          console.warn(
            "[auth] delete-user cloud function returned not-ok:",
            res,
          );
        }
      }
    } catch (e) {
       
      console.warn(
        "[auth] delete-user cloud function not available; falling back to soft delete:",
        e,
      );
    }

    // ---------------- Client-side soft delete (fallback) ----------------
    if (!hardDeleted) {
      const stamp = new Date().toISOString();
      const redacted = `__deleted_${me.id.slice(0, 8)}`;

      try {
        // 1. Mark profile as deleted + redact identifying fields. We keep the
        //    row (rather than hard-delete) so foreign references in messages,
        //    DM threads, etc. don't dangle into "unknown user" rendering.
         
        console.log(
          "[auth] deleteAccount: redacting profile row",
          { id: me.id, redactedUsername: redacted },
        );
        const updateRes = await supabase
          .from("profiles")
          .update({
            deleted_at: stamp,
            username: redacted,
            email: redacted,
            avatar: "?",
            avatar_url: null,
            phone: null,
            phone_verified_at: null,
          })
          .eq("id", me.id);
        const profileErr = updateRes?.error;
        if (profileErr) {
           
          console.error(
            "[auth] deleteAccount profile redact FAILED — soft delete is likely incomplete:",
            profileErr,
          );
        } else {
           
          console.log("[auth] deleteAccount: profile UPDATE call returned ok");
        }

        // 1b. VERIFY the redact actually persisted by reading the row back.
        //     If the row is unchanged, CloudBase data-permission rules
        //     blocked the UPDATE silently — we surface that to the caller
        //     so the UI can refuse to claim "deleted".
        try {
          const { data: verify } = await supabase
            .from("profiles")
            .select("id,username,deleted_at")
            .eq("id", me.id)
            .maybeSingle();
           
          console.log("[auth] deleteAccount verify-read:", verify);
          if (
            verify &&
            !(verify as Record<string, unknown>).deleted_at &&
            !((verify as Record<string, unknown>).username as string)?.startsWith(
              "__deleted_",
            )
          ) {
             
            console.error(
              "[auth] deleteAccount: row STILL has original username after UPDATE — CloudBase rule likely blocked the write",
            );
            return {
              ok: false,
              error:
                "注销失败：profile 数据权限规则阻止了删除操作。请联系主教开启「仅创建者可写」或部署 delete-user 云函数。",
            };
          }
        } catch (e) {
           
          console.warn("[auth] deleteAccount verify-read failed:", e);
        }

        // 2. Best-effort cleanup of memberships & DM threads.
        const tables = ["server_members", "dm_threads", "message_reactions"];
        for (const table of tables) {
          try {
            await supabase.from(table).delete().eq("user_id", me.id);
          } catch (e) {
             
            console.warn(
              `[auth] deleteAccount cleanup ${table} failed:`,
              e,
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
         
        console.error("[auth] deleteAccount fatal:", e);
        return { ok: false, error: msg };
      }
    }

    // ---------------- Sign out (both paths) ----------------
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    set({ user: null });
    return { ok: true };
  },

  logout: async () => {
    // Snapshot the user id BEFORE we clear it so we can synchronously
    // wipe their presence rows. Without this, the presence rows linger
    // in the DB until `expires_at` (45s) passes, and other users see
    // this account as "online" for ~30s after they actually quit —
    // user-reported "退出后30秒才离线" bug.
    const me = get().user;
    if (me) {
      try {
        // Delete EVERY presence row keyed by this user across all rooms
        // (global + any per-server channels) so other tabs/users see
        // them disappear immediately.
        const { db } = await import("@/lib/cloudbase");
        await db
          .collection("presence")
          .where({ presence_key: me.id })
          .remove();
      } catch (e) {
        console.warn("[auth] presence cleanup failed (non-fatal):", e);
      }
    }
    try {
      await releaseSession();
    } catch (e) {
      console.warn("[auth] releaseSession failed (non-fatal):", e);
    }
    if (me) clearProfileCache(me.id);
    await supabase.auth.signOut();
    set({ user: null });
  },
}));

async function ensureProfile(
  userId: string,
  email: string,
  preferredUsername?: string,
): Promise<AuthUser> {
  // Fall back to the username stashed during a recent register() call so
  // that the auth-state-change auto-bootstrap path doesn't lose the user's
  // chosen handle. Only honor it when the email matches — defensive for
  // rapid account switching. Compare case-insensitively because CloudBase
  // sometimes echoes the email with a different case than what the user
  // typed (e.g. lowercased domain, original local-part).
  let chosen = preferredUsername;
  const normEmail = (email || "").trim().toLowerCase();
  if (
    !chosen &&
    pendingRegisterUsername &&
    pendingRegisterUsername.email.trim().toLowerCase() === normEmail
  ) {
    chosen = pendingRegisterUsername.username;
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

   
  console.log("[auth] ensureProfile: existing row?", {
    userId,
    found: !!existing,
    username: (existing as Record<string, unknown> | null)?.username,
    deleted_at: (existing as Record<string, unknown> | null)?.deleted_at,
  });

  if (existing) {
    // If this profile was soft-deleted in a previous session, refuse to
    // resurrect it — sign the user out and surface the redacted username
    // so the UI / login page can react. Without this, anyone who knows
    // the original password could log right back in as
    // `__deleted_xxxxx` and keep operating.
    if (
      existing.deleted_at ||
      isDeletedUser(existing.username as string | undefined)
    ) {
       
      console.warn("[auth] ensureProfile: refusing to load deleted profile", userId);
      try {
        await supabase.auth.signOut();
      } catch {
        /* ignore */
      }
      // Throw so callers route into the catch branch and avoid `set({ user })`.
      throw new Error("此账号已注销。如需重新使用，请用新邮箱注册。");
    }

    // Backfill numeric_id for legacy rows that predate the vanity-ID feature.
    // Once written, we never regenerate — the id is meant to be permanent.
    if (!existing.numeric_id) {
      const fresh = genVanityId();
      try {
        await supabase
          .from("profiles")
          .update({ numeric_id: fresh })
          .eq("id", userId);
        existing.numeric_id = fresh;
      } catch {
        /* non-fatal — the user can still operate without a vanity id */
      }
    }
    const emailPrefix = email.split("@")[0];
    // Repair: if the row was inserted by a racing path with the auto
    // email-prefix username AND we now know the actual chosen handle,
    // upgrade the row in place. This covers the scenario where
    // onAuthStateChange beat verifySignUp to the insert.
    if (
      chosen &&
      existing.username === emailPrefix &&
      chosen !== emailPrefix
    ) {
      const newAvatar = deriveAvatarText(chosen);
      const newColor = pickColor(chosen);
      const { data: updated } = await supabase
        .from("profiles")
        .update({
          username: chosen,
          avatar: newAvatar,
          avatar_color: newColor,
        })
        .eq("id", userId)
        .select()
        .single();
      pendingRegisterUsername = null;
      if (updated) {
        const r: AuthUser = {
          id: updated.id,
          username: updated.username,
          email: updated.email,
          avatar: updated.avatar,
          avatarColor: updated.avatar_color,
          avatarUrl: updated.avatar_url ?? null,
          numericId: updated.numeric_id ?? existing.numeric_id ?? null,
          phone: updated.phone ?? null,
          phoneVerifiedAt: updated.phone_verified_at ?? null,
          realNameVerifiedAt: updated.real_name_verified_at ?? null,
        };
        saveProfileToCache(r);
        return r;
      }
    }
    const r: AuthUser = {
      id: existing.id,
      username: existing.username,
      email: existing.email,
      avatar: existing.avatar,
      avatarColor: existing.avatar_color,
      avatarUrl: existing.avatar_url ?? null,
      numericId: existing.numeric_id ?? null,
      phone: existing.phone ?? null,
      phoneVerifiedAt: existing.phone_verified_at ?? null,
      realNameVerifiedAt: existing.real_name_verified_at ?? null,
    };
    saveProfileToCache(r);
    return r;
  }

  const username = chosen || email.split("@")[0];
  const avatar = deriveAvatarText(username);
  const avatar_color = pickColor(username);
  const numeric_id = genVanityId();

  const { data: inserted, error } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      username,
      email,
      avatar,
      avatar_color,
      numeric_id,
    })
    .select()
    .single();

  // We've now persisted whatever username was chosen — nothing left to
  // recover. Drop the stash so it can't leak into a future login.
  pendingRegisterUsername = null;

  if (error || !inserted) {
    // Try localStorage cache before giving up — lets the user see their
    // real profile even when CloudBase can't be reached right now.
    const cached = loadProfileFromCache(userId);
    if (cached) {
      console.warn("[auth] ensureProfile: INSERT failed, using cached profile for", userId);
      return cached;
    }
    // Fallback to in-memory only.
    console.warn(
      "[auth] ensureProfile: profile INSERT failed, using in-memory fallback",
      { userId, username, error: error?.message || error, inserted },
    );
    return {
      id: userId,
      username,
      email,
      avatarColor: avatar_color,
      avatar,
      numericId: numeric_id,
    };
  }
  console.log("[auth] ensureProfile: profile inserted OK", {
    userId,
    username: inserted.username,
  });

  const newProfile: AuthUser = {
    id: inserted.id,
    username: inserted.username,
    email: inserted.email,
    avatar: inserted.avatar,
    avatarColor: inserted.avatar_color,
    avatarUrl: inserted.avatar_url ?? null,
    numericId: inserted.numeric_id ?? numeric_id,
  };
  saveProfileToCache(newProfile);
  return newProfile;
}

/**
 * Force-write `username` (and re-derive avatar / color) onto a profile row.
 *
 * Used as a post-write safety net by `register` / `verifySignUp` to make the
 * user's chosen username stick even when a racing `onAuthStateChange`
 * listener inserted the row first with a fallback name. Failures are
 * logged but not thrown — the user still has a working session, just
 * possibly the wrong display name.
 */
async function enforceUsername(userId: string, username: string): Promise<void> {
  try {
    const avatar = deriveAvatarText(username);
    const avatar_color = pickColor(username);
    await supabase
      .from("profiles")
      .update({ username, avatar, avatar_color })
      .eq("id", userId);
  } catch (e) {
     
    console.warn("[auth] enforceUsername failed:", e);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function translateAuthError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return "邮箱或密码错误";
  if (/User already registered/i.test(msg)) return "该邮箱已注册，请直接登录";
  if (/Email not confirmed/i.test(msg)) return "请先确认邮箱";
  if (/Password should be at least/i.test(msg)) return "密码至少 6 位";
  if (/rate limit/i.test(msg)) return "请求太频繁，请稍后再试";
  return msg;
}

/**
 * React hook that wires Supabase auth state into the zustand store.
 * Call once at app root (e.g. in a top-level layout / providers component).
 */
export function useAuthBootstrap() {
  const { setUser, setHydrated } = useAuth();

  useEffect(() => {
    let mounted = true;

    // Safety net: never let UI hang. CloudBase getSession() normally
    // returns in well under a second; if we don't hear back within 3s
    // we treat it as "no session" and let the UI redirect to /login.
    // Previously this was 8s which made the "page stuck loading"
    // experience drag on after any backend hiccup.
    const timeout = setTimeout(() => {
      if (mounted) {
         
        console.warn("[auth] getSession timed out after 3s, forcing hydrated=true");
        setHydrated(true);
      }
    }, 3000);

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          // CloudBase SDK 的 getSession 在"无登录态"时会返回一个
          // AuthError: Cannot read properties of null (reading 'scope')。
          // 这是正常的未登录路径（之后会跳到 /login），不应当作真错误
          // 弹红色面板。只对其他异常 console.error。
          const msg = (error as { message?: string })?.message || String(error);
          const isNoSession =
            msg.includes("'scope'") ||
            msg.toLowerCase().includes("no session") ||
            msg.toLowerCase().includes("not logged in");
          if (isNoSession) {
             
            console.debug("[auth] no active session (expected on first load)");
          } else {
             
            console.error("[auth] getSession error:", error);
          }
        }
        if (!mounted) return;
        if (data?.session?.user) {
          try {
            const u = data.session.user;
            const profile = await ensureProfile(
              u.id,
              u.email || u.username || "(unknown)",
            );
            if (mounted) setUser(profile);
          } catch (e) {
             
            console.error("[auth] ensureProfile error:", e);
          }
        }
      } catch (e) {
         
        console.error("[auth] bootstrap fatal:", e);
      } finally {
        if (mounted) {
          clearTimeout(timeout);
          setHydrated(true);
        }
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event: string, session: { user?: { id: string; email?: string; username?: string } } | null) => {
      if (!mounted) return;
      try {
        if (session?.user) {
          const u = session.user;
          const profile = await ensureProfile(
            u.id,
            u.email || u.username || "(unknown)",
          );
          if (mounted) setUser(profile);
        } else {
          setUser(null);
        }
      } catch (e) {
        console.error("[auth] onAuthStateChange error:", e);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, [setUser, setHydrated]);
}
