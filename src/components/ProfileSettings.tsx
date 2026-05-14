"use client";
import { confirm } from "@/lib/confirm-store";

import { useRef, useState } from "react";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import {
  X,
  User,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  Upload,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { processAvatarFile, isAvatarUrl, deriveAvatarText } from "@/lib/avatar-upload";
import { formatVanityId } from "@/lib/vanity-id";
import Avatar from "@/components/Avatar";
import { cn } from "@/lib/utils";

type Tab = "profile" | "password" | "bindings" | "danger";

const AVATAR_COLORS = [
  "#d4a056", // ember gold
  "#9b6dd9", // arcane purple
  "#7e3a8c", // royal violet
  "#c64b3e", // ember red
  "#5a8c7d", // moss teal
  "#b8763a", // bronze
  "#6db26d", // forest
  "#3a6e9b", // twilight blue
  "#8c5a3a", // brown
];

type Props = {
  onClose: () => void;
  /** Optional: open a specific tab on mount. */
  initialTab?: Tab;
};

/**
 * ProfileSettings — modal that lets the user edit their own data.
 *
 * Tabs:
 *   1. 个人资料  — 用户名 / 头像字母 / 头像颜色
 *   2. 修改密码  — 当前密码 + 新密码 + 确认
 *   3. 账号绑定  — 邮箱（只读）/ 手机号状态 / 实名认证状态
 *
 * 持久化走 auth-store 的 updateProfile / changePassword，底层仍是 CloudBase。
 */
export default function ProfileSettings({ onClose, initialTab = "profile" }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const backdrop = useDismissOnBackdrop(onClose);

  if (!user) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70"
      {...backdrop}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-[min(820px,92vh)] bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--bg-mid)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-bright)]">个人设置</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              管理你的身份与偏好
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

        {/* Tab bar */}
        <div className="px-6 border-b border-[var(--bg-mid)] flex gap-1 shrink-0">
          <TabButton active={tab === "profile"} onClick={() => setTab("profile")}>
            <User size={14} />
            个人资料
          </TabButton>
          <TabButton active={tab === "password"} onClick={() => setTab("password")}>
            <Lock size={14} />
            修改密码
          </TabButton>
          <TabButton active={tab === "bindings"} onClick={() => setTab("bindings")}>
            <ShieldCheck size={14} />
            账号绑定
          </TabButton>
          <TabButton active={tab === "danger"} onClick={() => setTab("danger")}>
            <AlertTriangle size={14} />
            注销账号
          </TabButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "profile" && <ProfilePanel />}
          {tab === "password" && <PasswordPanel />}
          {tab === "bindings" && <BindingsPanel />}
          {tab === "danger" && <DangerPanel onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab bar button
// ============================================================

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative px-3 py-3 text-sm font-semibold flex items-center gap-1.5 transition-colors",
        active
          ? "text-[var(--accent)]"
          : "text-[var(--text-muted)] hover:text-white",
      )}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)] rounded-t" />
      )}
    </button>
  );
}

// ============================================================
// Tab 1 — Profile edit (username, avatar letter, avatar color)
// ============================================================

function ProfilePanel() {
  const { user, updateProfile } = useAuth();
  const [username, setUsername] = useState(user?.username || "");
  // Avatar text is no longer user-editable — it's derived from the
  // username on the fly. CJK names get their first ideograph as a
  // single big character; ASCII names get their first 1–2 letters as
  // a monogram. See `deriveAvatarText` for the full rule. We keep
  // `avatar` as a value (rather than computing inline) so the save
  // payload below can compare against the persisted `user.avatar`
  // and avoid sending no-op writes.
  const avatar = deriveAvatarText(username);
  const [color, setColor] = useState(user?.avatarColor || AVATAR_COLORS[0]);
  // Staged avatar image. `undefined` = no change vs persisted; `null` =
  // user clicked "移除"; `string` = user uploaded a new dataURL.
  const [avatarUrl, setAvatarUrl] = useState<string | null | undefined>(
    undefined,
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Resolved current image to render in the preview: staged value wins,
  // else the persisted value, else nothing (letter fallback).
  const resolvedUrl =
    avatarUrl === undefined ? user?.avatarUrl ?? null : avatarUrl;

  const dirty =
    username !== user?.username ||
    avatar !== user?.avatar ||
    color !== user?.avatarColor ||
    avatarUrl !== undefined;

  const handlePickFile = async (file: File | null | undefined) => {
    if (!file) return;
    setMsg(null);
    setUploading(true);
    const res = await processAvatarFile(file);
    setUploading(false);
    if (!res.ok) {
      setMsg({ type: "err", text: res.error });
      return;
    }
    setAvatarUrl(res.dataUrl);
    setMsg({
      type: "ok",
      text: `已选择新头像（${(res.bytes / 1024).toFixed(0)} KB）。点「保存修改」确认。`,
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const res = await updateProfile({
      username: username !== user?.username ? username : undefined,
      avatar: avatar !== user?.avatar ? avatar : undefined,
      avatar_color: color !== user?.avatarColor ? color : undefined,
      avatar_url: avatarUrl !== undefined ? avatarUrl : undefined,
    });
    setSaving(false);
    if (res.ok) {
      setAvatarUrl(undefined); // unstage; reads now flow through user.avatarUrl
      setMsg({ type: "ok", text: "已保存" });
    } else {
      setMsg({ type: "err", text: res.error || "保存失败" });
    }
  };

  return (
    // `mx-auto` + `max-w-md` keeps the form centered horizontally and
    // bounds its width so the inputs don't stretch to the full modal
    // width on wide screens. Each child is a Field, which is also
    // internally centered.
    <div className="mx-auto max-w-md space-y-6">
      {/* Preview + identity card. Centered column layout: avatar
          stacks above name/email so the header reads as a portrait
          rather than a left-aligned summary. */}
      <div className="flex flex-col items-center gap-3 p-4 bg-[var(--bg-darkest)]/60 border border-[var(--bg-mid)] rounded-lg">
        <Avatar
          text={avatar}
          color={color}
          url={resolvedUrl}
          size={96}
        />
        <div className="text-center min-w-0 w-full">
          <div className="text-lg font-semibold text-white truncate">
            {username || "（未命名）"}
          </div>
          <div className="text-sm text-[var(--text-muted)] truncate">
            {user?.email}
          </div>
          {user?.numericId && (
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5 font-mono">
              玩家号 {formatVanityId(user.numericId)}
            </div>
          )}
        </div>
      </div>

      {/* Avatar upload — centered button row + helper hint. */}
      <Field label="头像图片">
        <div className="flex items-center justify-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handlePickFile(e.target.files?.[0]);
              // Reset so re-picking the same file fires onChange.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="h-9 px-3 rounded text-sm bg-[var(--bg-mid)] hover:bg-[var(--bg-mid)]/70 text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {uploading ? "处理中…" : "上传图片"}
          </button>
          {isAvatarUrl(resolvedUrl) && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => {
                setAvatarUrl(null);
                setMsg({
                  type: "ok",
                  text: "已选择移除图片，点「保存修改」确认。",
                });
              }}
              className="h-9 px-3 rounded text-sm bg-[var(--danger)]/10 hover:bg-[var(--danger)]/20 text-[var(--danger)] flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              移除图片
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)] leading-relaxed text-center">
          支持 JPG/PNG/WebP，最大 8MB，自动裁剪为 256×256。未上传图片时使用从用户名自动派生的字母 + 颜色。
        </p>
      </Field>

      {/* Username — typing here also updates the auto-derived avatar
          letter shown in the preview above. */}
      <Field label="用户名">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={32}
          className="modal-input"
          placeholder="2-32 字符，中英文数字均可"
        />
      </Field>

      {/* Avatar color — palette grid centered below the label. */}
      <Field label="头像颜色">
        <div className="flex flex-wrap gap-2 justify-center">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn(
                "size-10 rounded-full ring-2 transition-all",
                color === c
                  ? "ring-white scale-110 shadow-[0_0_10px_var(--accent-glow)]"
                  : "ring-transparent hover:scale-105",
              )}
              style={{ background: c }}
              aria-label={`选择颜色 ${c}`}
            />
          ))}
        </div>
      </Field>

      {msg && (
        <div
          className={cn(
            "text-sm p-2 rounded-md text-center",
            msg.type === "ok"
              ? "text-[var(--success)] bg-[var(--success)]/10"
              : "text-[var(--danger)] bg-[var(--danger)]/10",
          )}
        >
          {msg.type === "ok" && <CheckCircle2 size={14} className="inline mr-1" />}
          {msg.text}
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={cn(
            "px-5 h-10 rounded-md text-sm font-semibold flex items-center gap-2 transition-all",
            saving || !dirty
              ? "bg-[var(--bg-mid)] text-[var(--text-muted)] cursor-not-allowed"
              : "bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] hover:shadow-[0_0_15px_var(--accent-glow)] text-[#1a1325]",
          )}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          保存修改
        </button>
      </div>

      <style jsx>{`
        .modal-input {
          width: 100%;
          height: 40px;
          padding: 0 12px;
          border-radius: 6px;
          background: var(--bg-darkest);
          color: white;
          border: 1px solid var(--bg-mid);
          font-size: 15px;
        }
        .modal-input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 10px var(--accent-glow);
        }
      `}</style>
    </div>
  );
}

// ============================================================
// Tab 2 — Change password
// ============================================================

function PasswordPanel() {
  const { changePassword } = useAuth();
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (nw !== confirm) {
      setMsg({ type: "err", text: "两次输入的新密码不一致" });
      return;
    }
    setSaving(true);
    const res = await changePassword(cur, nw);
    setSaving(false);
    if (res.ok) {
      setMsg({ type: "ok", text: "密码已修改。下次登录请使用新密码。" });
      setCur("");
      setNw("");
      setConfirm("");
    } else {
      setMsg({ type: "err", text: res.error || "修改失败" });
    }
  };

  return (
    <form onSubmit={save} className="mx-auto space-y-5 max-w-md">
      <Field label="当前密码">
        <PasswordInput value={cur} onChange={setCur} show={show} />
      </Field>
      <Field label="新密码">
        <PasswordInput
          value={nw}
          onChange={setNw}
          show={show}
          placeholder="至少 6 位"
        />
      </Field>
      <Field label="确认新密码">
        <PasswordInput value={confirm} onChange={setConfirm} show={show} />
      </Field>

      <label className="flex items-center gap-2 text-sm text-[var(--text-muted)] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
        显示密码
      </label>

      {msg && (
        <div
          className={cn(
            "text-sm p-2 rounded-md",
            msg.type === "ok"
              ? "text-[var(--success)] bg-[var(--success)]/10"
              : "text-[var(--danger)] bg-[var(--danger)]/10",
          )}
        >
          {msg.text}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving || !cur || !nw || !confirm}
          className={cn(
            "px-5 h-10 rounded-md text-sm font-semibold flex items-center gap-2 transition-all",
            saving || !cur || !nw || !confirm
              ? "bg-[var(--bg-mid)] text-[var(--text-muted)] cursor-not-allowed"
              : "bg-gradient-to-b from-[var(--accent)] to-[var(--accent-hover)] hover:shadow-[0_0_15px_var(--accent-glow)] text-[#1a1325]",
          )}
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          修改密码
        </button>
      </div>
    </form>
  );
}

function PasswordInput({
  value,
  onChange,
  show,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-10 px-3 rounded-md bg-[var(--bg-darkest)] text-white border border-[var(--bg-mid)] focus:border-[var(--accent)] focus:outline-none text-[15px]"
    />
  );
}

// ============================================================
// Tab 3 — Bindings (read-only view + links to SecurityCenter)
// ============================================================

function BindingsPanel() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-md space-y-3">
      <BindingRow
        icon={<Mail size={20} className="text-[var(--accent)]" />}
        title="邮箱"
        level="L1 · 注册必备"
        value={user.email}
        done
      />
      <BindingRow
        icon={<Phone size={20} className="text-[var(--success)]" />}
        title="手机号"
        level="L2 · 上架/组队/私信需要"
        value={
          user.phoneVerifiedAt
            ? (user.phone?.replace(/(\d{3})\d+(\d{4})/, "$1****$2") ??
              "已绑定")
            : "未绑定 · 请从左下角菜单「安全中心」绑定"
        }
        done={!!user.phoneVerifiedAt}
      />
      <BindingRow
        icon={<ShieldCheck size={20} className="text-[var(--text-muted)]" />}
        title="实名认证"
        level="L3 · 提现/大额交易"
        value={
          user.realNameVerifiedAt
            ? "已认证"
            : "暂未开放（合规资质办理中）"
        }
        done={!!user.realNameVerifiedAt}
      />

      <div className="mt-4 text-[11px] text-[var(--text-muted)] italic">
        ※ 管理绑定请使用左下角用户菜单里的「安全中心」。这里只展示当前状态。
      </div>
    </div>
  );
}

function BindingRow({
  icon,
  title,
  level,
  value,
  done,
}: {
  icon: React.ReactNode;
  title: string;
  level: string;
  value: string;
  done: boolean;
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
            <CheckCircle2 size={14} className="text-[var(--success)] shrink-0" />
          )}
        </div>
        <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
          {level}
        </div>
        <div className="text-sm text-[var(--text-normal)] mt-0.5 truncate">
          {value}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 4 — Account deletion (soft-delete + sign out)
// ============================================================

function DangerPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { user, deleteAccount } = useAuth();
  const [confirmName, setConfirmName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const canSubmit =
    !busy && acknowledged && confirmName.trim() === user.username;

  const handleDelete = async () => {
    setError(null);
    if (!canSubmit) return;
    // Final confirm — native dialog so it can't be dismissed by accident.
    if (!(await confirm(`最后一次确认：将永久注销账号「${user.username}」。\n\n操作不可撤销。继续？`))) {
      return;
    }
    setBusy(true);
    const r = await deleteAccount();
    setBusy(false);
    if (!r.ok) {
      setError(r.error || "注销失败，请稍后再试");
      return;
    }
    onClose();
    router.replace("/login");
  };

  return (
    <div className="mx-auto space-y-5 max-w-md">
      <div className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle
            size={18}
            className="text-[var(--danger)] shrink-0 mt-0.5"
          />
          <div className="text-sm text-white space-y-1">
            <p className="font-semibold">注销账号是不可逆操作。</p>
            <p className="text-[var(--text-muted)] leading-relaxed">
              注销后将立即：
            </p>
            <ul className="text-[var(--text-muted)] text-xs list-disc pl-4 space-y-0.5">
              <li>清空你的用户名 / 邮箱 / 头像 / 手机号</li>
              <li>移除你在所有服务器中的成员身份</li>
              <li>清空你的私信会话</li>
              <li>登出当前会话</li>
            </ul>
            <p className="text-[var(--text-muted)] text-xs leading-relaxed pt-1">
              你**已发送过的消息**会保留，但作者显示为「已注销用户」。如需彻底清除消息，请在注销前自行删除。
            </p>
            <p className="text-[var(--text-muted)] text-xs leading-relaxed pt-1">
              邮箱解绑后，**未来同邮箱可重新注册**为新账号。
            </p>
          </div>
        </div>
      </div>

      <Field label={`输入用户名「${user.username}」以确认`}>
        <input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={user.username}
          className="w-full h-10 px-3 rounded-md bg-[var(--bg-darkest)] text-white border border-[var(--bg-mid)] focus:border-[var(--danger)] focus:outline-none text-[15px]"
        />
      </Field>

      <label className="flex items-start gap-2 text-sm text-[var(--text-muted)] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="size-4 mt-0.5 accent-[var(--danger)]"
        />
        <span>我已阅读并理解上述风险，确认要注销账号。</span>
      </label>

      {error && (
        <div className="text-sm text-[var(--danger)] bg-[var(--danger)]/10 rounded p-2">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleDelete}
          disabled={!canSubmit}
          className={cn(
            "px-5 h-10 rounded-md text-sm font-semibold flex items-center gap-2 transition-all",
            canSubmit
              ? "bg-[var(--danger)] text-white hover:brightness-110"
              : "bg-[var(--bg-mid)] text-[var(--text-muted)] cursor-not-allowed",
          )}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? "正在注销…" : "永久注销账号"}
        </button>
      </div>

      <p className="text-[11px] text-[var(--text-muted)] italic leading-relaxed pt-2 border-t border-[var(--bg-mid)]/40">
        ※ 注销将永久删除你的账号资料、消息、好友、服务器成员关系和登录凭证，操作不可恢复。如系统暂时无法删除登录凭证，会自动降级为软注销（资料清空、登录保留），届时请联系平台支持。
      </p>
    </div>
  );
}

// ============================================================
// Shared Field
// ============================================================

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--accent)]/80 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
