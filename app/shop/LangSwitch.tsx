"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { buildLangCookie, type Lang } from "@/lib/i18n/lang";

/**
 * The ID | EN switch (UX-03 section 5.12). Two native buttons in one group, 48 px
 * targets. The visible text is the code, which does not change with language.
 * The accessible name is the endonym, which does not change either. The group
 * name is in the current language. A tap on the pressed option does nothing.
 * A separate polite live region speaks one line in the new language.
 */

const OPTIONS: readonly Lang[] = ["id", "en"];

const BUTTON_BASE: React.CSSProperties = {
  minWidth: 48,
  minHeight: 48,
  padding: "0 12px",
  fontSize: 16,
  borderRadius: 8,
  cursor: "pointer",
};

/** Device-only preference: a cookie, no server write, no name, no id. */
function writeLangCookie(lang: Lang) {
  document.cookie = buildLangCookie(lang);
}

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

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
      <div
        role="group"
        aria-label={t(lang, "C-lang-group")}
        style={{ display: "inline-flex", gap: 8 }}
      >
        {OPTIONS.map((option) => {
          const pressed = option === lang;
          return (
            <button
              key={option}
              type="button"
              aria-label={option === "id" ? t(lang, "C-lang-id") : t(lang, "C-lang-en")}
              aria-pressed={pressed}
              onClick={() => choose(option)}
              style={{
                ...BUTTON_BASE,
                fontWeight: pressed ? 700 : 400,
                background: pressed ? "#14532d" : "#ffffff",
                color: pressed ? "#ffffff" : "#111111",
                border: pressed ? "2px solid #14532d" : "2px solid #6b7280",
              }}
            >
              {option === "id" ? "ID" : "EN"}
            </button>
          );
        })}
      </div>
      <p role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
        {said}
      </p>
    </>
  );
}
