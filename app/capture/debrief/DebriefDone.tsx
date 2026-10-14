"use client";

import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { clockLabel } from "@/lib/i18n/format";

/**
 * The debrief done screen, and the zero-question empty state (R-07 Task 7.2,
 * UX-03 section 4.3). No early release (Q30): reaching either screen never
 * ends the debrief — the 1-hour clock keeps running, so Kembali returns to
 * `/capture`, which still shows the entry card until the timeout. No
 * per-answer recap (it would look like a stored transcript).
 *
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3, board P2-10), `demo` only: the done screen is terminal. No
 * Back button; "Debrief complete" with one count line ("All {n} questions are answered", "Today's only
 * question is answered", or "{k} of {n} were not answered and are recorded as unverified"), and no next-Start
 * line (Start is locked until the next day; the page's `primary` slot says so). A pilot phone never passes
 * `demo`, so its screen is unchanged.
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
  /** This device's own answers this debrief; only the demo summary reads it. */
  answered?: number;
  skipped: number;
  endsAtMs: number;
  tz: string;
  nextMulaiText: { day: string; hm: string } | null;
  onBack: () => void;
  /** R-19, sandbox only: terminal done (no Back, P2-10 copy). Absent on the pilot. */
  demo?: boolean;
}

function demoSummaryKey(answered: number, skipped: number): { key: "C-d-empty-h" | "C-d2-done-all" | "C-d2-done-all-one" | "C-d2-done-some"; vars: Record<string, number> } {
  const n = answered + skipped;
  if (n === 0) return { key: "C-d-empty-h", vars: {} };
  if (skipped > 0) return { key: "C-d2-done-some", vars: { k: skipped, n } };
  if (n === 1) return { key: "C-d2-done-all-one", vars: {} };
  return { key: "C-d2-done-all", vars: { n } };
}

export function DebriefDone({ pending, answered = 0, skipped, endsAtMs, tz, nextMulaiText, onBack, demo = false }: DebriefDoneProps) {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const unsent =
    pending > 0 ? (
      <>
        <p style={{ margin: "12px 0 0" }}>
          {t(lang, pending === 1 ? "C-d-done-unsent-one" : "C-d-done-unsent", { N: pending })}
        </p>
        <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-done-unsent-2")}</p>
      </>
    ) : null;

  if (demo) {
    const summary = demoSummaryKey(answered, skipped);
    return (
      <section>
        <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 18, margin: 0, outline: "none" }}>
          {t(lang, "C-d2-done-h")}
        </h2>
        <p style={{ margin: "4px 0 0" }}>{t(lang, summary.key, summary.vars)}</p>
        {unsent}
      </section>
    );
  }

  return (
    <section>
      <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 18, margin: 0, outline: "none" }}>
        {t(lang, "C-d-done-h")}
      </h2>
      <p style={{ margin: "4px 0 0" }}>{t(lang, "C-d-done-l")}</p>
      {unsent}
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
      <button type="button" style={BACK_BUTTON_STYLE} onClick={onBack}>
        {t(lang, "C-b-kembali")}
      </button>
    </section>
  );
}

export interface DebriefEmptyProps {
  onBack: () => void;
}

/** Zero open questions on load (pilot only; a sandbox lands on `preparing` or `done` instead): neutral thanks, no stats. */
export function DebriefEmpty({ onBack }: DebriefEmptyProps) {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <section>
      <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 18, margin: 0, outline: "none" }}>
        {t(lang, "C-d-empty-h")}
      </h2>
      <p style={{ margin: "4px 0 0" }}>{t(lang, "C-d-empty-h-2")}</p>
      <button type="button" style={BACK_BUTTON_STYLE} onClick={onBack}>
        {t(lang, "C-b-kembali")}
      </button>
    </section>
  );
}
