"use client";

/**
 * Theme palette store + applier.
 *
 * Themes are a flat map of CSS-variable-name → color. We keep the
 * variable surface small (just the ones that visually define "the look"
 * of the app) so swapping is fast and predictable.
 *
 * The active palette is applied to `document.documentElement.style` at
 * runtime so it cascades into every component that already uses
 * `var(--accent)` etc., with zero per-component changes.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePalette = {
  /** Background tones, darkest → lightest */
  "--bg-darkest": string;
  "--bg-darker": string;
  "--bg-dark": string;
  "--bg-mid": string;
  "--bg-light": string;
  /** Primary accent + its hover + soft glow */
  "--accent": string;
  "--accent-hover": string;
  "--accent-glow": string;
  /** Magic / secondary accent (e.g. recruitment-room badge) */
  "--magic": string;
  /** Optional foreground tweaks */
  "--text-bright"?: string;
  "--text-normal"?: string;
  "--text-muted"?: string;
};

export type ThemeDef = {
  id: string;
  name: string;
  /** Short Chinese description for the picker UI. */
  blurb: string;
  palette: ThemePalette;
};

// ============================================================
// Built-in themes
// ============================================================
export const THEMES: ThemeDef[] = [
  {
    id: "ember-gold",
    name: "余烬金",
    blurb: "暗夜紫 + 余烬金（默认）",
    palette: {
      "--bg-darkest": "#0e0a18",
      "--bg-darker": "#17112a",
      "--bg-dark": "#1f1830",
      "--bg-mid": "#2a2240",
      "--bg-light": "#3a2e58",
      "--accent": "#d4a056",
      "--accent-hover": "#b88836",
      "--accent-glow": "rgba(212, 160, 86, 0.35)",
      "--magic": "#9b6dd9",
    },
  },
  {
    id: "arcane-violet",
    name: "秘术紫",
    blurb: "更深的紫色 + 紫罗兰光晕",
    palette: {
      "--bg-darkest": "#0c0820",
      "--bg-darker": "#150e2e",
      "--bg-dark": "#1c1438",
      "--bg-mid": "#271c4d",
      "--bg-light": "#3a2a73",
      "--accent": "#a677ff",
      "--accent-hover": "#8b5be0",
      "--accent-glow": "rgba(166, 119, 255, 0.4)",
      "--magic": "#d49aff",
    },
  },
  {
    id: "dragon-blood",
    name: "龙血赤",
    blurb: "炭黑 + 龙血红，带焦糖橙点缀",
    palette: {
      "--bg-darkest": "#120a0c",
      "--bg-darker": "#1d1014",
      "--bg-dark": "#26161a",
      "--bg-mid": "#3a1d24",
      "--bg-light": "#552830",
      "--accent": "#e8704c",
      "--accent-hover": "#c95838",
      "--accent-glow": "rgba(232, 112, 76, 0.4)",
      "--magic": "#d24a4a",
    },
  },
  {
    id: "frost-blue",
    name: "霜雪蓝",
    blurb: "深海靛蓝 + 冰晶青光",
    palette: {
      "--bg-darkest": "#08111c",
      "--bg-darker": "#0f1c2e",
      "--bg-dark": "#152840",
      "--bg-mid": "#1d3759",
      "--bg-light": "#2d4f7d",
      "--accent": "#5cc1ee",
      "--accent-hover": "#3aa5d4",
      "--accent-glow": "rgba(92, 193, 238, 0.4)",
      "--magic": "#7dd3fc",
    },
  },
  {
    id: "forest-moss",
    name: "幽林苔",
    blurb: "墨绿森林 + 嫩芽翠光",
    palette: {
      "--bg-darkest": "#0b1410",
      "--bg-darker": "#10201a",
      "--bg-dark": "#162b22",
      "--bg-mid": "#1f3e30",
      "--bg-light": "#305c47",
      "--accent": "#7dd47a",
      "--accent-hover": "#5fb060",
      "--accent-glow": "rgba(125, 212, 122, 0.35)",
      "--magic": "#a6e2a1",
    },
  },
  {
    id: "obsidian-rose",
    name: "黑曜玫瑰",
    blurb: "近乎纯黑 + 玫瑰粉强调",
    palette: {
      "--bg-darkest": "#0a0a0a",
      "--bg-darker": "#141014",
      "--bg-dark": "#1c161c",
      "--bg-mid": "#2a212a",
      "--bg-light": "#3a2c3a",
      "--accent": "#ec6a8a",
      "--accent-hover": "#d04a6c",
      "--accent-glow": "rgba(236, 106, 138, 0.4)",
      "--magic": "#f48ca8",
    },
  },
  {
    id: "sunset-coral",
    name: "暮霞珊瑚",
    blurb: "暖棕落日 + 珊瑚橙活力",
    palette: {
      "--bg-darkest": "#1a0f0a",
      "--bg-darker": "#241712",
      "--bg-dark": "#2e1f17",
      "--bg-mid": "#412c20",
      "--bg-light": "#5e3f2c",
      "--accent": "#ff8a65",
      "--accent-hover": "#e26948",
      "--accent-glow": "rgba(255, 138, 101, 0.4)",
      "--magic": "#ffb088",
    },
  },
  {
    id: "midnight-mint",
    name: "午夜薄荷",
    blurb: "冷峻深青 + 薄荷绿点亮",
    palette: {
      "--bg-darkest": "#0a1416",
      "--bg-darker": "#10202a",
      "--bg-dark": "#152b35",
      "--bg-mid": "#1f3e4a",
      "--bg-light": "#2d5868",
      "--accent": "#5eead4",
      "--accent-hover": "#3dc4b0",
      "--accent-glow": "rgba(94, 234, 212, 0.35)",
      "--magic": "#86efd6",
    },
  },
];

export const DEFAULT_THEME_ID = "ember-gold";

// ============================================================
// Zustand store
// ============================================================
type ThemeStore = {
  themeId: string;
  setTheme: (id: string) => void;
};

export const useTheme = create<ThemeStore>()(
  persist(
    (set) => ({
      themeId: DEFAULT_THEME_ID,
      setTheme: (id) => {
        if (THEMES.some((t) => t.id === id)) set({ themeId: id });
      },
    }),
    { name: "fl-theme" },
  ),
);

// ============================================================
// Apply palette to <html> at runtime
// ============================================================
/** Returns the active theme definition (falls back to default). */
export function getActiveTheme(themeId: string): ThemeDef {
  return THEMES.find((t) => t.id === themeId) ?? THEMES[0];
}

/** Imperatively apply a palette to <html>. Used by ThemeApplier. */
export function applyTheme(theme: ThemeDef): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.palette)) {
    if (typeof v === "string") root.style.setProperty(k, v);
  }
}
