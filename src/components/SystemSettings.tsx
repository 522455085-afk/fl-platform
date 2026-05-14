"use client";

/**
 * 系统设置 — distinct from 个人设置 (`ProfileSettings`).
 *
 * Tabs:
 *   - 外观: theme palette picker (multiple presets, live preview)
 *   - 音频: mic input + output volume sliders (no real audio backend yet,
 *           values persist for forward compatibility)
 *   - 语言: language switcher (i18n support)
 *   - 关于: build / version info
 *
 * Modal uses a fixed height so switching tabs doesn't reflow the frame
 * (matches the recently-fixed ProfileSettings behaviour).
 */

import { X, Palette, Volume2, Mic, Headphones, Check, Globe } from "lucide-react";
import { useState } from "react";
import { useDismissOnBackdrop } from "@/lib/use-dismiss-on-backdrop";
import { useTheme, THEMES } from "@/lib/theme-store";
import { useAudioSettings } from "@/lib/audio-settings-store";
import { useNotifyPrefs } from "@/lib/notify-prefs";
import { cn } from "@/lib/utils";
import LanguageSwitcher from "./LanguageSwitcher";

type Tab = "appearance" | "audio" | "language";

export default function SystemSettings({ onClose }: { onClose: () => void }) {
  const backdrop = useDismissOnBackdrop(onClose);
  const [tab, setTab] = useState<Tab>("appearance");

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70"
      {...backdrop}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[92vh] bg-[var(--bg-darker)] rounded-xl border border-[var(--bg-mid)] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--bg-mid)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-bright)]">
              系统设置
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              界面外观与音频输入输出
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
          <TabButton active={tab === "appearance"} onClick={() => setTab("appearance")}>
            <Palette size={14} />
            外观
          </TabButton>
          <TabButton active={tab === "audio"} onClick={() => setTab("audio")}>
            <Volume2 size={14} />
            音频
          </TabButton>
          <TabButton active={tab === "language"} onClick={() => setTab("language")}>
            <Globe size={14} />
            语言
          </TabButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "appearance" && <AppearancePanel />}
          {tab === "audio" && <AudioPanel />}
          {tab === "language" && <LanguagePanel />}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab button
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
// Appearance — theme picker
// ============================================================
function AppearancePanel() {
  const themeId = useTheme((s) => s.themeId);
  const setTheme = useTheme((s) => s.setTheme);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-bold text-white mb-1">主题配色</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          选择整体氛围。所有界面元素会立即跟随更新。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEMES.map((t) => {
            const active = t.id === themeId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={cn(
                  "text-left rounded-lg border-2 transition-all overflow-hidden",
                  active
                    ? "border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]"
                    : "border-[var(--bg-mid)] hover:border-[var(--bg-light)]",
                )}
              >
                {/* Swatch row — uses the theme's actual colors (not CSS vars
                    so each card previews its own palette regardless of
                    which theme is currently active). */}
                <div
                  className="h-12 flex"
                  style={{ background: t.palette["--bg-darkest"] }}
                >
                  <div className="flex-1" style={{ background: t.palette["--bg-darker"] }} />
                  <div className="flex-1" style={{ background: t.palette["--bg-dark"] }} />
                  <div className="flex-1" style={{ background: t.palette["--bg-mid"] }} />
                  <div className="flex-1" style={{ background: t.palette["--bg-light"] }} />
                  <div
                    className="w-12 grid place-items-center"
                    style={{ background: t.palette["--accent"] }}
                  >
                    {active && <Check size={16} className="text-black" />}
                  </div>
                  <div className="w-6" style={{ background: t.palette["--magic"] }} />
                </div>
                <div className="px-3 py-2 bg-[var(--bg-darker)]">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    {t.name}
                    {active && (
                      <span className="text-[10px] text-[var(--accent)] font-medium">
                        已应用
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
                    {t.blurb}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ============================================================
// Audio — input + output volume
// ============================================================
function AudioPanel() {
  const inputVolume = useAudioSettings((s) => s.inputVolume);
  const outputVolume = useAudioSettings((s) => s.outputVolume);
  const masterMuted = useAudioSettings((s) => s.masterMuted);
  const setInputVolume = useAudioSettings((s) => s.setInputVolume);
  const setOutputVolume = useAudioSettings((s) => s.setOutputVolume);
  const setMasterMuted = useAudioSettings((s) => s.setMasterMuted);
  return (
    <div className="space-y-6 max-w-md">
      <VolumeSlider
        icon={<Mic size={16} className="text-[var(--accent)]" />}
        label="麦克风输入音量"
        value={inputVolume}
        onChange={setInputVolume}
        hint="影响其他人听到你声音的大小（接入 WebRTC 后生效）。"
      />
      <VolumeSlider
        icon={<Headphones size={16} className="text-[var(--accent)]" />}
        label="语音输出音量"
        value={outputVolume}
        onChange={setOutputVolume}
        hint="影响你听到他人声音的大小。"
      />
      <label className="flex items-center gap-3 p-3 rounded bg-[var(--bg-darkest)]/60 border border-[var(--bg-mid)] cursor-pointer">
        <input
          type="checkbox"
          checked={masterMuted}
          onChange={(e) => setMasterMuted(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
        <span className="text-sm text-white">总开关静音</span>
        <span className="text-[11px] text-[var(--text-muted)] ml-auto">
          一键禁用全部输入 / 输出
        </span>
      </label>
      <p className="text-[11px] text-[var(--text-muted)] italic">
        提示：当前版本尚未接入实时语音传输，音量数值已保存以便后续上线时直接生效。
      </p>

      <NotificationPrefsSection />
    </div>
  );
}

// ============================================================
// Notification prefs — device-local toggles for the @mention
// audible ding and the browser OS notification popup.
// Stored in localStorage via `notify-prefs` store.
// ============================================================
function NotificationPrefsSection() {
  const mentionSound = useNotifyPrefs((s) => s.mentionSound);
  const browserNotifyEnabled = useNotifyPrefs((s) => s.browserNotifyEnabled);
  const setMentionSound = useNotifyPrefs((s) => s.setMentionSound);
  const setBrowserNotifyEnabled = useNotifyPrefs(
    (s) => s.setBrowserNotifyEnabled,
  );
  return (
    <section className="pt-4 mt-4 border-t border-[var(--bg-mid)]/50 space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        通知
      </div>
      <label className="flex items-center gap-3 p-3 rounded bg-[var(--bg-darkest)]/60 border border-[var(--bg-mid)] cursor-pointer">
        <input
          type="checkbox"
          checked={mentionSound}
          onChange={(e) => setMentionSound(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white">@提及提示音</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
            收到 @ 时播放一声短促的提示音
          </div>
        </div>
      </label>
      <label className="flex items-center gap-3 p-3 rounded bg-[var(--bg-darkest)]/60 border border-[var(--bg-mid)] cursor-pointer">
        <input
          type="checkbox"
          checked={browserNotifyEnabled}
          onChange={(e) => setBrowserNotifyEnabled(e.target.checked)}
          className="size-4 accent-[var(--accent)]"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white">浏览器通知</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
            当标签页隐藏时显示系统通知（需在浏览器中授权）
          </div>
        </div>
      </label>
    </section>
  );
}

function VolumeSlider({
  icon,
  label,
  value,
  onChange,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className="ml-auto text-xs text-[var(--text-muted)] tabular-nums">
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
      {hint && (
        <p className="text-[11px] text-[var(--text-muted)] mt-1">{hint}</p>
      )}
    </div>
  );
}

// ============================================================
// Language — i18n switcher
// ============================================================
function LanguagePanel() {
  return (
    <div className="space-y-6 max-w-md">
      <section>
        <h3 className="text-sm font-bold text-white mb-1">界面语言</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          选择显示语言。切换后页面将自动刷新。
        </p>
        <div className="bg-[var(--bg-darkest)]/60 border border-[var(--bg-mid)] rounded-lg p-4">
          <LanguageSwitcher />
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-3 italic">
          提示：当前支持简体中文和英文。更多语言即将推出。
        </p>
      </section>
    </div>
  );
}

