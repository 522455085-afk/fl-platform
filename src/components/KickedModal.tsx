"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { onKicked, type SessionRow } from "@/lib/sessions";
import { describeDevice, DEVICE_LABEL } from "@/lib/device-type";

/**
 * Listens for "you got kicked" signals from sessions.ts.
 * Shows a modal with a single "知道了" button that logs the user out
 * so they can re-login. The "强制踢回去" flow has been removed.
 */
export default function KickedModal() {
  const { user, logout } = useAuth();
  const [shown, setShown] = useState(false);
  const [kicker, setKicker] = useState<SessionRow | null>(null);

  useEffect(() => {
    const off = onKicked((by) => {
      const currentUid = user?.id;
      if (!currentUid) {
        console.warn("[kicked] notified but no current user — suppressed");
        return;
      }
      if (by && by.user_id !== currentUid) {
        console.warn("[kicked] kicker user_id mismatch — suppressed");
        return;
      }
      console.warn("[kicked] notified, kicker=", by?.session_id);
      setKicker(by);
      setShown(true);
    });
    return () => { off(); };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id && shown) setShown(false);
  }, [user?.id, shown]);

  if (!shown) return null;

  const kickerLabel = kicker
    ? `${DEVICE_LABEL[kicker.device_type] || "未知"} · ${describeDevice(kicker.ua)}`
    : "另一端";

  const handleAccept = () => {
    setShown(false);
    logout().catch((e) => console.warn("[kicked] logout failed:", e));
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[var(--bg-darker)] rounded-lg shadow-2xl w-[min(90vw,440px)] p-6 border border-[var(--bg-mid)]">
        <h2 className="text-lg font-semibold text-white mb-2">
          账号在其他设备登录
        </h2>
        <p className="text-sm text-[var(--text-muted)] leading-6 mb-4">
          你的账号刚刚在 <span className="text-white font-medium">{kickerLabel}</span>{" "}
          上登录，本端已自动下线。如果不是你本人操作，请尽快修改密码。
        </p>
        <div className="flex justify-end">
          <button
            onClick={handleAccept}
            className="text-sm px-5 h-8 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
