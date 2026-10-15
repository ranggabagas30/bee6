"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { dayLabel } from "@/lib/i18n/format";
import type { HomeResponse } from "@/lib/home/contract";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import { Card, Segmented, Tile } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { EmptyState } from "@/app/web/EmptyState";
import styles from "@/app/home/home.module.css";

/**
 * The owner Home body (R-06 Task 14a; R-19 PR-8 plan 9.2 = page-1 W4, boards D2-07 / D2-07c). In reading order: the
 * greeting with the business date; "Waiting for your approval · n" (title, "Supervisor marked it feasible", Review →
 * the approvals page); the Progress card with the Week / Month / Since start switch over the server's tallies
 * (feasible-and-decided only, W6); "Today in five lines" (summaries only: no evidence, no question, no action); Next
 * review; "Cost per outlet · coming soon" (a placeholder, never a number). No Team menu (D-9). The reset area is the
 * parent's (`HomeApp`): this view renders data only.
 */

export type ProgressWindow = "week" | "month" | "since_start";

const WINDOW_KEY: Record<ProgressWindow, DictKey> = {
  week: "C-home-progress-week",
  month: "C-home-progress-month",
  since_start: "C-home-progress-since",
};
const WINDOWS: readonly ProgressWindow[] = ["week", "month", "since_start"];

/** Time-of-day greeting on the reader's own clock: morning until 12:00, afternoon until 18:00, then evening. */
export function greetingKey(hour: number): DictKey {
  if (hour < 12) return "C-home-greeting-morning";
  if (hour < 18) return "C-home-greeting-afternoon";
  return "C-home-greeting-evening";
}

function WaitingCard({ data, lang }: { data: HomeResponse; lang: Lang }) {
  const headingId = useId();
  const { count, items } = data.waiting_approval;
  const heading = t(lang, "C-home-waiting-h", { n: count });
  const more = count - items.length;
  return (
    <Card as="section" aria-labelledby={headingId} className={cx(styles.card, styles.waiting)}>
      <h2 id={headingId} className={styles.cardTitle}>
        {heading}
      </h2>
      {items.length === 0 ? (
        <EmptyState className={styles.emptyInCard} title={t(lang, "C-web-empty-appr-h")} detail={t(lang, "C-web-empty-appr-p")} />
      ) : (
        <ul className={styles.rows} aria-labelledby={headingId}>
          {items.map((item) => (
            <li key={item.proposal_id} className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{item.change_title}</span>
                <span className={styles.rowNote}>{t(lang, "C-home-waiting-row")}</span>
              </span>
              <Link
                href={`/proposals?id=${encodeURIComponent(item.proposal_id)}`}
                className={styles.link}
                aria-label={t(lang, "C-home-waiting-review-a11y", { title: item.change_title })}
              >
                {t(lang, "C-home-waiting-review")}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className={styles.line}>
          <Link href="/proposals" className={styles.link}>
            {t(lang, "C-home-waiting-more", { n: more })}
          </Link>
        </p>
      )}
    </Card>
  );
}

function ProgressCard({ data, lang }: { data: HomeResponse; lang: Lang }) {
  const headingId = useId();
  const [window, setWindow] = useState<ProgressWindow>("week");
  const tally = data.progress[window];
  const options = WINDOWS.map((value) => ({ value, label: t(lang, WINDOW_KEY[value]) }));
  return (
    <Card as="section" aria-labelledby={headingId} className={cx(styles.card, styles.progress)}>
      <div className={styles.progressHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t(lang, "C-home-progress-h")}
        </h2>
        <Segmented
          label={t(lang, "C-home-progress-window")}
          variant="plain"
          options={options}
          value={window}
          onChange={setWindow}
          className={styles.switch}
        />
      </div>
      <div className={styles.tiles} aria-live="polite" data-testid="progress-tiles">
        <Tile
          surface="glass"
          data-testid="tile-approved"
          label={t(lang, "C-home-progress-approved")}
          value={tally.approved}
          detail={t(lang, "C-home-progress-approved-detail")}
        />
        <Tile surface="glass" data-testid="tile-rejected" label={t(lang, "C-home-progress-rejected")} value={tally.rejected} />
      </div>
    </Card>
  );
}

function TodayCard({ data, lang }: { data: HomeResponse; lang: Lang }) {
  const headingId = useId();
  return (
    <Card as="section" aria-labelledby={headingId} className={cx(styles.card, styles.today)}>
      <h2 id={headingId} className={styles.cardTitle}>
        {t(lang, "C-home-lines-h")}
      </h2>

      {(data.day_status === "closed" || data.day_status === "off") && <p className={cx(styles.line, styles.muted)}>{t(lang, "C-day-off-closed")}</p>}
      {data.day_status === "pending" && <p className={cx(styles.line, styles.muted)}>{t(lang, "C-day-pending")}</p>}

      <p className={cx(styles.line, styles.muted)}>{t(lang, "C-day-counts-owner", { facts: data.fact_count })}</p>

      {data.lines.length === 0 ? (
        <p className={styles.line}>{t(lang, "C-day-empty-owner")}</p>
      ) : (
        <ol className={styles.lines}>
          {data.lines.map((line, index) => (
            <li key={index} className={styles.lineItem}>
              <p className={styles.lineMeta}>
                {line.start_hm} · {t(lang, CATEGORY_KEY[line.category])}
              </p>
              <p className={styles.lineText}>{line.summary.trim() === "" ? t(lang, "C-day-no-summary") : line.summary}</p>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.links}>
        {data.more > 0 && (
          <Link href={`/day/${data.today}`} className={styles.link}>
            {t(lang, "C-home-more", { N: data.more })}
          </Link>
        )}
        <Link href={`/day/${data.today}`} className={styles.link}>
          {t(lang, "C-home-to-day")}
        </Link>
      </div>
    </Card>
  );
}

export function HomeView({ data, hour = new Date().getHours() }: { data: HomeResponse; hour?: number }) {
  const { lang } = useLang();
  const review = data.next_review;

  return (
    <>
      <div className={styles.head}>
        <h1 className={styles.h1}>{t(lang, greetingKey(hour))}</h1>
        <p className={styles.date}>{dayLabel(data.today, lang)}</p>
      </div>

      <div className={styles.grid}>
        <WaitingCard data={data} lang={lang} />
        <ProgressCard data={data} lang={lang} />
        <TodayCard data={data} lang={lang} />

        <Tile
          className={styles.review}
          data-testid="tile-review"
          label={t(lang, "C-home-review-h")}
          value={review.date === null ? t(lang, "C-web-empty-tile-value") : dayLabel(review.date, lang)}
          detail={review.change_title === null ? t(lang, "C-web-empty-tile") : review.change_title}
        />

        <Tile
          className={styles.cost}
          data-testid="tile-cost"
          label={t(lang, "C-home-cost-h")}
          value={t(lang, "C-web-empty-tile-value")}
          detail={t(lang, "C-home-cost-soon")}
        />
      </div>
    </>
  );
}
