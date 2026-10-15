import { useId } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { ProposalView } from "@/lib/proposals/contract";
import type { ProposalListItem } from "@/lib/proposals/review-contract";
import type { SopChangeView } from "@/lib/sop/contract";
import { Card, Chip, Glass, Kicker, Pill } from "@/app/ui";
import styles from "@/app/proposals/approvals.module.css";

/**
 * One proposal as the owner reads it (R-19 PR-12b, plan 9.5; page-1 W8 card; board D2-08): the step chip and status
 * pill, the change title, three tiles — **Why** (the rationale), **Extra work for staff** (the new wording, with the
 * step's old wording struck through above it, as PR-12a's detail), **Cost** ("Not estimated yet · coming soon":
 * there is no cost field and none is ever invented) — the evidence (date · time — the dated summary from the view,
 * never a quoted line), the metric to watch, and "Starts … · review …". The start date is the shipped SOP change's
 * `effective_from_date` once the proposal is approved (R-10 writes it at approval, the day after); before that the
 * line says "the day after approval" rather than guessing a date. The review date is the view's `review_date`
 * (plain code, 7-28 days) — never a hard-coded "five days".
 *
 * Read-only: the actions live in `ApprovalDecision`. Nothing here is a name or a device id (hard rule #7).
 */

export const OWNER_STATUS_KEY: Record<ProposalView["status"], DictKey> = {
  suppressed: "C-prop-st-suppressed",
  blocked: "C-prop-st-blocked",
  awaiting_supervisor: "C-prop-st-awaiting",
  awaiting_owner: "C-propa-st-waiting",
  approved: "C-prop-st-approved",
  rejected: "C-prop-st-rejected",
};

export const OWNER_STATUS_TONE: Record<ProposalView["status"], "neutral" | "amber" | "green" | "red" | "teal"> = {
  suppressed: "neutral",
  blocked: "neutral",
  awaiting_supervisor: "neutral",
  awaiting_owner: "amber",
  approved: "green",
  rejected: "red",
};

/** "Starts {date} · review {date}" from the shipped change when there is one, else "Starts the day after approval · review {view date}". */
export function datesLine(lang: Lang, content: NonNullable<ProposalView["content"]>, shipped: SopChangeView | null): string {
  const starts = shipped ? t(lang, "C-propa-starts", { date: dayLabel(shipped.effective_from_date, lang) }) : t(lang, "C-propa-starts-after");
  const review = dayLabel(shipped ? shipped.review_date : content.review_date, lang);
  return t(lang, "C-propa-dates", { starts, review });
}

export interface ApprovalCardProps {
  lang: Lang;
  item: ProposalListItem;
  /** The SOP change this proposal shipped as, once approved and loaded; null otherwise. */
  shipped: SopChangeView | null;
}

export function ApprovalCard({ lang, item, shipped }: ApprovalCardProps) {
  const ids = useId();
  const { proposal, review } = item;
  const content = proposal.content;
  if (!content) return null; // the queue never holds a suppressed/blocked proposal
  const days = new Set(content.evidence.map((e) => e.date)).size;
  const titleId = `${ids}-title`;

  return (
    <Card as="section" aria-labelledby={titleId} className={styles.card}>
      <div className={styles.chips}>
        <Chip>{content.target_step ? content.target_step.title : t(lang, "C-propd-step-new")}</Chip>
        <Pill tone={OWNER_STATUS_TONE[proposal.status]}>{t(lang, OWNER_STATUS_KEY[proposal.status])}</Pill>
      </div>
      <h2 id={titleId} className={styles.cardTitle}>
        {content.change_title}
      </h2>

      <div className={styles.tiles}>
        <Glass className={styles.tile}>
          <Kicker>{t(lang, "C-propa-why")}</Kicker>
          <p className={styles.tileText}>{content.rationale}</p>
        </Glass>
        <Glass className={styles.tile}>
          <Kicker>{t(lang, "C-propa-extra")}</Kicker>
          {content.target_step?.text && (
            <p className={styles.tileText} style={{ margin: 0 }}>
              <span className="b6-sr-only">{t(lang, "C-propd-before")} </span>
              <del className={styles.before}>{content.target_step.text}</del>
            </p>
          )}
          <p className={styles.tileText}>
            {content.target_step?.text && <span className="b6-sr-only">{t(lang, "C-propd-after")} </span>}
            {content.change_text}
          </p>
        </Glass>
        <Glass className={styles.tile}>
          <Kicker>{t(lang, "C-propa-cost")}</Kicker>
          <span className={styles.tileValue}>{t(lang, "C-propa-cost-value")}</span>
          <span className={styles.tileDetail}>{t(lang, "C-propa-cost-soon")}</span>
        </Glass>
      </div>

      <section aria-labelledby={`${ids}-evidence`} className={styles.block}>
        <Kicker id={`${ids}-evidence`}>{t(lang, "C-propd-evidence", { n: content.evidence.length, days })}</Kicker>
        <ul className={styles.evidence}>
          {content.evidence.map((ref, index) => (
            <li key={index}>
              <span className={styles.evidenceWhen}>
                {dayLabel(ref.date, lang)} · {ref.start_hm}
              </span>
              {" — "}
              {ref.summary === null ? t(lang, "C-prop-evidence-expired") : ref.summary}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${ids}-metric`} className={styles.block}>
        <Kicker id={`${ids}-metric`}>{t(lang, "C-propd-metric")}</Kicker>
        <p className={styles.tileText}>{content.metric.description}</p>
      </section>

      <p className={styles.dates}>{datesLine(lang, content, shipped)}</p>
      {shipped && <p className={styles.decided}>{t(lang, "C-propa-shipped", { version: shipped.version })}</p>}
      {review.owner && <p className={styles.decided}>{t(lang, "C-propa-decided-on", { date: dayLabel(review.owner.decided_date, lang) })}</p>}
    </Card>
  );
}
