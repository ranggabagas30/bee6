"use client";

import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { Button, Stage } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { useFocusOnMount } from "@/app/capture/debrief/useFocusOnMount";
import css from "@/app/capture/debrief/debrief.module.css";

/**
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3), sandbox judge devices only: the two "server is still
 * labelling" screens, in the page-2 look from R-25 T7 (boards P2-08 / L2-07). Neither has a Back button or a
 * manual check: the container polls the list every REFRESH_POLL_MS_DEMO and moves on by itself. A pilot phone
 * never renders either (the reducer only reaches these views with `demo: true`).
 *
 * Exactly one live region per screen: the amber box on Preparing, the sub line on Checking.
 */

/** P2-08: no question yet; W7 tells the judge to keep the page open and the screen on. */
export function DebriefPreparing({ dayNumber = null }: { dayNumber?: number | null }) {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <>
      <Stage tone="amber" />
      <div className="b6-head">
        <h1 ref={headingRef} tabIndex={-1} className={cx("b6-h1-display", css.title)}>
          {t(lang, "C-d2-prep-h")}
        </h1>
        <p className="b6-sub">{t(lang, "C-d2-prep-sub")}</p>
        <span className="b6-mono">
          {dayNumber === null ? t(lang, "C-d2-prep-window-plain") : t(lang, "C-d2-prep-window", { n: dayNumber })}
        </span>
      </div>
      <div className={cx("b6-foot", css.foot)}>
        <div role="status" className="b6-alert b6-alert--amber b6-alert--row">
          <span className="b6-alert__icon" aria-hidden="true">
            !
          </span>
          <span>
            <strong>{t(lang, "C-d2-prep-lead")}</strong> {t(lang, "C-d2-prep-body")}
          </span>
        </div>
        <Button size="lg" block disabled>
          {t(lang, "C-d2-prep-locked")}
        </Button>
      </div>
    </>
  );
}

/** Every offered question is answered or skipped, but the server may still add more. */
export function DebriefWaitingMore() {
  const { lang } = useLang();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <>
      <Stage tone="amber" />
      <div className="b6-head">
        <h1 ref={headingRef} tabIndex={-1} className={cx("b6-h1-display", css.title)}>
          {t(lang, "C-d2-wait-h")}
        </h1>
        <p role="status" className="b6-sub">
          {t(lang, "C-d2-wait-1")}
        </p>
      </div>
    </>
  );
}
