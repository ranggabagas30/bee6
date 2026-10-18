import type { CSSProperties, ReactNode } from "react";
import { Chip, Tile } from "@/app/ui";
import { cx } from "@/app/ui/cx";
import styles from "@/app/reviews/reviews.module.css";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import type { ReviewVerdict } from "@/lib/firestore/schema";
import type { ReviewView } from "@/lib/reviews/contract";
import type { ReviewCaveat } from "@/lib/reviews/agent/schema";

/**
 * One review of a shipped SOP change (R-11 Task 6.4): the before/after
 * numbers, bee6's plain-code suggestion, and what the supervisor and owner
 * decided. Owner and supervisor see the identical card (each other's reasons
 * included, by design). Every text that is not copy (change title, metric
 * description, failure condition, reasons) is a plain text node: never
 * through `t()`, never as HTML.
 *
 * `review.agent` (ReviewAgent, docs/tasks/review-agent-18oct.md 5.12) adds the "Bee6 explains" panel: the model's
 * narrative as ONE text node (English only, `lang="en"`; never `t()`, never HTML) and, under it, the caveats the
 * CODE computed, as fixed lines from the copy table (no model text), then a fixed framing line saying the
 * suggestion above comes from a rule and the verdict is the people's. The panel never decides or changes anything.
 *
 * The bars are decoration (`aria-hidden`); the numbers are always in text.
 */

export const VERDICT_KEY: Record<ReviewVerdict, DictKey> = {
  worked: "C-rev-v-worked",
  revise: "C-rev-v-revise",
  revert: "C-rev-v-revert",
};

type SuggestionReason = ReviewView["suggestion"]["reason"];

// Exhaustive on purpose: a new suggestion reason that is not mapped fails `tsc`.
const WHY_KEY: Record<SuggestionReason, DictKey> = {
  improved: "C-rev-why-improved",
  worsened: "C-rev-why-worsened",
  no_clear_change: "C-rev-why-no_clear_change",
  not_enough_days: "C-rev-why-not_enough_days",
  no_baseline: "C-rev-why-no_baseline",
};

// Exhaustive on purpose: a new caveat that is not mapped fails `tsc`.
const CAVEAT_KEY: Record<ReviewCaveat, DictKey> = {
  short_window: "C-rev-agent-cv-short_window",
  category_count_not_problem_count: "C-rev-agent-cv-category_count_not_problem_count",
  staff_answers_affect_count: "C-rev-agent-cv-staff_answers_affect_count",
  overlapping_change: "C-rev-agent-cv-overlapping_change",
  threads_truncated: "C-rev-agent-cv-threads_truncated",
  not_enough_days: "C-rev-agent-cv-not_enough_days",
  no_baseline: "C-rev-agent-cv-no_baseline",
};

/** The agent panel's heading DOM id (labels the panel). */
export function agentDomId(version: number): string {
  return `rev-${version}-agent`;
}

/** The suggestion line's DOM id, so the matching verdict button can point at it with `aria-describedby`. */
export function suggestionDomId(version: number): string {
  return `rev-${version}-suggestion`;
}

function rateOf(w: { days_captured: number; count: number }): number | null {
  return w.days_captured === 0 ? null : w.count / w.days_captured;
}

/** One window's line: with no captured day there is no rate to show, so the line says so instead of "0 in 0 days, X per day". */
function windowLine(
  which: "before" | "after",
  w: { from_date: string; to_date: string; days_captured: number; count: number },
  lang: Lang,
): string {
  const range = { from: dayLabel(w.from_date, lang), to: dayLabel(w.to_date, lang) };
  const rate = rateOf(w);
  if (rate === null) return t(lang, which === "before" ? "C-rev-window-before-none" : "C-rev-window-after-none", range);
  return t(lang, which === "before" ? "C-rev-window-before" : "C-rev-window-after", {
    ...range,
    count: w.count,
    days: w.days_captured,
    rate: rate.toFixed(1),
  });
}

function Bar({ rate, max, which }: { rate: number | null; max: number; which: "before" | "after" }) {
  const value = rate ?? 0;
  const pct = max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
  const style: CSSProperties = {
    width: `${pct}%`,
    ...(value > 0 ? { minWidth: 2 } : {}),
  };
  return (
    <span aria-hidden="true" className={styles.track}>
      <span data-testid="rate-bar" className={which === "before" ? styles.barBefore : styles.barAfter} style={style} />
    </span>
  );
}

/** One window as a glass tile: the rate per day as the value, the full window line as the detail, the bar under it. */
function WindowTile({
  which,
  w,
  max,
  lang,
}: {
  which: "before" | "after";
  w: { from_date: string; to_date: string; days_captured: number; count: number };
  max: number;
  lang: Lang;
}) {
  const rate = rateOf(w);
  return (
    <Tile
      surface="glass"
      label={t(lang, which === "before" ? "C-rev2-before" : "C-rev2-after")}
      value={rate === null ? t(lang, "C-rev2-rate-none") : t(lang, "C-rev2-rate", { rate: rate.toFixed(1) })}
      detail={
        <>
          {windowLine(which, w, lang)}
          <Bar rate={rate} max={max} which={which} />
        </>
      }
    />
  );
}

export function ReviewCard({
  review,
  lang,
  agentMissing = false,
  children,
}: {
  review: ReviewView;
  lang: Lang;
  /**
   * Set by the Reviews page for the review a fast-forward tap just created while the ReviewAgent was on, when that
   * review came back without an explanation (the agent timed out or fell back). Shows one fixed notice (no model
   * text). Ignored when the review does carry an explanation.
   */
  agentMissing?: boolean;
  children?: ReactNode;
}) {
  const { before, after, suggestion, notices, supervisor, owner } = review;
  const beforeRate = rateOf(before);
  const afterRate = rateOf(after);
  const maxRate = Math.max(beforeRate ?? 0, afterRate ?? 0);
  const dirKey: DictKey = review.metric.direction === "decrease" ? "C-prop-dir-decrease" : "C-prop-dir-increase";
  const pct = Math.round(Math.abs(suggestion.change_ratio ?? 0) * 100);
  const why = t(lang, WHY_KEY[suggestion.reason], { pct });
  const anyRevert = supervisor?.verdict === "revert" || owner?.verdict === "revert";

  let statusLine: string | null;
  switch (review.status) {
    case "awaiting_supervisor":
      statusLine = t(lang, "C-rev-st-awaiting-sup", { date: dayLabel(review.confirm_by_date, lang) });
      break;
    case "awaiting_owner":
      statusLine = t(lang, "C-rev-st-awaiting-owner", { date: dayLabel(review.confirm_by_date, lang) });
      break;
    case "confirmed":
      statusLine = owner
        ? t(lang, "C-rev-st-confirmed", { verdict: t(lang, VERDICT_KEY[owner.verdict]) })
        : null;
      break;
    case "unknown":
      statusLine = t(lang, "C-rev-st-unknown");
      break;
  }

  return (
    <article className={cx("b6-card", styles.card)}>
      <header className={styles.cardHead}>
        <p className="b6-kick">
          {t(lang, "C-rev2-kick", { version: review.version, date: dayLabel(review.review_date, lang) })}
        </p>
        {review.simulated && <Chip variant="amber">{t(lang, "C-rev-simulated")}</Chip>}
        {/* h3: the page h1 and the "Waiting for a verdict" / "Decided" h2 sit above it. */}
        <h3 className={cx("b6-h2-card", styles.cardTitle)}>{review.change_title}</h3>
      </header>

      <div className={styles.lines}>
        <p className="b6-sub">
          {t(lang, "C-prop-metric", {
            category: t(lang, CATEGORY_KEY[review.metric.category]),
            direction: t(lang, dirKey),
            count: review.metric.baseline_count,
            days: review.metric.baseline_days,
          })}
        </p>
        <p className="b6-sub">{review.metric.description}</p>
      </div>

      <div className={styles.windows} role="group" aria-label={t(lang, "C-rev2-windows")}>
        <WindowTile which="before" w={before} max={maxRate} lang={lang} />
        <WindowTile which="after" w={after} max={maxRate} lang={lang} />
      </div>
      <p className={cx("b6-note", styles.shortNote)}>{t(lang, "C-rev-short-window")}</p>

      {suggestion.verdict !== null ? (
        <div className={cx("b6-alert", "b6-alert--amber", styles.suggest)}>
          <p id={suggestionDomId(review.version)} className="b6-alert__lead">
            {t(lang, "C-rev-suggest", { verdict: t(lang, VERDICT_KEY[suggestion.verdict]) })}
          </p>
          <p className={styles.status}>{why}</p>
        </div>
      ) : (
        <div className={cx("b6-alert", styles.suggest, styles.suggestNone)}>
          <p id={suggestionDomId(review.version)} className="b6-alert__lead">
            {t(lang, "C-rev-suggest-none", { why })}
          </p>
        </div>
      )}

      {/* A labelled group, not a <section>: several cards on one page would repeat the same landmark name. */}
      {review.agent && (
        <div role="group" className={styles.agent} aria-labelledby={agentDomId(review.version)}>
          <p id={agentDomId(review.version)} className="b6-kick">
            {t(lang, "C-rev-agent-kick")}
          </p>
          {/* The model's words: a text node, English only (marked so a screen reader switches voice on a Bahasa page). */}
          <p lang="en" className={styles.agentText}>
            {review.agent.narrative_en}
          </p>
          {review.agent.caveats.length > 0 && (
            <ul className={styles.agentCaveats}>
              {review.agent.caveats.map((c) => (
                <li key={c}>{t(lang, CAVEAT_KEY[c])}</li>
              ))}
            </ul>
          )}
          <p className={cx("b6-note", styles.agentNote)}>{t(lang, "C-rev-agent-note")}</p>
        </div>
      )}

      {agentMissing && !review.agent && (
        <p role="status" className="b6-alert">
          {t(lang, "C-rev-agent-missing")}
        </p>
      )}

      <p className={styles.line}>
        <strong>{t(lang, "C-prop-failure")}:</strong> {review.failure_condition}
      </p>

      {notices.overlapping_change && (
        <p className={cx("b6-alert", "b6-alert--amber")}>{t(lang, "C-rev-notice-overlap")}</p>
      )}
      {notices.threads_truncated && (
        <p className={cx("b6-alert", "b6-alert--amber")}>{t(lang, "C-rev-notice-truncated")}</p>
      )}

      {(supervisor || owner) && (
        <div className={styles.decisions}>
          {supervisor && (
            <p className={styles.line}>
              {t(lang, "C-rev-sup-said", {
                date: dayLabel(supervisor.decided_date, lang),
                verdict: t(lang, VERDICT_KEY[supervisor.verdict]),
              })}
              {supervisor.reason !== null && (
                <span className={styles.reason}>
                  {t(lang, "C-rev-reason")} <span>{supervisor.reason}</span>
                </span>
              )}
            </p>
          )}
          {owner && (
            <p className={styles.line}>
              {t(lang, "C-rev-owner-said", {
                date: dayLabel(owner.decided_date, lang),
                verdict: t(lang, VERDICT_KEY[owner.verdict]),
              })}
              {owner.reason !== null && (
                <span className={styles.reason}>
                  {t(lang, "C-rev-reason")} <span>{owner.reason}</span>
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {anyRevert && <p className={cx("b6-alert", "b6-alert--amber")}>{t(lang, "C-rev-revert-note")}</p>}

      {statusLine !== null && <p className={cx("b6-mono", styles.status)}>{statusLine}</p>}

      {children}
    </article>
  );
}
