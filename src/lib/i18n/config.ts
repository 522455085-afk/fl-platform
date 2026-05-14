/**
 * i18n 配置文件
 * 
 * 支持语言：
 * - zh-CN (简体中文)
 * - en (English)
 */

export const locales = ["zh-CN", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

export const localeNames: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
};

/**
 * 获取用户首选语言
 */
export function getPreferredLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  
  const saved = localStorage.getItem("fl-locale");
  if (saved && locales.includes(saved as Locale)) {
    return saved as Locale;
  }
  
  const browserLang = navigator.language;
  if (browserLang.startsWith("zh")) return "zh-CN";
  if (browserLang.startsWith("en")) return "en";
  
  return defaultLocale;
}

/**
 * 设置语言
 */
export function setLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("fl-locale", locale);
  window.location.reload();
}
