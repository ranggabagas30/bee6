import { useLang } from "@/lib/i18n/context";
import { t } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { OwnerDayHeader, SupervisorDayHeader } from "@/lib/day/contract";
import styles from "@/app/day/day.module.css";

/**
 * The day record header (R-25 T9, board D2-02): the page title and sub line, the date control, then the lines that
 * only show when they apply (closed / pending / cancelled / truncated). The facts/questions counts, the capture-mode
 * line and the link list are gone: the tiles carry the numbers and the nav row carries the links.
 */
export function DayHeader({
  day,
  threadCount,
  onPrev,
  onNext,
}: {
  /** Both shapes read the same header fields; `view` is accepted so callers keep passing it. */
  view?: "owner" | "supervisor";
  day: OwnerDayHeader | SupervisorDayHeader;
  threadCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { lang } = useLang();
  const nextDisabled = day.date === day.today;

  return (
    <header className={styles.headBlock}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className="b6-h1-web">{t(lang, "C-day-title")}</h1>
          <p className="b6-sub">{t(lang, "C-day2-sub")}</p>
        </div>
        <div role="group" aria-label={t(lang, "C-day2-date-nav")} className={styles.dateNav}>
          <button type="button" aria-label={t(lang, "C-day-prev")} onClick={onPrev} className={styles.dateArrow}>
            <span aria-hidden="true">{"‹"}</span>
          </button>
          <time dateTime={day.date} className={styles.dateTab}>
            {dayLabel(day.date, lang)}
          </time>
          <button
            type="button"
            aria-label={t(lang, "C-day-next")}
            onClick={onNext}
            disabled={nextDisabled}
            className={styles.dateArrow}
          >
            <span aria-hidden="true">{"›"}</span>
          </button>
        </div>
      </div>

      {(day.day_status === "closed" || day.day_status === "off") && <p className={styles.line}>{t(lang, "C-day-off-closed")}</p>}
      {day.day_status === "pending" && <p className={styles.line}>{t(lang, "C-day-pending")}</p>}
      {day.sessions_cancelled > 0 && (
        <p className={styles.line}>{t(lang, "C-day-cancelled", { N: day.sessions_cancelled })}</p>
      )}
      {day.truncated && <p className={styles.line}>{t(lang, "C-day-truncated", { N: threadCount })}</p>}
    </header>
  );
}
