"use client";

import { useI18n } from "@/lib/i18n/provider";
import { locales, localeNames } from "@/lib/i18n/config";

/**
 * 语言切换组件
 */
export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="relative">
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as (typeof locales)[number])}
        className="bg-[var(--bg-dark)] text-white border border-[var(--border-color)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {localeNames[loc]}
          </option>
        ))}
      </select>
    </div>
  );
}
