import { useId } from "react";
import type { Lang } from "@/lib/i18n/lang";
import { t, type DictKey } from "@/lib/i18n/dict";
import { dayLabel } from "@/lib/i18n/format";
import type { ProposalView } from "@/lib/proposals/contract";
import type { ProposalListItem } from "@/lib/proposals/review-contract";
import type { SopChangeView } from "@/lib/sop/contract";
import { Card, Chip, Kicker, Pill, Tile } from "@/app/ui";
import { CheckedByBee6 } from "@/app/proposals/CheckedByBee6";
import styles from "@/app/proposals/approvals.module.css";

/**
 * One proposal as the owner reads it (R-19 PR-12b, plan 9.5; R-25 T11 page-2 look, board D2-08): the step chip and the
 * meta line, the change title (the page's `h1`), three glass tiles — **Why** (the rationale), **Extra work for staff** (the new wording, with the
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
  /** The proposal's place in the recommended order (1-based): the "#1 · supervisor: feasible …" meta line. */
  position?: number;
  /** Another proposal is still waiting for the owner: the pace box adds "each approved change becomes its own SOP version". */
  othersWaiting?: boolean;
}

/** The proposal, left column of the page (board D2-08). Its title is the page's one `h1`. */
export function ApprovalCard({ lang, item, shipped, position, othersWaiting = false }: ApprovalCardProps) {
  const ids = useId();
  const { proposal, review, notices } = item;
  const content = proposal.content;
  if (!content) return null; // the queue never holds a suppressed/blocked proposal
  const days = new Set(content.evidence.map((e) => e.date)).size;
  const titleId = `${ids}-title`;
  const decided = review.owner !== null;
  const blocked = notices.sop_changed && !decided;
  const supervisorDate = review.supervisor?.decided_date ?? null;

  return (
    <section aria-labelledby={titleId} className={styles.card}>
      <div className={styles.head}>
        <div className={styles.chips}>
          <Chip>{content.target_step ? content.target_step.title : t(lang, "C-propd-step-new")}</Chip>
          {position !== undefined && supervisorDate !== null && (
            <span className={styles.meta}>{t(lang, "C-propa-meta", { n: position, date: dayLabel(supervisorDate, lang) })}</span>
          )}
          {decided && <Pill tone={OWNER_STATUS_TONE[proposal.status]}>{t(lang, OWNER_STATUS_KEY[proposal.status])}</Pill>}
        </div>
        <h1 id={titleId} className={`b6-h1-web ${styles.title}`}>
          {content.change_title}
        </h1>
      </div>

      <div className={styles.tiles}>
        <Tile surface="glass" className={styles.tile} label={t(lang, "C-propa-why")} value={<span className={styles.tileLine}>{content.rationale}</span>} />
        <Tile
          surface="glass"
          className={styles.tile}
          label={t(lang, "C-propa-cost")}
          value={<span className={styles.tileLine}>{t(lang, "C-propa-cost-value")}</span>}
          detail={t(lang, "C-propa-cost-soon")}
        />
        <Tile
          surface="glass"
          className={styles.tile}
          label={t(lang, "C-propa-extra")}
          value={
            <>
              {content.target_step?.text && (
                <span className={styles.tileLine}>
                  <span className="b6-sr-only">{t(lang, "C-propd-before")} </span>
                  <del className={styles.before}>{content.target_step.text}</del>
                </span>
              )}
              <span className={styles.tileLine}>
                {content.target_step?.text && <span className="b6-sr-only">{t(lang, "C-propd-after")} </span>}
                {content.change_text}
              </span>
            </>
          }
        />
      </div>

      <section aria-labelledby={`${ids}-evidence`} className={styles.block}>
        <h2 id={`${ids}-evidence`} className={styles.blockTitle}>
          {t(lang, "C-propa-evidence-h")}
        </h2>
        <Card className={styles.evidenceCard}>
          <ul className={styles.evidence}>
            {content.evidence.map((ref, index) => (
              <li key={index} className={styles.evidenceRow}>
                <span className={styles.evidenceWhen}>
                  {dayLabel(ref.date, lang)} · {ref.start_hm}
                </span>
                <span className={styles.evidenceText}>{ref.summary === null ? t(lang, "C-prop-evidence-expired") : ref.summary}</span>
              </li>
            ))}
          </ul>
        </Card>
        <span className={styles.evidenceCount}>{t(lang, "C-propd-evidence", { n: content.evidence.length, days })}</span>
        <p className={styles.metric}>
          <Kicker>{t(lang, "C-propd-metric")}</Kicker> <span>{content.metric.description}</span>
        </p>
      </section>

      <CheckedByBee6 lang={lang} checked={proposal.checked} variant="short" />

      <div className={blocked ? `${styles.pace} ${styles.paceBlocked}` : styles.pace}>
        <span className={styles.paceIcon} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="5" width="16" height="15" rx="3" />
            <path d="M4 10h16M9 3v4M15 3v4" />
          </svg>
        </span>
        <div className={styles.paceBody}>
          <p className={styles.paceLead}>{blocked ? t(lang, "C-propa-na-h") : datesLine(lang, content, shipped)}</p>
          {blocked ? (
            <p className={styles.paceWhy}>{t(lang, "C-propa-na-why")}</p>
          ) : !decided ? (
            <p className={styles.paceWhy}>
              {t(lang, "C-propa-pace-why")}
              {othersWaiting ? ` ${t(lang, "C-propa-pace-one")}` : ""}
            </p>
          ) : null}
          {shipped && <p className={styles.paceWhy}>{t(lang, "C-propa-shipped", { version: shipped.version })}</p>}
          {review.owner && <p className={styles.paceWhy}>{t(lang, "C-propa-decided-on", { date: dayLabel(review.owner.decided_date, lang) })}</p>}
        </div>
      </div>
    </section>
  );
}
