import { useId } from "react";
import { Pill, type PillTone } from "@/app/ui";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import { questionText } from "@/lib/i18n/category-labels";
import type { SupervisorThread } from "@/lib/day/contract";
import type { TimelineItem } from "@/lib/day/view-model";
import { debriefRows, rowQuestionView, type DebriefOutcome } from "@/app/day/summary";
import styles from "@/app/day/day.module.css";

/**
 * "Staff debrief" (R-25 T9, board D2-02): the questions Bee6 asked after closing and how the staff answered, one row
 * each. Supervisor only; the owner response carries no answers. Nothing is added to the data: the question text is the
 * same role-agnostic template the phone shows (enum label + HH:MM, never thread text), and the reason is the
 * already-redacted text the thread card used to show. No name and no device id appears (hard rule #7): the sub line
 * says a staff member answered and that no names are kept.
 */

const OUTCOME: Record<DebriefOutcome, { tone: PillTone; key: DictKey }> = {
  yes: { tone: "green", key: "C-day2-ans-yes" },
  no: { tone: "red", key: "C-day2-ans-no" },
  unverified: { tone: "amber", key: "C-day-st-unverified" },
  open: { tone: "neutral", key: "C-day2-ans-open" },
};

export function StaffDebrief({ timeline }: { timeline: readonly TimelineItem<SupervisorThread>[] }) {
  const { lang } = useLang();
  const headingId = useId();
  const rows = debriefRows(timeline);

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className="b6-h2-card">
        {t(lang, "C-day2-debrief-h")}
      </h2>
      <p className={styles.sectionSub}>{t(lang, "C-day2-debrief-sub")}</p>

      {rows.length === 0 ? (
        <p className={`b6-card ${styles.qaEmpty}`}>{t(lang, "C-day2-debrief-none")}</p>
      ) : (
        <ul className={`b6-card ${styles.list}`}>
          {rows.map((row) => {
            const outcome = OUTCOME[row.outcome];
            return (
              <li key={row.key} className={`${styles.item} ${styles.qa}`}>
                <div className={styles.qaText}>
                  <span className={styles.qaQuestion}>{questionText(lang, rowQuestionView(row))}</span>
                  {row.reason !== null && <q className={styles.qaReason}>{row.reason}</q>}
                </div>
                <Pill tone={outcome.tone}>{t(lang, outcome.key)}</Pill>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
