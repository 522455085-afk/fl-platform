"use client";

/**
 * Modal for creating a new user-owned server.
 *
 * Fields:
 *  - 服务器名称（必填，<=30 字）
 *  - 图标字（最多 2 个字符；默认取名称首字）
 *  - 主色调（从一组预设色选一个）
 *
 * On submit: writes a `servers` row + `server_members` creator row via
 * `useServers.createServer`, then calls `onCreated(serverId)` so the host
 * can switch to the new server.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X, Plus, Upload, Loader2 } from "lucide-react";
import { useServers } from "@/lib/servers-store";
import { cn } from "@/lib/utils";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import { processAvatarFile } from "@/lib/avatar-upload";

const COLOR_PRESETS = [
  "#d4a056",
  "#9b6dd9",
  "#7e3a8c",
  "#c9a44c",
  "#5a8c7d",
  "#3a6e9b",
  "#c64b3e",
  "#6db26d",
];

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (serverId: string) => void;
};

export default function CreateServerModal({ open, onClose, onCreated }: Props) {
  const createServer = useServers((s) => s.createServer);
  const backdrop = useDismissOnBackdrop(onClose);
  const [name, setName] = useState("");
  const [iconText, setIconText] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      // Reset form on close so reopening is clean.
      setName("");
      setIconText("");
      setColor(COLOR_PRESETS[0]);
      setIconUrl(null);
      setIsPublic(true);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setIconUploading(true);
    // Use the same processor as ProfileSettings / ServerSettings: center-
    // crop to a square 256x256 JPEG at quality 0.85. Typical output is
    // 15–35KB — the old raw FileReader path produced base64 blobs up to
    // 1+MB which routinely exceeded CloudBase's 512KB per-doc write cap
    // and caused the create call to silently fail.
    const r = await processAvatarFile(file);
    setIconUploading(false);
    if (!r.ok) {
      setError(r.error);
       
      console.warn("[create-server] icon processing failed:", r.error);
      return;
    }
    setIconUrl(r.dataUrl);
     
    console.log(
      `[create-server] icon processed OK: ${(r.bytes / 1024).toFixed(1)}KB`,
    );
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setBusy(true);
    const res = await createServer({
      name,
      iconText: iconText || name.slice(0, 2),
      iconColor: color,
      isPublic,
      iconUrl,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error || "创建失败");
      return;
    }
    if (res.serverId) onCreated?.(res.serverId);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      {...backdrop}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-darker)] rounded-lg shadow-2xl border border-[var(--bg-mid)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div className="size-10 rounded-lg bg-[var(--accent)]/20 grid place-items-center text-[var(--accent)] shrink-0">
            <Plus size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white">创建服务器</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              你将自动成为这个服务器的领主，可以邀请伙伴并设置最多 4 位主教（每 5000 人可多设一位，封顶 10 位）。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 grid place-items-center rounded text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-4 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              服务器名称
            </label>
            <input
              autoFocus
              value={name}
              maxLength={30}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：暮光突袭团"
              className="w-full bg-[var(--bg-darkest)] rounded h-9 px-3 text-sm text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              服务器图标
            </label>
            <div className="flex items-center gap-3">
              {/* Preview tile (shows uploaded image, or letter+color fallback) */}
              <div
                className="relative size-14 rounded-full grid place-items-center text-white text-base font-semibold shrink-0 overflow-hidden"
                style={{ background: iconUrl ? "transparent" : color }}
              >
                {iconUrl ? (
                  <Image
                    src={iconUrl}
                    alt="服务器图标"
                    fill
                    className="object-cover"
                    draggable={false}
                  />
                ) : (
                  (iconText || name).slice(0, 2) || "?"
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    handleFile(e.target.files?.[0] || null)
                  }
                  className="hidden"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={iconUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded text-xs bg-[var(--bg-darkest)] hover:bg-[var(--bg-mid)] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {iconUploading ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Upload size={13} />
                    )}
                    {iconUploading
                      ? "处理中…"
                      : iconUrl
                        ? "更换图片"
                        : "上传图片"}
                  </button>
                  {iconUrl && !iconUploading && (
                    <button
                      type="button"
                      onClick={() => setIconUrl(null)}
                      className="h-8 px-3 rounded text-xs text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)] transition-colors"
                    >
                      移除
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] leading-snug">
                  不上传也可以，将使用下方的图标字 + 主色调。推荐 256×256 以下，800KB 以内。
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              图标字（未上传图片时使用，最多 2 字）
            </label>
            <input
              value={iconText}
              maxLength={2}
              onChange={(e) => setIconText(e.target.value)}
              placeholder={name.slice(0, 1) || "FL"}
              disabled={!!iconUrl}
              className="w-full bg-[var(--bg-darkest)] rounded h-9 px-3 text-sm text-white placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              主色调
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-8 rounded-full border-2 transition-colors",
                    color === c
                      ? "border-white"
                      : "border-transparent hover:border-[var(--text-muted)]",
                  )}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              可见性
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={cn(
                  "text-left rounded border p-2 transition-colors",
                  isPublic
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--bg-mid)] hover:border-[var(--text-muted)]",
                )}
              >
                <div className="text-sm font-medium text-white">
                  🌍 公开
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
                  出现在「发现公会」列表，任何人可搜索加入
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={cn(
                  "text-left rounded border p-2 transition-colors",
                  !isPublic
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--bg-mid)] hover:border-[var(--text-muted)]",
                )}
              >
                <div className="text-sm font-medium text-white">
                  🔒 私密
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">
                  只能通过邀请码 / 邀请链接加入
                </div>
              </button>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-2 leading-relaxed">
              创建后会生成 6 位邀请码，随时在「服务器设置」中查看 / 复制 / 重生。
            </p>
          </div>

          {error && (
            <div className="text-xs text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded p-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--bg-mid)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 px-3 rounded text-sm text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-mid)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="h-8 px-4 rounded text-sm bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
