import type { CSSProperties, ReactNode } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import type { ReviewVerdict } from "@/lib/firestore/schema";
import type { ReviewView } from "@/lib/reviews/contract";

/**
 * One review of a shipped SOP change (R-11 Task 6.4): the before/after
 * numbers, bee6's plain-code suggestion, and what the supervisor and owner
 * decided. Owner and supervisor see the identical card (each other's reasons
 * included, by design). Every text that is not copy (change title, metric
 * description, failure condition, reasons) is a plain text node: never
 * through `t()`, never as HTML.
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

/** The suggestion line's DOM id, so the matching verdict button can point at it with `aria-describedby`. */
export function suggestionDomId(version: number): string {
  return `rev-${version}-suggestion`;
}

const CARD_STYLE: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 12,
  marginTop: 12,
  overflowWrap: "anywhere",
};
const LINE_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const HEADING_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const BOLD_LINE_STYLE: CSSProperties = { ...LINE_STYLE, fontWeight: 700 };
const STATUS_LINE_STYLE: CSSProperties = { ...LINE_STYLE, fontWeight: 600 };
const REASON_STYLE: CSSProperties = { display: "block", overflowWrap: "anywhere" };
const BAR_TRACK_STYLE: CSSProperties = {
  height: 12,
  width: "100%",
  background: "#e5e7eb",
  borderRadius: 4,
  margin: "0 0 8px 0",
  overflow: "hidden",
};

function rateOf(w: { days_captured: number; count: number }): number | null {
  return w.days_captured === 0 ? null : w.count / w.days_captured;
}

function rateText(rate: number | null, lang: Lang): string {
  return rate === null ? t(lang, "C-rev-rate-none") : rate.toFixed(1);
}

function Bar({ rate, max, tone }: { rate: number | null; max: number; tone: string }) {
  const value = rate ?? 0;
  const pct = max > 0 ? Math.round((value / max) * 1000) / 10 : 0;
  const style: CSSProperties = {
    height: "100%",
    width: `${pct}%`,
    background: tone,
    ...(value > 0 ? { minWidth: 2 } : {}),
  };
  return (
    <div aria-hidden="true" style={BAR_TRACK_STYLE}>
      <div data-testid="rate-bar" style={style} />
    </div>
  );
}

export function ReviewCard({
  review,
  lang,
  children,
}: {
  review: ReviewView;
  lang: Lang;
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
    <article style={CARD_STYLE}>
      <h3 style={HEADING_STYLE}>
        {t(lang, "C-rev-head", { version: review.version, date: dayLabel(review.review_date, lang) })}
      </h3>
      {review.simulated && <p style={BOLD_LINE_STYLE}>{t(lang, "C-rev-simulated")}</p>}
      <p style={LINE_STYLE}>{review.change_title}</p>

      <p style={LINE_STYLE}>
        {t(lang, "C-prop-metric", {
          category: t(lang, CATEGORY_KEY[review.metric.category]),
          direction: t(lang, dirKey),
          count: review.metric.baseline_count,
          days: review.metric.baseline_days,
        })}
      </p>
      <p style={LINE_STYLE}>{review.metric.description}</p>

      <p style={LINE_STYLE}>
        {t(lang, "C-rev-window-before", {
          from: dayLabel(before.from_date, lang),
          to: dayLabel(before.to_date, lang),
          count: before.count,
          days: before.days_captured,
          rate: rateText(beforeRate, lang),
        })}
      </p>
      <Bar rate={beforeRate} max={maxRate} tone="#6b7280" />
      <p style={LINE_STYLE}>
        {t(lang, "C-rev-window-after", {
          from: dayLabel(after.from_date, lang),
          to: dayLabel(after.to_date, lang),
          count: after.count,
          days: after.days_captured,
          rate: rateText(afterRate, lang),
        })}
      </p>
      <Bar rate={afterRate} max={maxRate} tone="#1d4ed8" />
      <p style={LINE_STYLE}>{t(lang, "C-rev-short-window")}</p>

      {suggestion.verdict !== null ? (
        <>
          <p id={suggestionDomId(review.version)} style={STATUS_LINE_STYLE}>
            {t(lang, "C-rev-suggest", { verdict: t(lang, VERDICT_KEY[suggestion.verdict]) })}
          </p>
          <p style={LINE_STYLE}>{why}</p>
        </>
      ) : (
        <p id={suggestionDomId(review.version)} style={STATUS_LINE_STYLE}>
          {t(lang, "C-rev-suggest-none", { why })}
        </p>
      )}

      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-failure")}:</strong> {review.failure_condition}
      </p>

      {notices.overlapping_change && <p style={LINE_STYLE}>{t(lang, "C-rev-notice-overlap")}</p>}
      {notices.threads_truncated && <p style={LINE_STYLE}>{t(lang, "C-rev-notice-truncated")}</p>}

      {supervisor && (
        <p style={LINE_STYLE}>
          {t(lang, "C-rev-sup-said", {
            date: dayLabel(supervisor.decided_date, lang),
            verdict: t(lang, VERDICT_KEY[supervisor.verdict]),
          })}
          {supervisor.reason !== null && (
            <span style={REASON_STYLE}>
              {t(lang, "C-rev-reason")} <span>{supervisor.reason}</span>
            </span>
          )}
        </p>
      )}
      {owner && (
        <p style={LINE_STYLE}>
          {t(lang, "C-rev-owner-said", {
            date: dayLabel(owner.decided_date, lang),
            verdict: t(lang, VERDICT_KEY[owner.verdict]),
          })}
          {owner.reason !== null && (
            <span style={REASON_STYLE}>
              {t(lang, "C-rev-reason")} <span>{owner.reason}</span>
            </span>
          )}
        </p>
      )}
      {anyRevert && <p style={LINE_STYLE}>{t(lang, "C-rev-revert-note")}</p>}

      {statusLine !== null && <p style={STATUS_LINE_STYLE}>{statusLine}</p>}

      {children}
    </article>
  );
}
