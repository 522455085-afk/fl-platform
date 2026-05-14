"use client";

import { useState } from "react";
import { X, Mail, Phone, ShieldCheck, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import { confirm, alert } from "@/lib/confirm-store";

type Props = {
  /**
   * Optional gating context shown at the top of the modal, e.g. "上架物品需要先绑定手机号".
   * If null/undefined, no banner is shown.
   */
  gate?: string | null;
  onClose: () => void;
};

/**
 * Security Center — modal that shows the user's verification status:
 *   1. Email     ✅ already bound on registration
 *   2. Phone     ❌ optional — bind via SMS OTP (currently MOCKED)
 *   3. Real-name ❌ planned — face + ID via Tencent Cloud FACEID
 *
 * Phone binding is a self-contained 2-step wizard (request → verify).
 * No real SMS is sent yet; any 6-digit code is accepted. The mock code
 * `123456` is shown directly in the UI for testing convenience.
 */
export default function SecurityCenter({ gate, onClose }: Props) {
  const { user, requestPhoneCode, bindPhone, unbindPhone } = useAuth();
  const [showBindFlow, setShowBindFlow] = useState(false);
  const backdrop = useDismissOnBackdrop(onClose);

  if (!user) return null;
  const phoneBound = !!user.phoneVerifiedAt;
  const realNameBound = !!user.realNameVerifiedAt;

  const handleUnbind = async () => {
    if (!(await confirm("确认解除手机号绑定？"))) return;
    const r = await unbindPhone();
    if (!r.ok && r.error) void alert(r.error);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70"
      {...backdrop}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--bg-mid)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-bright)]">
              安全中心
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              管理你账户的身份验证等级
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white p-1 rounded"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {gate && (
            <div className="rounded-md bg-[var(--warning)]/10 border border-[var(--warning)]/40 p-3 flex gap-2">
              <AlertCircle
                size={18}
                className="text-[var(--warning)] shrink-0 mt-0.5"
              />
              <div className="text-sm text-[var(--text-normal)]">{gate}</div>
            </div>
          )}

          {/* Level 1 — Email */}
          <Row
            icon={<Mail size={20} className="text-[var(--accent)]" />}
            title="邮箱"
            level="L1 · 注册必备"
            valueText={user.email}
            done
          />

          {/* Level 2 — Phone */}
          {showBindFlow ? (
            <PhoneBindWizard
              onCancel={() => setShowBindFlow(false)}
              onDone={() => setShowBindFlow(false)}
              requestPhoneCode={requestPhoneCode}
              bindPhone={bindPhone}
            />
          ) : (
            <Row
              icon={<Phone size={20} className="text-[var(--success)]" />}
              title="手机号"
              level="L2 · 上架/组队/私信需要"
              valueText={
                phoneBound
                  ? maskPhone(user.phone || "")
                  : "未绑定"
              }
              done={phoneBound}
              actionLabel={phoneBound ? "解除绑定" : "去绑定"}
              actionVariant={phoneBound ? "ghost" : "primary"}
              onAction={
                phoneBound ? handleUnbind : () => setShowBindFlow(true)
              }
            />
          )}

          {/* Level 3 — Real Name */}
          <Row
            icon={<ShieldCheck size={20} className="text-[var(--text-muted)]" />}
            title="实名认证"
            level="L3 · 提现/大额交易需要"
            valueText={realNameBound ? "已认证" : "暂未开放（合规资质办理中）"}
            done={realNameBound}
            actionLabel="即将上线"
            actionVariant="disabled"
          />
        </div>

        <div className="px-6 py-3 border-t border-[var(--bg-mid)] text-[11px] text-[var(--text-muted)] italic">
          ※ 短信通道接入腾讯云后，绑定流程将自动切换为真实发送。
        </div>
      </div>
    </div>
  );
}

function maskPhone(p: string) {
  if (p.length < 7) return p;
  return p.slice(0, 3) + "****" + p.slice(-4);
}

// ============================================================
// Row component
// ============================================================

function Row({
  icon,
  title,
  level,
  valueText,
  done,
  actionLabel,
  actionVariant,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  level: string;
  valueText: string;
  done: boolean;
  actionLabel?: string;
  actionVariant?: "primary" | "ghost" | "disabled";
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-[var(--bg-darkest)]/60 border border-[var(--bg-mid)]">
      <div className="size-10 grid place-items-center rounded bg-[var(--bg-mid)]/40 shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white">{title}</span>
          {done && (
            <CheckCircle2
              size={14}
              className="text-[var(--success)] shrink-0"
            />
          )}
        </div>
        <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
          {level}
        </div>
        <div className="text-sm text-[var(--text-normal)] mt-0.5 truncate">
          {valueText}
        </div>
      </div>
      {actionLabel && (
        <button
          onClick={onAction}
          disabled={actionVariant === "disabled"}
          className={cn(
            "text-sm font-semibold px-3 py-1.5 rounded shrink-0 transition-colors",
            actionVariant === "primary" &&
              "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[#1a1325]",
            actionVariant === "ghost" &&
              "bg-[var(--bg-light)] hover:bg-[var(--bg-mid)] text-white",
            actionVariant === "disabled" &&
              "bg-[var(--bg-mid)]/50 text-[var(--text-muted)] cursor-not-allowed",
          )}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ============================================================
// Phone bind wizard (inline)
// ============================================================

function PhoneBindWizard({
  onCancel,
  onDone,
  requestPhoneCode,
  bindPhone,
}: {
  onCancel: () => void;
  onDone: () => void;
  requestPhoneCode: (
    phone: string,
  ) => Promise<{ ok: boolean; error?: string; mockCode?: string }>;
  bindPhone: (
    phone: string,
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [mockCode, setMockCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const r = await requestPhoneCode(phone);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error || "发送失败");
      return;
    }
    setMockCode(r.mockCode || null);
    setStep("code");
  };

  const onConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const r = await bindPhone(phone, code);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error || "绑定失败");
      return;
    }
    onDone();
  };

  return (
    <div className="rounded-md bg-[var(--bg-darkest)]/80 border border-[var(--accent)]/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-white flex items-center gap-2">
          <Phone size={16} className="text-[var(--success)]" />
          绑定手机号
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[var(--text-muted)] hover:text-white"
        >
          取消
        </button>
      </div>

      {step === "phone" && (
        <form onSubmit={onRequest} className="space-y-3">
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]/80 mb-1">
              手机号
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+8613800138000 或 13800138000"
              autoFocus
              className="w-full h-10 px-3 rounded-md bg-[var(--bg-darkest)] text-white border border-[var(--bg-mid)] focus:border-[var(--accent)] focus:outline-none text-[15px]"
            />
            <span className="block mt-1 text-[11px] text-[var(--text-muted)]">
              支持中国大陆手机号；海外号需带国家区号（如 +1）
            </span>
          </label>

          {err && (
            <div className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 rounded p-2">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-md bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] hover:shadow-[0_0_15px_var(--accent-glow)] text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            发送验证码
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={onConfirm} className="space-y-3">
          <div className="text-sm text-[var(--text-normal)]">
            验证码已发送至{" "}
            <span className="text-[var(--accent)] font-semibold">
              {phone}
            </span>
          </div>

          {mockCode && (
            <div className="text-xs text-[var(--warning)] bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded p-2">
              ⚠️ 测试模式：验证码 ={" "}
              <span className="font-mono font-bold">{mockCode}</span>
              （任意 6 位数字也通过）
            </div>
          )}

          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]/80 mb-1">
              验证码
            </span>
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              maxLength={6}
              autoFocus
              placeholder="6 位数字"
              className="w-full h-10 px-3 rounded-md bg-[var(--bg-darkest)] text-white border border-[var(--bg-mid)] focus:border-[var(--accent)] focus:outline-none text-[18px] font-mono tracking-[0.3em]"
            />
          </label>

          {err && (
            <div className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 rounded p-2">
              {err}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setErr(null);
                setCode("");
              }}
              className="flex-1 h-10 rounded-md bg-[var(--bg-mid)] hover:bg-[var(--bg-light)] text-white text-sm font-semibold"
            >
              改手机号
            </button>
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="flex-1 h-10 rounded-md bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] hover:shadow-[0_0_15px_var(--accent-glow)] text-[#1a1325] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              确认绑定
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
