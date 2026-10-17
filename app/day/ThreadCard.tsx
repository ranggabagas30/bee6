import type { Auth } from "@/lib/auth/client/firebase-client";
import { Chip, Pill } from "@/app/ui";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { CATEGORY_KEY, RUNNER_UP_KEY } from "@/lib/day/view-model";
import type { OwnerThread, SupervisorThread } from "@/lib/day/contract";
import { ThreadActions } from "@/app/day/ThreadActions";
import { CATEGORY_CODE, needsCheck, statusPill } from "@/app/day/summary";
import styles from "@/app/day/day.module.css";

/**
 * One note row (R-06 Task 7.5; restyled in R-25 T9 to board D2-02). The owner/supervisor split is a TypeScript
 * narrow on `view`, not a client-side role check: the security boundary is the response shape `getDayRecord` already
 * enforces server-side (CLAUDE.md hard rule #7), so a `SupervisorThread` is never constructed for an owner caller.
 *
 * Row layout: time, category chip + summary, the redacted evidence line(s) (supervisor only), confidence, the status
 * pill, then the actions. The staff's answer now lives in the "Staff debrief" section below the list, not here.
 * `onReload`/`auth` feed `ThreadActions`, rendered only when the server says the row is reviewable
 * (`can_review && handle !== null`): this component never re-derives eligibility itself.
 */

export type ThreadCardProps =
  | { view: "owner"; thread: OwnerThread }
  | { view: "supervisor"; thread: SupervisorThread; onReload: () => void; auth: Auth };

export function ThreadCard(props: ThreadCardProps) {
  const { lang } = useLang();
  const { view, thread } = props;
  const check = view === "supervisor" && needsCheck(props.thread);
  const pill = statusPill(thread.display_status, check);
  const categoryName = t(lang, CATEGORY_KEY[thread.category]);

  return (
    <article className={styles.row}>
      <span className={`b6-mono ${styles.time}`}>
        {thread.start_hm}
        <span className="b6-sr-only">{`–${thread.end_hm}`}</span>
      </span>

      <div className={styles.body}>
        <div className={styles.titleLine}>
          <Chip title={categoryName}>{CATEGORY_CODE[thread.category]}</Chip>
          <span className={styles.summary}>{thread.summary.trim() === "" ? t(lang, "C-day-no-summary") : thread.summary}</span>
        </div>

        {view === "supervisor" && (
          <>
            {props.thread.evidence.length > 0 && (
              <>
                <p className="b6-sr-only">{t(lang, "C-day-evidence")}</p>
                {props.thread.evidence.map((line, index) => (
                  <blockquote key={index} className={styles.quote}>
                    <span className={styles.quoteHm}>{line.hm}</span>
                    {`“${line.text}”`}
                  </blockquote>
                ))}
                {props.thread.evidence_more > 0 && (
                  <p className={styles.meta}>{t(lang, "C-day-evidence-more", { N: props.thread.evidence_more })}</p>
                )}
              </>
            )}
          </>
        )}

        <p className={styles.meta}>
          {t(lang, "C-day-confidence", { pct: thread.confidence_pct })}
          {` · ${categoryName}`}
        </p>

        {view === "supervisor" && props.thread.runner_up !== null && (
          <details className={styles.runner}>
            <summary>{t(lang, "C-day-runnerup", { label: t(lang, RUNNER_UP_KEY[props.thread.runner_up.category]) })}</summary>
            <p>{props.thread.runner_up.why_not === null ? t(lang, "C-day-runnerup-none") : props.thread.runner_up.why_not}</p>
          </details>
        )}
      </div>

      <Pill tone={pill.tone} className={styles.pill}>
        {t(lang, pill.key)}
      </Pill>

      {view === "supervisor" && props.thread.can_review && props.thread.handle !== null && (
        <div className={styles.actions}>
          <ThreadActions thread={props.thread} auth={props.auth} onDone={props.onReload} />
        </div>
      )}
    </article>
  );
}
