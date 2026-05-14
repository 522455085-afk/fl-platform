"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Locale } from "./config";
import { getPreferredLocale, setLocale as setLocaleInStorage } from "./config";
import { getDictionary, type Dictionary, type TranslationKey } from "./dictionaries";

interface I18nContextType {
  locale: Locale;
  t: (key: TranslationKey) => string;
  setLocale: (locale: Locale) => void;
  dict: Dictionary;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getPreferredLocale);
  const [dict, setDict] = useState<Dictionary>(() =>
    getDictionary(locale)
  );

  useEffect(() => {
    const newDict = getDictionary(locale);
    setDict(newDict);
  }, [locale]);

  const setLocale = (newLocale: Locale) => {
    setLocaleInStorage(newLocale);
    setLocaleState(newLocale);
  };

  const t = (key: TranslationKey): string => {
    return dict[key] || key;
  };

  return (
    <I18nContext.Provider value={{ locale, t, setLocale, dict }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within a LanguageProvider");
  }
  return context;
}

/**
 * 翻译钩子（简化版）
 */
export function useT(): (key: TranslationKey) => string {
  const { t } = useI18n();
  return t;
}
