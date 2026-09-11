"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Locale } from "./types";
import { t } from "./dict";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, defaultLocale = "zh" }: { children: ReactNode; defaultLocale?: Locale }) {
  // 先以默认值 SSR/首渲染，挂载后再同步 localStorage，避免 hydration 不匹配
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("pp_locale");
      if (saved === "zh" || saved === "en") setLocale(saved);
    } catch {
      /* localStorage 不可用时保持默认 */
    }
  }, []);
  const changeLocale = useCallback((l: Locale) => {
    setLocale(l);
    try {
      localStorage.setItem("pp_locale", l);
    } catch {
      /* 仅内存态 */
    }
  }, []);
  const translate = useCallback(
    (key: string, params?: Record<string, string | number>) => t(locale, key, params),
    [locale]
  );
  return (
    <I18nContext.Provider value={{ locale, setLocale: changeLocale, t: translate }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useLocale must be used within I18nProvider");
  return ctx;
}
