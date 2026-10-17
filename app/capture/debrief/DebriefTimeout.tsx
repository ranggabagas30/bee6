"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { clockLabel } from "@/lib/i18n/format";
import { Button, Stage } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { emphasize } from "@/app/capture/debrief/emphasize";
import { nextStartParts } from "@/app/capture/debrief/next-start";
import { useFocusOnMount } from "@/app/capture/debrief/useFocusOnMount";
import css from "@/app/capture/debrief/debrief.module.css";

/**
 * The debrief timeout screen (R-07 Task 7.2, UX-03 section 4.2): the clock
 * reached `ends_at_ms`, even mid-question. Sent answers are kept (they were
 * already cached/uploaded); unsent typed text is not — it was never cached.
 *
 * R-25 T7 (boards P2-10b / L2-09b), `demo` only: "Debrief closed" in the page-2 layout, with the count of
 * questions left unanswered when the container saw them. The pilot screen is unchanged.
 */

export interface DebriefTimeoutProps {
  endedAtMs: number;
  tz: string;
  onBack: () => void;
  /** R-19 §6.3, sandbox only: adds "Questions left unanswered are recorded as unverified." Absent on the pilot. */
  demo?: boolean;
  /** Sandbox only: how many of the day's questions were left unanswered, from the last list the screen showed. */
  unanswered?: { k: number; n: number } | null;
  /** The page's ticked clock; the sandbox "Next Start" line is the business date after it. */
  nowMs?: number;
  nextMulaiText?: { day: string; hm: string } | null;
  /** Sandbox only: the page's own footer, rendered as is (see DebriefDone). Absent: a disabled Start button here. */
  footer?: ReactNode;
  /** Sandbox only, used only without `footer`: shows a quiet Sign out link that calls this. */
  onSignOut?: () => void;
}

const BACK_BUTTON_STYLE: React.CSSProperties = {
  marginTop: 16,
  width: "100%",
  minHeight: 56,
  padding: 12,
  fontSize: 18,
  fontWeight: 700,
};

export function DebriefTimeout({ endedAtMs, tz, onBack, demo = false, unanswered = null, nowMs, nextMulaiText = null, footer, onSignOut }: DebriefTimeoutProps) {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();

  if (demo) {
    const next = nextStartParts(nextMulaiText, nowMs, tz, lang);
    const sub =
      unanswered && unanswered.k > 0
        ? unanswered.n === 1
          ? t(lang, "C-d2-timeout-sub-one")
          : t(lang, "C-d2-timeout-sub", { k: unanswered.k, n: unanswered.n })
        : t(lang, "C-d2-timeout-sub-plain");
    return (
      <>
        <Stage tone="done" />
        <div className="b6-head">
          <h1 ref={headingRef} tabIndex={-1} className={cx("b6-h1-display", css.title)}>
            {t(lang, "C-d2-timeout-h")}
          </h1>
          <p className="b6-sub">{emphasize(sub, t(lang, "C-d2-unverified-word"))}</p>
          {next ? <span className="b6-mono">{t(lang, "C-d2-next-start", next)}</span> : null}
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
