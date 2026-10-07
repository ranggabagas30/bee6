"use client";

import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { clockLabel } from "@/lib/i18n/format";

/**
 * The debrief timeout screen (R-07 Task 7.2, UX-03 section 4.2): the clock
 * reached `ends_at_ms`, even mid-question. Sent answers are kept (they were
 * already cached/uploaded); unsent typed text is not — it was never cached.
 */

export interface DebriefTimeoutProps {
  endedAtMs: number;
  tz: string;
  onBack: () => void;
}

const BACK_BUTTON_STYLE: React.CSSProperties = {
  marginTop: 16,
  width: "100%",
  minHeight: 56,
  padding: 12,
  fontSize: 18,
  fontWeight: 700,
};

export function DebriefTimeout({ endedAtMs, tz, onBack }: DebriefTimeoutProps) {
  const { lang } = useLang();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const hm = clockLabel(endedAtMs, tz);
  return (
    <section>
      <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 18, margin: 0, outline: "none" }}>
        {t(lang, "C-d-timeout", { hm })}
      </h2>
      <p style={{ margin: "4px 0 0" }}>{t(lang, "C-d-timeout-2")}</p>
      <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-timeout-3")}</p>
      <button type="button" style={BACK_BUTTON_STYLE} onClick={onBack}>
        {t(lang, "C-b-kembali")}
      </button>
    </section>
  );
}
