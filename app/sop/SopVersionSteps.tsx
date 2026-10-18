"use client";

import { useId, useState } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t } from "@/lib/i18n/dict";
import { Chip } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { ROLE_KEY, SopChangeCard } from "@/app/sop/SopChangeCard";
import { shortDate, type SopVersionView } from "@/app/sop/versions";
import type { SopStepView } from "@/lib/sop/contract";
import styles from "@/app/sop/sop.module.css";

/**
 * The steps of one SOP version (R-19 PR-9a, §9.1; R-25 T12, board D2-04). The step this version changed
 * (`change.after.step_id`) carries the badge "IMPROVED · NEW ON dd/mm/yy" (or "NEW ON dd/mm/yy" for an added step), its
 * new text, the old wording struck through (`<del>`, with a visually hidden "Before:" for screen readers) and the link
 * "See why it changed and the result". The link is a disclosure: it opens the approved change (metric, failure
 * condition, review date, the outcome once reviewed) right under the step, so the separate "Changes" list is not
 * needed. The seed version has no badge. Every model text field is rendered as a plain text node: never through `t()`,
 * never as HTML.
 *
 * `chapterNumber` numbers the steps "3.1", "3.2" as the board's chapter pages do (decorative: the `<ol>` already
 * numbers them for assistive technology).
 */
function StepItem({
  step,
  number,
  view,
  lang,
}: {
  step: SopStepView;
  number: string;
  view: SopVersionView;
  lang: Lang;
}) {
  // The version's own change, or (item 20) a change of an older version folded into this tab because it shares the
  // effective date: either way the step it rewrote is explained here.
  const change =
    [view.change, ...(view.alsoChanges ?? [])].find((c) => c !== null && c.after.step_id === step.step_id) ?? null;
  const changed = change !== null;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const badge = change ? t(lang, change.kind === "add" ? "C-sop-book-new" : "C-sop-book-improved", { date: shortDate(change.effective_from_date) }) : "";
  return (
    <li className={cx(styles.step, changed && styles.stepChanged)}>
      <span className={styles.stepNum} aria-hidden="true">
        {number}
      </span>
      <div className={styles.stepBody}>
        {changed && <Chip variant="teal">{badge}</Chip>}
        <p className={styles.stepTitle}>{step.title}</p>
        <p className={styles.stepText}>{step.text}</p>
        {changed && change.before !== null && (
          <p className={styles.stepBefore}>
            <span className="b6-sr-only">{t(lang, "C-sop-book-before")}</span>
            <del>{change.before.text}</del>
          </p>
        )}
        <p className={styles.stepRole}>{t(lang, "C-sop-step-role", { role: t(lang, ROLE_KEY[step.role]) })}</p>
        {changed && (
          <>
            <button
              type="button"
              className={styles.why}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
            >
              {t(lang, "C-sop-book-why")}
            </button>
            <div id={panelId} hidden={!open}>
              {open && <SopChangeCard change={change} lang={lang} inline />}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

export function SopVersionSteps({ view, lang, chapterNumber }: { view: SopVersionView; lang: Lang; chapterNumber?: number }) {
  return (
    <ol className={styles.steps}>
      {view.steps.map((step, i) => (
        <StepItem
          key={step.step_id}
          step={step}
          number={chapterNumber === undefined ? `${i + 1}` : `${chapterNumber}.${i + 1}`}
          view={view}
          lang={lang}
        />
      ))}
    </ol>
  );
}
