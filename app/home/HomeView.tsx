"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { t, type DictKey } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";
import { dayLabel } from "@/lib/i18n/format";
import type { HomeResponse } from "@/lib/home/contract";
import { ButtonLink, Card, Glass, Segmented } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import { PageHead } from "@/app/web/PageHead";
import styles from "@/app/home/home.module.css";

/**
 * The owner Home body (R-06 Task 14a; R-19 PR-8; R-25 T13 = boards D2-07, D2-07c). Reading order: the greeting with the
 * business date; Progress as one sentence with the Week / Month / Since start switch (the server's tallies,
 * feasible-and-decided only, W6); "Waiting for your approval · n" (the supervisor's hand-overs, titles only: the
 * home route carries no category, date or start date, so none is drawn); "Today in five lines" (summaries only: no
 * evidence, no question, no action); Next review; "Cost per outlet-day · coming soon" (a placeholder, never a number).
 * No Team menu (D-9). The page frame (shell, reset notice) is the parent's (`HomeApp`): this view renders data only.
 * The reset control is not on this page: the judge guide's owner-home card hosts it (R15).
 */

export type ProgressWindow = "week" | "month" | "since_start";

const WINDOW_KEY: Record<ProgressWindow, DictKey> = {
  week: "C-home-progress-week",
  month: "C-home-progress-month",
  since_start: "C-home-progress-since",
};
const WINDOW_KICK: Record<ProgressWindow, DictKey> = {
  week: "C-home-progress-kick-week",
  month: "C-home-progress-kick-month",
  since_start: "C-home-progress-kick-since",
};
const WINDOW_IN: Record<ProgressWindow, DictKey> = {
  week: "C-home-progress-in-week",
  month: "C-home-progress-in-month",
  since_start: "C-home-progress-in-since",
};
const WINDOWS: readonly ProgressWindow[] = ["week", "month", "since_start"];

/** Time-of-day greeting on the reader's own clock: morning until 12:00, afternoon until 18:00, then evening. */
export function greetingKey(hour: number): DictKey {
  if (hour < 12) return "C-home-greeting-morning";
  if (hour < 18) return "C-home-greeting-afternoon";
  return "C-home-greeting-evening";
}

function WaitingSub({ count, lang }: { count: number; lang: Lang }) {
  const key: DictKey = count === 1 ? "C-home-waiting-sub-1" : count === 2 ? "C-home-waiting-sub-2" : "C-home-waiting-sub-n";
  return <span className={styles.waitingSub}>{t(lang, key, { n: count })}</span>;
}

function WaitingCard({ data, lang }: { data: HomeResponse; lang: Lang }) {
  const headingId = useId();
  const { count, items } = data.waiting_approval;
  const more = count - items.length;
  const decided = data.progress.since_start.approved + data.progress.since_start.rejected > 0;
  const shipped = data.progress.since_start.approved > 0;

  if (items.length === 0) {
    return (
      <Card as="section" aria-labelledby={headingId} className={cx(styles.waiting, styles.waitingEmpty)}>
        <h2 id={headingId} className={cx("b6-kick", styles.kick)}>
          {t(lang, "C-home-waiting-h", { n: count })}
        </h2>
        {decided ? (
          <>
            <p className={styles.waitingDone}>{t(lang, "C-home-waiting-done")}</p>
            {shipped ? (
              <Link href="/sop" className={styles.softLink}>
                {t(lang, "C-home-waiting-sop")}
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <p className={styles.waitingDone}>{t(lang, "C-web-empty-appr-h")}</p>
            <p className={styles.waitingSub}>{t(lang, "C-web-empty-appr-p")}</p>
          </>
        )}
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby={headingId} className={cx(styles.waiting, styles.waitingFull)}>
      <div className={styles.waitingHead}>
        <div className={styles.waitingTitles}>
          <h2 id={headingId} className={cx("b6-kick", styles.kick)}>
            {t(lang, "C-home-waiting-h", { n: count })}
          </h2>
          <WaitingSub count={count} lang={lang} />
        </div>
        <ButtonLink href="/proposals" size="md" className={styles.inOrder}>
          {t(lang, "C-home-waiting-in-order")}
        </ButtonLink>
      </div>
      <ul className={styles.rows} aria-labelledby={headingId}>
        {items.map((item, index) => (
          <li key={item.proposal_id} className={styles.rowItem}>
            <Link
              href={`/proposals?id=${encodeURIComponent(item.proposal_id)}`}
              className={styles.row}
              aria-label={t(lang, "C-home-waiting-review-a11y", { title: item.change_title })}
            >
              <span className={styles.rowNo} aria-hidden="true">
                #{index + 1}
              </span>
              <span className={styles.rowTitle}>{item.change_title}</span>
              <span className={styles.rowArrow} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className={styles.moreLine}>
          <Link href="/proposals" className={styles.softLink}>
            {t(lang, "C-home-waiting-more", { n: more })}
          </Link>
        </p>
      )}
      {count >= 2 && (
        <div className={styles.oneAtATime}>
          <svg className={styles.oneIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="4" y="5" width="16" height="15" rx="3" />
            <path d="M4 10h16M9 3v4M15 3v4" />
          </svg>
          <p className={styles.oneText}>
            <b className={styles.oneLead}>{t(lang, "C-home-waiting-one-lead")}</b>
            {t(lang, "C-home-waiting-one-body")}
          </p>
        </div>
      )}
    </Card>
  );
}

function ProgressCard({ data, lang }: { data: HomeResponse; lang: Lang }) {
  const headingId = useId();
  const [window, setWindow] = useState<ProgressWindow>("week");
  const tally = data.progress[window];
  const options = WINDOWS.map((value) => ({ value, label: t(lang, WINDOW_KEY[value]) }));
  const decided = tally.approved + tally.rejected > 0;
  return (
    <Glass as="section" aria-labelledby={headingId} className={styles.progress}>
      <div className={styles.progressHead}>
        <h2 id={headingId} className={cx("b6-kick", styles.kick)}>
          {t(lang, WINDOW_KICK[window])}
        </h2>
        <Segmented label={t(lang, "C-home-progress-window")} variant="plain" options={options} value={window} onChange={setWindow} className={styles.switch} />
      </div>
      <div className={styles.progressBody} aria-live="polite" data-testid="progress-line">
        <p className={styles.progressLine}>
          {decided ? (
            <span className={styles.tick} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : null}
          <span>
            {t(lang, "C-home-progress-line", {
              approved: tally.approved,
              rejected: tally.rejected,
              window: t(lang, WINDOW_IN[window]),
            })}
          </span>
        </p>
        <p className={styles.progressSub}>{t(lang, "C-home-progress-sub")}</p>
      </div>
    </Glass>
  );
}

function TodayCard({ data, lang }: { data: HomeResponse; lang: Lang }) {
  const headingId = useId();
  return (
    <Glass as="section" aria-labelledby={headingId} className={styles.today}>
      <h2 id={headingId} className={styles.cardTitle}>
        {t(lang, "C-home-lines-h")}
      </h2>

      {(data.day_status === "closed" || data.day_status === "off") && <p className={styles.muted}>{t(lang, "C-day-off-closed")}</p>}
      {data.day_status === "pending" && <p className={styles.muted}>{t(lang, "C-day-pending")}</p>}

      {data.lines.length === 0 ? (
        <p className={styles.lineText}>{t(lang, "C-day-empty-owner")}</p>
      ) : (
        <ol className={styles.lines}>
          {data.lines.map((line, index) => (
            <li key={index}>{line.summary.trim() === "" ? t(lang, "C-day-no-summary") : line.summary}</li>
          ))}
        </ol>
      )}

      <div className={styles.links}>
        {data.more > 0 && (
          <Link href={`/day/${data.today}`} className={styles.softLink}>
            {t(lang, "C-home-more", { N: data.more })}
          </Link>
        )}
        <Link href={`/day/${data.today}`} className={styles.softLink}>
          {t(lang, "C-home-to-day-full")}
        </Link>
      </div>
    </Glass>
  );
}

export function HomeView({ data, hour = new Date().getHours() }: { data: HomeResponse; hour?: number }) {
  const { lang } = useLang();
  const review = data.next_review;
  const reviewId = useId();

  return (
    <>
      <div className={styles.hello}>
        <PageHead title={t(lang, greetingKey(hour))} sub={t(lang, "C-home-hello", { date: dayLabel(data.today, lang) })} />
      </div>

      <ProgressCard data={data} lang={lang} />
      <WaitingCard data={data} lang={lang} />

      <div className={styles.bottom}>
        <TodayCard data={data} lang={lang} />
        <div className={styles.side}>
          <Glass as="section" className={styles.review} data-testid="tile-review" aria-labelledby={reviewId}>
            <h2 id={reviewId} className={styles.cardTitle}>{t(lang, "C-home-review-title")}</h2>
            {review.date === null ? (
              <>
                <span className={styles.reviewMain}>{t(lang, "C-home-nr-empty-v")}</span>
                <span className={styles.reviewMono}>{t(lang, "C-home-nr-empty-d")}</span>
              </>
            ) : (
              <>
                <span className={styles.reviewMain}>{review.change_title ?? t(lang, "C-web-empty-tile")}</span>
                <span className={styles.reviewMono}>{dayLabel(review.date, lang)}</span>
              </>
            )}
          </Glass>
          <div className={styles.cost} data-testid="tile-cost">
            <span className="b6-kick">{t(lang, "C-home-cost-day")}</span>
            <span className={styles.costSoon}>{t(lang, "C-home-cost-soon")}</span>
          </div>
        </div>
      </div>
    </>
  );
}
