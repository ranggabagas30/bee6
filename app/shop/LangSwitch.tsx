"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { buildLangCookie, type Lang } from "@/lib/i18n/lang";
import { Segmented, type SegmentedOption } from "@/app/ui";

/**
 * The ID | EN switch (UX-03 section 5.12; page-2 `.seg`, R-25 T4). One `Segmented variant="mono"` group of native
 * toggle buttons. The visible text is the code, which does not change with language. The accessible name starts with
 * that same code and ends with the endonym (WCAG 2.5.3, label in name), so a voice user saying "click EN" matches. The
 * endonym is spoken in its own language. The group name is in the current language. A tap on the pressed option does
 * nothing. A separate polite live region speaks one line in the new language.
 */

const OPTION_TEXT: Record<Lang, { code: string; endonym: string }> = {
  id: { code: "ID", endonym: "Bahasa Indonesia" },
  en: { code: "EN", endonym: "English" },
};

const OPTIONS: readonly SegmentedOption<Lang>[] = (["id", "en"] as const).map((value) => ({
  value,
  label: (
    <>
      {OPTION_TEXT[value].code}
      {" "}
      <span className="b6-sr-only" lang={value}>
        {OPTION_TEXT[value].endonym}
      </span>
    </>
  ),
}));

/** Device-only preference: a cookie, no server write, no name, no id. */
function writeLangCookie(lang: Lang) {
  document.cookie = buildLangCookie(lang);
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  const [said, setSaid] = useState("");

  function choose(next: Lang) {
    if (next === lang) return;
    writeLangCookie(next);
    setLang(next);
    setSaid(t(next, "C-lang-said"));
  }

  return (
    <>
      <Segmented label={t(lang, "C-lang-group")} options={OPTIONS} value={lang} onChange={choose} variant="mono" />
      <p role="status" aria-live="polite" className="b6-sr-only">
        {said}
      </p>
    </>
  );
}
