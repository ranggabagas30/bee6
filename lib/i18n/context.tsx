"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANG, type Lang } from "@/lib/i18n/lang";

/**
 * Shop-phone language state. The root layout reads the cookie on the server
 * and passes it in as `initial`, so the first paint is already in the right
 * language. A tap changes it here; the switch control writes the cookie.
 * `<html lang>` is set by the server on first paint and kept in step here.
 */

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

// Without a provider the copy falls back to English and setLang does nothing.
// The root layout always provides one, so this only matters for isolated renders.
const LangContext = createContext<LangContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
});

export function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initial);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
