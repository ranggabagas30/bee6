import type { CSSProperties } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import { MODEL_DECLINE_REASONS } from "@/lib/firestore/schema";
import type { ProposalView } from "@/lib/proposals/contract";

/**
 * The generate result card (R-08 Task 7.4). Every status branch the route
 * can return (`suppressed`/`insufficient_evidence`, `suppressed`/
 * `model_declined`, `blocked`, `awaiting_supervisor`) is rendered here; no
 * other role variant exists (owner and supervisor see the identical card —
 * v2, Q-10 — the evidence shown is already the dated summary, never a
 * quoted line, so no owner-specific redaction is needed).
 *
 * Content-bearing statuses are detected by `content !== null`, never by an
 * exhaustive switch on `status` (review focus #9: R-09 later writes
 * `awaiting_owner` / `approved` / `rejected`, which must render the same
 * block without this file changing).
 *
 * Every model free-text field (`change_title`, `change_text`, `rationale`,
 * `failure_condition`, `metric.description`, evidence `summary`) is rendered
 * as plain text only: never through `t()`, never as HTML.
 */

type ModelDeclineReason = (typeof MODEL_DECLINE_REASONS)[number];
type Followup = NonNullable<ProposalView["suppression"]>["followup"];
type ProposalContent = NonNullable<ProposalView["content"]>;

const MODEL_DECLINE_KEY: Record<ModelDeclineReason, DictKey> = {
  no_clear_pattern: "C-prop-declined-no_clear_pattern",
  constraints_block: "C-prop-declined-constraints_block",
  no_matching_intervention: "C-prop-declined-no_matching_intervention",
  evidence_conflicts: "C-prop-declined-evidence_conflicts",
};

const CARD_STYLE: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 12,
  marginTop: 12,
  overflowWrap: "anywhere",
};
const LINE_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const LIST_STYLE: CSSProperties = { margin: "0 0 8px 0", paddingLeft: 20, overflowWrap: "anywhere" };
const HEADING_STYLE: CSSProperties = { margin: "0 0 8px 0", overflowWrap: "anywhere" };
const STATUS_LINE_STYLE: CSSProperties = { ...LINE_STYLE, fontWeight: 600 };

function FollowupLines({ followup, lang }: { followup: Followup; lang: Lang }) {
  return (
    <>
      <p style={LINE_STYLE}>
        {t(lang, "C-prop-insufficient", {
          facts: followup.have_facts,
          dates: followup.have_dates,
          needFacts: followup.need_facts,
          needDates: followup.need_dates,
        })}
      </p>
      {followup.categories.length > 0 && (
        <p style={LINE_STYLE}>
          {t(lang, "C-prop-watch", {
            categories: followup.categories.map((category) => t(lang, CATEGORY_KEY[category])).join(", "),
          })}
        </p>
      )}
    </>
  );
}

function ProposalContentView({ content, lang }: { content: ProposalContent; lang: Lang }) {
  const dirKey: DictKey = content.metric.direction === "decrease" ? "C-prop-dir-decrease" : "C-prop-dir-increase";
  return (
    <>
      <h2 style={HEADING_STYLE}>{content.change_title}</h2>
      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-intervention")}:</strong>{" "}
        {lang === "en" ? content.intervention.label_en : content.intervention.label_id}
      </p>
      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-rubric")}:</strong>
      </p>
      <ul style={LIST_STYLE}>
        {content.rubric.map((criterion) => (
          <li key={criterion.id}>{lang === "en" ? criterion.label_en : criterion.label_id}</li>
        ))}
      </ul>
      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-step")}:</strong>{" "}
        {content.target_step ? content.target_step.title : t(lang, "C-prop-step-new")}
      </p>
      <p style={LINE_STYLE}>{content.change_text}</p>
      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-why")}:</strong> {content.rationale}
      </p>
      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-evidence")}:</strong>
      </p>
      <ul style={LIST_STYLE}>
        {content.evidence.map((ref, index) => (
          <li key={index}>
            {dayLabel(ref.date, lang)} {ref.start_hm} · {t(lang, CATEGORY_KEY[ref.category])} ·{" "}
            {ref.summary === null ? t(lang, "C-prop-evidence-expired") : ref.summary}
          </li>
        ))}
      </ul>
      <p style={LINE_STYLE}>
        {t(lang, "C-prop-metric", {
          category: t(lang, CATEGORY_KEY[content.metric.category]),
          direction: t(lang, dirKey),
          count: content.metric.baseline_count,
          days: content.metric.baseline_days,
        })}
      </p>
      <p style={LINE_STYLE}>{content.metric.description}</p>
      <p style={LINE_STYLE}>
        <strong>{t(lang, "C-prop-failure")}:</strong> {content.failure_condition}
      </p>
      <p style={LINE_STYLE}>{t(lang, "C-prop-review", { date: dayLabel(content.review_date, lang) })}</p>
      <p style={LINE_STYLE}>{t(lang, "C-prop-censored")}</p>
    </>
  );
}

export function ProposalCard({ proposal, lang }: { proposal: ProposalView; lang: Lang }) {
  const statusKey: DictKey =
    proposal.status === "suppressed"
      ? "C-prop-st-suppressed"
      : proposal.status === "blocked"
        ? "C-prop-st-blocked"
        : "C-prop-st-awaiting";

  return (
    <article style={CARD_STYLE}>
      <p style={STATUS_LINE_STYLE}>{t(lang, statusKey)}</p>

      {proposal.status === "suppressed" && proposal.suppression && (
        <>
          {proposal.suppression.reason === "model_declined" && proposal.suppression.model_reason !== null && (
            <p style={LINE_STYLE}>{t(lang, MODEL_DECLINE_KEY[proposal.suppression.model_reason])}</p>
          )}
          <FollowupLines followup={proposal.suppression.followup} lang={lang} />
        </>
      )}

      {proposal.status === "blocked" && (
        <p style={LINE_STYLE}>{t(lang, "C-prop-blocked", { rule: proposal.blocked_rule ?? "" })}</p>
      )}

      {proposal.status !== "suppressed" && proposal.status !== "blocked" && proposal.content && (
        <ProposalContentView content={proposal.content} lang={lang} />
      )}
    </article>
  );
}
