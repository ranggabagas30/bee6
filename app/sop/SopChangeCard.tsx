import type { CSSProperties } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import type { SopChangeView } from "@/lib/sop/contract";
import { VERDICT_KEY } from "@/app/reviews/ReviewCard";

/**
 * One approved SOP change as a plain before/after list (R-10 Task 5.4). The
 * changed step as it was, then as it is now, then the metric, failure
 * condition and review date (and, once reviewed, the remembered outcome: R-11
 * Task 7, verdict only, no reasons). No highlighting, no colour coding, no "diff"
 * wording (cut #51). Every model text field (change title, step title/text,
 * metric description, failure condition) is rendered as a plain text node:
 * never through `t()`, never as HTML.
 */

export const ROLE_KEY: Record<"owner" | "supervisor" | "staff", DictKey> = {
  owner: "C-sop-role-owner",
  supervisor: "C-sop-role-supervisor",
  staff: "C-sop-role-staff",
};

const CARD_STYLE: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 12,
  marginTop: 12,
  overflowWrap: "anywhere",
};
const LINE_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const HEADING_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const SUBHEADING_STYLE: CSSProperties = { margin: "12px 0 8px 0", fontSize: 16, overflowWrap: "anywhere" };

export function SopChangeCard({ change, lang }: { change: SopChangeView; lang: Lang }) {
  const dirKey: DictKey = change.metric.direction === "decrease" ? "C-prop-dir-decrease" : "C-prop-dir-increase";
  return (
    <article style={CARD_STYLE}>
      <h3 style={HEADING_STYLE}>
        {t(lang, "C-sop-change-head", {
          version: change.version,
          date: dayLabel(change.effective_from_date, lang),
        })}
      </h3>
      <p style={LINE_STYLE}>{change.change_title}</p>

      <h4 style={SUBHEADING_STYLE}>{t(lang, "C-sop-before", { version: change.previous_version })}</h4>
      {change.before ? (
        <>
          <p style={LINE_STYLE}>
            <strong>{change.before.title}</strong>
          </p>
          <p style={LINE_STYLE}>{change.before.text}</p>
        </>
      ) : (
        <p style={LINE_STYLE}>{t(lang, "C-sop-new-step", { version: change.previous_version })}</p>
      )}

      <h4 style={SUBHEADING_STYLE}>{t(lang, "C-sop-after", { version: change.version })}</h4>
      <p style={LINE_STYLE}>
        <strong>{change.after.title}</strong>
      </p>
      <p style={LINE_STYLE}>{change.after.text}</p>
      <p style={LINE_STYLE}>{t(lang, "C-sop-step-role", { role: t(lang, ROLE_KEY[change.after.role]) })}</p>

      <p style={LINE_STYLE}>
        {t(lang, "C-prop-metric", {
          category: t(lang, CATEGORY_KEY[change.metric.category]),
          direction: t(lang, dirKey),
          count: change.metric.baseline_count,
          days: change.metric.baseline_days,
        })}
      </p>
      <p style={LINE_STYLE}>{change.metric.description}</p>
      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-failure")}:</strong> {change.failure_condition}
      </p>
      <p style={LINE_STYLE}>{t(lang, "C-prop-review", { date: dayLabel(change.review_date, lang) })}</p>
      <p style={LINE_STYLE}>{t(lang, "C-sop-approved-on", { date: dayLabel(change.approved_date, lang) })}</p>
      {change.outcome !== null && (
        <>
          <p style={LINE_STYLE}>
            {change.outcome.verdict === "unknown"
              ? t(lang, "C-sop-outcome-unknown")
              : t(lang, "C-sop-outcome", { verdict: t(lang, VERDICT_KEY[change.outcome.verdict]) })}
          </p>
          {change.outcome.simulated && (
            <p style={{ ...LINE_STYLE, fontWeight: 700 }}>{t(lang, "C-rev-simulated")}</p>
          )}
        </>
      )}
    </article>
  );
}
