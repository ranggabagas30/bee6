import { Chip, Pill } from "@/app/ui";
import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import type { SupervisorUnlabelled } from "@/lib/day/contract";
import { statusPill } from "@/app/day/summary";
import styles from "@/app/day/day.module.css";

/**
 * One unlabelled-moment row (R-06 Task 12.4; restyled in R-25 T9 to the same row as `ThreadCard`). Supervisor
 * only: the owner response never carries `unlabelled` rows, so this component is never reached on the owner path.
 * There is no `summary`, `category`, `confidence_pct`, `evidence` or `runner_up` to show (the label call never
 * produced a thread: the unit's lines live only in `segments`, TTL 48 h, and are not read here) and no supervisor
 * action (there is no thread to confirm, change or reject), only the time, the status and a help line. The staff's
 * answer to this moment is listed in the "Staff debrief" section.
 */
export function UnlabelledCard({ item }: { item: SupervisorUnlabelled }) {
  const { lang } = useLang();
  const pill = statusPill(item.display_status, false);

  return (
    <article className={styles.row}>
      <span className={`b6-mono ${styles.time}`}>
        {item.start_hm}
        <span className="b6-sr-only">{`–${item.end_hm}`}</span>
      </span>

      <div className={styles.body}>
        <div className={styles.titleLine}>
          <Chip variant="line">{t(lang, "C-day-unlabelled")}</Chip>
          <span className={styles.summary}>{t(lang, "C-day-unlabelled-help")}</span>
        </div>
      </div>

      <Pill tone={pill.tone} className={styles.pill}>
        {t(lang, pill.key)}
      </Pill>
    </article>
  );
}
