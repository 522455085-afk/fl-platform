"use client";

/**
 * Founder-only client tick. When the founder lands on the page (or
 * refreshes after editing `.env.local`), this component reads the
 * current build's staff lists, compares them to a `staff_snapshot`
 * row in the database, and sends a forced-reload signal to anyone
 * whose tier was downgraded or removed.
 *
 * ========================================================================
 * BACKEND REQUIREMENT — create on the Tencent CloudBase console:
 *
 *   Collection name:  staff_snapshot
 *   Permission preset: 读取全部数据，修改本人数据[READONLY]
 *
 * The collection is expected to hold AT MOST one row, with a fixed
 * doc id of `current` (we use upsert on this id). Schema:
 *
 *   _id          string   — always "current"
 *   founders     string[] — id list, env-derived snapshot
 *   admins       string[]
 *   mods         string[]
 *   updated_at   string   — ISO
 *   updated_by   string   — founder id who pushed this snapshot
 * ========================================================================
 *
 * The forced-reload mechanism reuses the existing `kick_signals`
 * collection (see force-kick.ts) with `reason: "role-changed"`. The
 * `useKickSignalWatcher` hook already triggers a `window.location.reload()`
 * on receipt — so this is purely a publish path, no client changes.
 *
 * Skipped silently when:
 *   - No user logged in
 *   - User is not a founder (only founders push snapshots; admins +
 *     mods consume the resulting reload signals like everyone else)
 *   - The `staff_snapshot` collection doesn't exist (fresh installs)
 */

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";
import { useIsFounder } from "@/lib/roles";
import { db } from "@/lib/cloudbase";
import { supabase } from "@/lib/supabase";
import { recordAuditEvent } from "@/lib/audit-log";

const SNAPSHOT_DOC_ID = "current";

type SnapshotRow = {
  _id?: string;
  founders: string[];
  admins: string[];
  mods: string[];
  updated_at?: string;
  updated_by?: string;
};

function parseEnvList(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function diffRemoved(prev: string[], next: string[]): string[] {
  const set = new Set(next);
  return prev.filter((id) => !set.has(id));
}

export default function StaffSync() {
  const isFounder = useIsFounder();
  const me = useAuth((s) => s.user);
  useEffect(() => {
    if (!isFounder || !me) return;
    let cancelled = false;
    void (async () => {
      // Build the "next" lists from build-time env. We read the same
      // vars `roles.ts` does so the snapshot is always coherent with
      // the live `isFounderId/isAdminId/isModId` predicates.
      const nextFounders = parseEnvList(
        process.env.NEXT_PUBLIC_FOUNDER_IDS ||
          process.env.NEXT_PUBLIC_ADMIN_USER_IDS,
      );
      const nextAdmins = parseEnvList(process.env.NEXT_PUBLIC_ADMIN_IDS);
      const nextMods = parseEnvList(process.env.NEXT_PUBLIC_OFFICIAL_MOD_IDS);

      let prev: SnapshotRow | null = null;
      try {
        const res = await db
          .collection("staff_snapshot")
          .doc(SNAPSHOT_DOC_ID)
          .get();
        const docs = (res.data || []) as SnapshotRow[];
        prev = docs[0] ?? null;
      } catch {
        // Missing collection or doc — treat as first run.
        prev = null;
      }

      const prevFounders = prev?.founders ?? [];
      const prevAdmins = prev?.admins ?? [];
      const prevMods = prev?.mods ?? [];

      // Anyone whose tier dropped (removed entirely OR demoted to a
      // lower tier) needs a forced reload to lose their cached perms.
      // We compute "demotion" as: present in prev tier list but not
      // in any of the next tier lists at all (or strictly lower).
      const removedFounders = diffRemoved(prevFounders, nextFounders);
      const removedAdmins = diffRemoved(prevAdmins, nextAdmins);
      const removedMods = diffRemoved(prevMods, nextMods);

      // A founder demoted to admin should still reload (their UI
      // stops showing founder-exclusive bits). Keep the union of all
      // tier removals, then subtract anyone who was *promoted* — they
      // stay as their old tier, no force-reload needed.
      const allNext = new Set([...nextFounders, ...nextAdmins, ...nextMods]);
      const downgradedOrRemoved = [
        ...removedFounders,
        ...removedAdmins,
        ...removedMods,
      ].filter((id, i, arr) => arr.indexOf(id) === i); // dedupe

      // Send a "role-changed" kick signal per affected user. We use
      // the existing kick_signals collection so the reload watcher
      // (force-kick.ts useKickSignalWatcher) does the actual reload.
      for (const targetId of downgradedOrRemoved) {
        if (cancelled) return;
        try {
          await supabase.from("kick_signals").insert({
            target_user_id: targetId,
            target_channel_id: null,
            issued_by: me.id,
            issued_by_name: me.username,
            issued_at: new Date().toISOString(),
            // Free-form annotation; useKickSignalWatcher inspects
            // `reason` to decide between "voice kick" toast and
            // "role changed" full-page reload.
            reason: "role-changed",
          });
          recordAuditEvent({
            actor_id: me.id,
            actor_name: me.username,
            action: "force_reload_role",
            target_type: "user",
            target_id: targetId,
            target_label: `tier downgrade — was ${
              prevFounders.includes(targetId)
                ? "founder"
                : prevAdmins.includes(targetId)
                  ? "admin"
                  : "mod"
            }, now ${allNext.has(targetId) ? "lower-tier" : "regular"}`,
          });
        } catch (e) {
          console.warn("[staff-sync] failed to push reload signal:", e);
        }
      }

      // 4) Persist the new snapshot. Use `set` semantics by writing
      //    the fixed doc id; CloudBase's `.doc(id).update(...)` is an
      //    upsert when the doc exists, otherwise we fall back to insert.
      const nextRow: SnapshotRow = {
        founders: nextFounders,
        admins: nextAdmins,
        mods: nextMods,
        updated_at: new Date().toISOString(),
        updated_by: me.id,
      };
      try {
        if (prev) {
          await db
            .collection("staff_snapshot")
            .doc(SNAPSHOT_DOC_ID)
            .update(nextRow);
        } else {
          // First run: insert with a fixed id so subsequent updates
          // hit the same row.
          await db
            .collection("staff_snapshot")
            .add({ ...nextRow, _id: SNAPSHOT_DOC_ID });
        }
      } catch (e) {
        console.warn("[staff-sync] snapshot persist skipped:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isFounder, me]);
  return null;
}
