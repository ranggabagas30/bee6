"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { clockLabel } from "@/lib/i18n/format";
import { Button, Stage } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { nextStartParts } from "@/app/capture/debrief/next-start";
import { useFocusOnMount } from "@/app/capture/debrief/useFocusOnMount";
import css from "@/app/capture/debrief/debrief.module.css";

/**
 * The debrief done screen, and the zero-question empty state (R-07 Task 7.2,
 * UX-03 section 4.3). No early release (Q30): reaching either screen never
 * ends the debrief — the 1-hour clock keeps running, so Kembali returns to
 * `/capture`, which still shows the entry card until the timeout. No
 * per-answer recap (it would look like a stored transcript).
 *
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3, board P2-10), `demo` only: the done screen is terminal. No
 * Back button; "Debrief complete" with one count line ("All {n} questions are answered", "Today's only
 * question is answered", or "{k} of {n} were not answered and are recorded as unverified"). R-25 T7 (boards
 * P2-10 / L2-09) gives it the page-2 layout: the done stage, the "Next Start" mono line, the Start button really
 * disabled ("Start unlocks tomorrow") and, when the page passes `onSignOut`, a quiet Sign out link. The count in
 * the sentence is answered + skipped from the flow's own counters (they survive a reload), never a list length.
 * A pilot phone never passes `demo`, so its screen is unchanged.
 */

const BACK_BUTTON_STYLE: React.CSSProperties = {
  marginTop: 16,
  width: "100%",
  minHeight: 56,
  padding: 12,
  fontSize: 18,
  fontWeight: 700,
};

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
  /** The page's ticked clock; the sandbox "Next Start" line is the business date after it. Absent: no such line. */
  nowMs?: number;
  /**
   * R-25 T7, sandbox only: the page's own footer (its disabled Start button, the lock reason or the jump hint, and
   * its Sign out link). Rendered as is. Absent: the screen draws a disabled Start button itself.
   */
  footer?: ReactNode;
  /** R-25 T7, sandbox only, used only without `footer`: shows a quiet Sign out link that calls this. */
  onSignOut?: () => void;
}

function demoSummaryKey(answered: number, skipped: number): { key: "C-d-empty-h" | "C-d2-done-all" | "C-d2-done-all-one" | "C-d2-done-some"; vars: Record<string, number> } {
  const n = answered + skipped;
  if (n === 0) return { key: "C-d-empty-h", vars: {} };
  if (skipped > 0) return { key: "C-d2-done-some", vars: { k: skipped, n } };
  if (n === 1) return { key: "C-d2-done-all-one", vars: {} };
  return { key: "C-d2-done-all", vars: { n } };
}

export function DebriefDone({ pending, answered = 0, skipped, endsAtMs, tz, nextMulaiText, onBack, demo = false, nowMs, footer, onSignOut }: DebriefDoneProps) {
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
    const next = nextStartParts(nextMulaiText, nowMs, tz, lang);
    return (
      <>
        <Stage tone="done" />
        <div className="b6-head">
          <h1 ref={headingRef} tabIndex={-1} className={cx("b6-h1-display", css.title)}>
            {t(lang, "C-d2-done-h")}
          </h1>
          <p className="b6-sub">{t(lang, summary.key, summary.vars)}</p>
          {next ? <span className="b6-mono">{t(lang, "C-d2-next-start", next)}</span> : null}
          {pending > 0 ? (
            <p className="b6-note">
              {t(lang, pending === 1 ? "C-d-done-unsent-one" : "C-d-done-unsent", { N: pending })} {t(lang, "C-d-done-unsent-2")}
            </p>
          ) : null}
        </div>
        <div className={cx("b6-foot", css.foot)}>
          {footer ?? (
            <>
              <Button size="lg" block disabled>
                {t(lang, "C-sess-start-locked")}
              </Button>
              {onSignOut ? (
                <Button variant="text" block onClick={onSignOut}>
                  {t(lang, "C-sess-signout")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </>
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
