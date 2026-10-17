import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import type { SopChangeView } from "@/lib/sop/contract";
import { VERDICT_KEY } from "@/app/reviews/ReviewCard";
import { cx } from "@/app/ui/cx";
import styles from "@/app/sop/sop.module.css";

/**
 * One approved SOP change as a plain before/after list (R-10 Task 5.4). The
 * changed step as it was, then as it is now, then the metric, failure
 * condition and review date (and, once reviewed, the remembered outcome: R-11
 * Task 7, verdict only, no reasons). No highlighting, no colour coding, no "diff"
 * wording (cut #51). R-25 T12: restyled on the page-2 tokens (`sop.module.css`); `inline` is the card as it opens under
 * an improved step in the book (the step already shows the new and the old wording, so the before/after block is
 * left out there). Every model text field (change title, step title/text,
 * metric description, failure condition) is rendered as a plain text node:
 * never through `t()`, never as HTML.
 */

export const ROLE_KEY: Record<"owner" | "supervisor" | "staff", DictKey> = {
  owner: "C-sop-role-owner",
  supervisor: "C-sop-role-supervisor",
  staff: "C-sop-role-staff",
};

export function SopChangeCard({ change, lang, inline = false }: { change: SopChangeView; lang: Lang; inline?: boolean }) {
  const dirKey: DictKey = change.metric.direction === "decrease" ? "C-prop-dir-decrease" : "C-prop-dir-increase";
  const verdict =
    change.outcome === null
      ? null
      : change.outcome.verdict === "unknown"
        ? t(lang, "C-sop-outcome-unknown")
        : t(lang, "C-sop-outcome", { verdict: t(lang, VERDICT_KEY[change.outcome.verdict]) });
  return (
    <article className={cx(styles.change, inline && styles.changeInline)}>
      <h4 className={styles.changeHead}>
        {t(lang, "C-sop-change-head", {
          version: change.version,
          date: dayLabel(change.effective_from_date, lang),
        })}
      </h4>
      <p className={styles.changeLine}>{change.change_title}</p>

      {!inline && (
        <>
          <h5 className={styles.changeSub}>{t(lang, "C-sop-before", { version: change.previous_version })}</h5>
          {change.before ? (
            <>
              <p className={styles.changeLine}>
                <strong>{change.before.title}</strong>
              </p>
              <p className={styles.changeLine}>{change.before.text}</p>
            </>
          ) : (
            <p className={styles.changeLine}>{t(lang, "C-sop-new-step", { version: change.previous_version })}</p>
          )}

          <h5 className={styles.changeSub}>{t(lang, "C-sop-after", { version: change.version })}</h5>
          <p className={styles.changeLine}>
            <strong>{change.after.title}</strong>
          </p>
          <p className={styles.changeLine}>{change.after.text}</p>
          <p className={styles.changeLine}>{t(lang, "C-sop-step-role", { role: t(lang, ROLE_KEY[change.after.role]) })}</p>
        </>
      )}

      <p className={styles.changeLine}>
        {t(lang, "C-prop-metric", {
          category: t(lang, CATEGORY_KEY[change.metric.category]),
          direction: t(lang, dirKey),
          count: change.metric.baseline_count,
          days: change.metric.baseline_days,
        })}
      </p>
      <p className={styles.changeLine}>{change.metric.description}</p>
      <p className={styles.changeLine}>
        <strong>{t(lang, "C-prop-failure")}:</strong> {change.failure_condition}
      </p>
      <p className={styles.changeLine}>{t(lang, "C-prop-review", { date: dayLabel(change.review_date, lang) })}</p>
      <p className={styles.changeLine}>{t(lang, "C-sop-approved-on", { date: dayLabel(change.approved_date, lang) })}</p>
      {verdict !== null && (
        <>
          <p className={styles.changeLine}>{verdict}</p>
          {change.outcome?.simulated && <p className={cx(styles.changeLine, styles.changeStrong)}>{t(lang, "C-rev-simulated")}</p>}
        </>
      )}
    </article>
  );
}
