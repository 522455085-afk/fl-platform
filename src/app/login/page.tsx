"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Flame } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { alert } from "@/lib/confirm-store";

type Mode = "login" | "register" | "verify";

export default function LoginPage() {
  const router = useRouter();
  const { user, hydrated, login, register, verifySignUp } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingUsername, setPendingUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hydrated && user) router.replace("/");
  }, [hydrated, user, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "login") {
      const res = await login(email, password);
      setLoading(false);
      if (!res.ok) setError(res.error || "出错了");
      else router.replace("/");
      return;
    }

    if (mode === "register") {
      const res = await register(username, email, password);
      setLoading(false);
      if (!res.ok) {
        setError((res as { error?: string }).error || "出错了");
        return;
      }
      if (res.needVerify) {
        // Switch to verification step
        setPendingEmail(res.pendingEmail);
        setPendingUsername(res.pendingUsername);
        setMode("verify");
        setCode("");
        return;
      }
      router.replace("/");
      return;
    }

    if (mode === "verify") {
      const res = await verifySignUp(pendingEmail, code, pendingUsername);
      setLoading(false);
      if (!res.ok) {
        setError(res.error || "验证失败");
        return;
      }
      router.replace("/");
      return;
    }
  };

  return (
    <div
      className="h-screen w-screen grid place-items-center p-4 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 25% 30%, #3a2461 0%, transparent 55%), radial-gradient(ellipse at 75% 75%, #5a3a18 0%, transparent 55%), #0e0a18",
      }}
    >
      <div className="w-full max-w-[460px] bg-[var(--bg-darker)]/90 backdrop-blur rounded-xl shadow-[0_0_60px_rgba(155,109,217,0.15)] p-8 border border-[var(--bg-mid)] relative">
        {/* Decorative top border */}
        <div className="absolute -top-px left-8 right-8 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/60 to-transparent" />

        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="size-16 rounded-full bg-gradient-to-br from-[var(--accent)] to-[#7e3a8c] grid place-items-center text-white mb-4 shadow-[0_0_30px_var(--accent-glow)] ring-2 ring-[var(--accent)]/40">
            <Flame size={30} className="drop-shadow-[0_0_8px_rgba(255,200,100,0.8)]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-bright)] tracking-wide" style={{ fontFamily: '"Cinzel", "Noto Serif SC", serif' }}>
            {mode === "login"
              ? "踏上归途"
              : mode === "register"
                ? "铭刻你的名字"
                : "查验你的印记"}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2 italic">
            {mode === "login"
              ? "「这片土地仍在等你」"
              : mode === "register"
                ? "加入「被遗忘之地」玩家共济会"
                : `验证码已发送至 ${pendingEmail}`}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode !== "verify" && (
            <>
              <Field
                label="邮箱"
                value={email}
                onChange={setEmail}
                type="email"
                autoFocus={mode === "login"}
              />
              {mode === "register" && (
                <Field
                  label="用户名"
                  value={username}
                  onChange={setUsername}
                  type="text"
                  hint="3-32 个字符，可包含中文、英文、数字"
                />
              )}
              <Field
                label="密码"
                value={password}
                onChange={setPassword}
                type="password"
                hint={mode === "login" ? undefined : "至少 6 位"}
              />
            </>
          )}

          {mode === "verify" && (
            <>
              <div className="text-sm text-[var(--text-normal)] bg-[var(--bg-darkest)]/60 rounded-md border border-[var(--bg-mid)] p-3">
                <div>邀请函已寄到 <span className="text-[var(--accent)] font-semibold">{pendingEmail}</span></div>
                <div className="text-[var(--text-muted)] mt-1">复制邮件里的 6 位验证码贴在下面。邮件可能在垃圾邮件里。</div>
              </div>
              <Field
                label="验证码"
                value={code}
                onChange={setCode}
                type="text"
                hint="6 位数字"
                autoFocus
              />
            </>
          )}

          {error && (
            <div className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded p-2">
              {error}
            </div>
          )}

          {mode === "login" && (
            <button
              type="button"
              className="text-sm text-[var(--accent)] hover:underline"
              onClick={() => void alert("此功能正在开发中。请联系主教重置密码。")}
            >
              忘记密码？
            </button>
          )}
          {mode === "verify" && (
            <button
              type="button"
              className="text-sm text-[var(--accent)] hover:underline"
              onClick={() => {
                setMode("register");
                setError(null);
                setCode("");
              }}
            >
              返回修改邮箱
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "w-full h-11 rounded-lg font-semibold tracking-wide transition-all flex items-center justify-center gap-2 border",
              loading
                ? "bg-[var(--accent)]/30 cursor-not-allowed border-transparent text-white/60"
                : "bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] hover:shadow-[0_0_20px_var(--accent-glow)] text-[#1a1325] border-[var(--accent)]/60",
            )}
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {mode === "login"
              ? "踏入大殿"
              : mode === "register"
                ? "发送验证码"
                : "完成立约"}
          </button>

          {mode !== "verify" && (
            <div className="text-sm text-[var(--text-muted)] pt-2">
              {mode === "login" ? (
                <>
                  第一次来到此地？{" "}
                  <button
                    type="button"
                    className="text-[var(--accent)] hover:underline font-semibold"
                    onClick={() => {
                      setMode("register");
                      setError(null);
                    }}
                  >
                    铭刻新名
                  </button>
                </>
              ) : (
                <>
                  已经留下印记？{" "}
                  <button
                    type="button"
                    className="text-[var(--accent)] hover:underline font-semibold"
                    onClick={() => {
                      setMode("login");
                      setError(null);
                    }}
                  >
                    踏上归途
                  </button>
                </>
              )}
            </div>
          )}
        </form>

        <div className="mt-6 pt-6 border-t border-[var(--bg-mid)] text-center text-xs text-[var(--text-muted)] italic">
          ✦ 你的契约将以加密符文封存 · 由腾讯云 CloudBase 守护
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--accent)]/80 mb-1.5">
        {label}
        <span className="text-[var(--danger)] ml-0.5">*</span>
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="w-full h-10 px-3 rounded-md bg-[var(--bg-darkest)] text-white border border-[var(--bg-mid)] focus:border-[var(--accent)] focus:shadow-[0_0_10px_var(--accent-glow)] focus:outline-none text-[15px] transition-all"
      />
      {hint && <span className="block mt-1 text-[11px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}
