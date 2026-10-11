"use client";

import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { clockLabel } from "@/lib/i18n/format";
import { CheckNewButton } from "@/app/capture/debrief/CheckNewButton";

/**
 * The debrief done screen, and the zero-question empty state (R-07 Task 7.2,
 * UX-03 section 4.3). No early release (Q30): reaching either screen never
 * ends the debrief — the 1-hour clock keeps running, so Kembali returns to
 * `/capture`, which still shows the entry card until the timeout. No
 * per-answer recap (it would look like a stored transcript).
 */

const BACK_BUTTON_STYLE: React.CSSProperties = {
  marginTop: 16,
  width: "100%",
  minHeight: 56,
  padding: 12,
  fontSize: 18,
  fontWeight: 700,
};

function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

export interface DebriefDoneProps {
  /** Count of this device's own cached-but-unsent answers (`pendingSummary`). */
  pending: number;
  skipped: number;
  endsAtMs: number;
  tz: string;
  nextMulaiText: { day: string; hm: string } | null;
  onBack: () => void;
  /** R-18, sandbox only: omitted on the pilot, so no "Check for new questions" button renders there. */
  onCheck?: () => void;
  checking?: boolean;
}

export function DebriefDone({ pending, skipped, endsAtMs, tz, nextMulaiText, onBack, onCheck, checking = false }: DebriefDoneProps) {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section>
      <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 18, margin: 0, outline: "none" }}>
        {t(lang, "C-d-done-h")}
      </h2>
      <p style={{ margin: "4px 0 0" }}>{t(lang, "C-d-done-l")}</p>
      {pending > 0 ? (
        <>
          <p style={{ margin: "12px 0 0" }}>
            {t(lang, pending === 1 ? "C-d-done-unsent-one" : "C-d-done-unsent", { N: pending })}
          </p>
          <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-done-unsent-2")}</p>
        </>
      ) : null}
      {skipped > 0 ? (
        <>
          <p style={{ margin: "12px 0 0" }}>
            {t(lang, skipped === 1 ? "C-d-done-skip-one" : "C-d-done-skip", { N: skipped })}
          </p>
          <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-done-skip-2", { hm: clockLabel(endsAtMs, tz) })}</p>
        </>
      ) : null}
      {nextMulaiText ? (
        <p style={{ margin: "12px 0 0" }}>
          {t(lang, "C-d-done-mulai", { day: nextMulaiText.day, hm: nextMulaiText.hm })}
        </p>
      ) : null}
      {onCheck ? <CheckNewButton lang={lang} onCheck={onCheck} checking={checking} /> : null}
      <button type="button" style={BACK_BUTTON_STYLE} onClick={onBack}>
        {t(lang, "C-b-kembali")}
      </button>
    </section>
  );
}

export interface DebriefEmptyProps {
  onBack: () => void;
  onCheck?: () => void;
  checking?: boolean;
}

/** Zero open questions on load: same shape, neutral thanks, no stats. */
export function DebriefEmpty({ onBack, onCheck, checking = false }: DebriefEmptyProps) {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section>
      <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 18, margin: 0, outline: "none" }}>
        {t(lang, "C-d-empty-h")}
      </h2>
      <p style={{ margin: "4px 0 0" }}>{t(lang, "C-d-empty-h-2")}</p>
      {onCheck ? <CheckNewButton lang={lang} onCheck={onCheck} checking={checking} /> : null}
      <button type="button" style={BACK_BUTTON_STYLE} onClick={onBack}>
        {t(lang, "C-b-kembali")}
      </button>
    </section>
  );
}
