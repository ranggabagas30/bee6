import type { CSSProperties, ReactNode } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import type { MODEL_DECLINE_REASONS } from "@/lib/firestore/schema";
import type { ProposalView } from "@/lib/proposals/contract";
import type { Notices, ReviewView } from "@/lib/proposals/review-contract";

/**
 * The generate result card (R-08 Task 7.4). Every status branch the route
 * can return (`suppressed`/`insufficient_evidence`, `suppressed`/
 * `model_declined`, `blocked`, `awaiting_supervisor`) is rendered here; no
 * other role variant exists (owner and supervisor see the identical card —
 * v2, Q-10 — the evidence shown is already the dated summary, never a
 * quoted line, so no owner-specific redaction is needed).
 *
 * Content-bearing statuses are detected by `content !== null`, never by an
 * exhaustive switch on `status` (review focus #9). R-09 adds three things
 * on top, all optional so the generate result card renders as before: the
 * status line now names all six statuses, `review` adds the supervisor/owner
 * decision lines, `notices` adds the late-constraint / stale / SOP-changed /
 * superseded notices, and `children` is the slot for the decision panel.
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
const REASON_STYLE: CSSProperties = { display: "block", overflowWrap: "anywhere" };

const STATUS_KEY: Record<ProposalView["status"], DictKey> = {
  suppressed: "C-prop-st-suppressed",
  blocked: "C-prop-st-blocked",
  awaiting_supervisor: "C-prop-st-awaiting",
  awaiting_owner: "C-prop-st-awaiting-owner",
  approved: "C-prop-st-approved",
  rejected: "C-prop-st-rejected",
};

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

function ProposalContentView({
  content,
  lang,
  titleLevel,
}: {
  content: ProposalContent;
  lang: Lang;
  titleLevel: 2 | 3;
}) {
  const Title = titleLevel === 3 ? "h3" : "h2";
  const dirKey: DictKey = content.metric.direction === "decrease" ? "C-prop-dir-decrease" : "C-prop-dir-increase";
  return (
    <>
      <Title style={HEADING_STYLE}>{content.change_title}</Title>
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
      <p style={LINE_STYLE}>{t(lang, "C-prop-review-draft", { date: dayLabel(content.review_date, lang) })}</p>
      <p style={LINE_STYLE}>{t(lang, "C-prop-censored")}</p>
    </>
  );
}

function ReviewLines({ review, lang }: { review: ReviewView; lang: Lang }) {
  const { supervisor, owner } = review;
  return (
    <>
      {supervisor?.decision === "feasible" && (
        <p style={LINE_STYLE}>{t(lang, "C-prop-rev-feasible", { date: dayLabel(supervisor.decided_date, lang) })}</p>
      )}
      {supervisor?.decision === "rejected" && (
        <p style={LINE_STYLE}>
          {t(lang, "C-prop-rev-sup-rejected", { date: dayLabel(supervisor.decided_date, lang) })}
          {supervisor.reason !== null && <span style={REASON_STYLE}>{supervisor.reason}</span>}
        </p>
      )}
      {owner?.decision === "approved" && (
        <p style={LINE_STYLE}>{t(lang, "C-prop-rev-approved", { date: dayLabel(owner.decided_date, lang) })}</p>
      )}
      {owner?.decision === "rejected" && (
        <p style={LINE_STYLE}>
          {t(lang, "C-prop-rev-owner-rejected", { date: dayLabel(owner.decided_date, lang) })}
          {owner.reason !== null && <span style={REASON_STYLE}>{owner.reason}</span>}
        </p>
      )}
    </>
  );
}

/** DOM id of a notice that disables the decision panel's positive button, so the button can name it via aria-describedby. */
export function noticeDomId(proposalId: string, kind: "stale" | "sop"): string {
  return `prop-${proposalId}-notice-${kind}`;
}

function NoticeLines({ proposalId, notices, lang }: { proposalId: string; notices: Notices; lang: Lang }) {
  return (
    <>
      {notices.superseded && <p style={LINE_STYLE}>{t(lang, "C-prop-notice-superseded")}</p>}
      {notices.evidence_stale && (
        <p id={noticeDomId(proposalId, "stale")} style={LINE_STYLE}>
          {t(lang, "C-prop-notice-stale")}
        </p>
      )}
      {notices.sop_changed && (
        <p id={noticeDomId(proposalId, "sop")} style={LINE_STYLE}>
          {t(lang, "C-prop-notice-sop")}
        </p>
      )}
      {notices.late_constraints.length > 0 && (
        <>
          <p style={LINE_STYLE}>{t(lang, "C-prop-notice-late")}</p>
          <ul style={LIST_STYLE}>
            {notices.late_constraints.map((c) => (
              <li key={c.constraint_id}>{c.text}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function ProposalCard({
  proposal,
  lang,
  review,
  notices,
  titleLevel = 2,
  children,
}: {
  proposal: ProposalView;
  lang: Lang;
  /** Heading level of the change title: 2 on its own (generate result), 3 inside a list section that has its own h2. */
  titleLevel?: 2 | 3;
  review?: ReviewView;
  notices?: Notices;
  children?: ReactNode;
}) {
  return (
    <article style={CARD_STYLE}>
      <p style={STATUS_LINE_STYLE}>{t(lang, STATUS_KEY[proposal.status])}</p>

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
        <ProposalContentView content={proposal.content} lang={lang} titleLevel={titleLevel} />
      )}

      {review && <ReviewLines review={review} lang={lang} />}
      {notices && <NoticeLines proposalId={proposal.proposal_id} notices={notices} lang={lang} />}
      {children}
    </article>
  );
}
