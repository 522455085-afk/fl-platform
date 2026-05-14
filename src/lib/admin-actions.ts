"use client";
/**
 * Client-side wrappers for CloudBase Function: admin-action.
 *
 * All privileged operations (delete message, ban, mute, kick) now go
 * through a server-side Function that re-validates the caller's UID
 * before touching the database.  The frontend still shows/hides UI
 * based on roles.ts, but enforcement lives server-side.
 */

import { app } from "@/lib/cloudbase";
import type { ICloudBaseApp } from "@/lib/types";

interface AdminActionResult {
  code: number;
  message?: string;
}

async function callAdminAction(payload: Record<string, unknown>): Promise<AdminActionResult> {
  try {
    const appWithCallFn = app as ICloudBaseApp & {
      callFunction?: (options: { name: string; data?: Record<string, unknown> }) => Promise<{ result: AdminActionResult; err: string | null }>;
    };
    const res = await appWithCallFn.callFunction({
      name: "admin-action",
      data: payload,
    });
    return res?.result ?? { code: 500, message: "No result" };
  } catch (err: unknown) {
    console.error("[admin-action] callFunction error:", err);
    return { code: 500, message: String((err as Error)?.message ?? err) };
  }
}

export async function adminDeleteMessage(messageId: string): Promise<void> {
  const res = await callAdminAction({ action: "deleteMessage", messageId });
  if (res.code !== 200) throw new Error(res.message ?? "Failed to delete message");
}

export async function adminBanUser(
  targetId: string,
  reason: string,
  expiresAt?: number | null,
): Promise<void> {
  const res = await callAdminAction({ action: "banUser", targetId, reason, expiresAt: expiresAt ?? null });
  if (res.code !== 200) throw new Error(res.message ?? "Failed to ban user");
}

export async function adminUnbanUser(targetId: string): Promise<void> {
  const res = await callAdminAction({ action: "unbanUser", targetId });
  if (res.code !== 200) throw new Error(res.message ?? "Failed to unban user");
}

export async function adminMuteUser(
  targetId: string,
  serverId: string,
  durationMs: number,
  reason: string,
): Promise<void> {
  const res = await callAdminAction({ action: "muteUser", targetId, serverId, durationMs, reason });
  if (res.code !== 200) throw new Error(res.message ?? "Failed to mute user");
}

export async function adminUnmuteUser(targetId: string, serverId: string): Promise<void> {
  const res = await callAdminAction({ action: "unmuteUser", targetId, serverId });
  if (res.code !== 200) throw new Error(res.message ?? "Failed to unmute user");
}

export async function adminKickMember(targetId: string, serverId: string): Promise<void> {
  const res = await callAdminAction({ action: "kickMember", targetId, serverId });
  if (res.code !== 200) throw new Error(res.message ?? "Failed to kick member");
}
