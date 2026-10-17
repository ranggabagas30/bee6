import { addDays, businessDateOf } from "@/lib/capture/calendar";
import { HOME_WAITING_MAX, type HomeR19Extension, type Tally } from "@/lib/contracts/r19";
import type { ProposalStatus } from "@/lib/firestore/schema";

/**
 * R-19 PR-8 (plan 9.2, W6): the owner Home's progress tallies, "waiting for your approval" list and next review date.
 * Plain code, no model call. Windows are business dates (`businessDateOf`, before 01:00 = the previous day) of the
 * owner's decision in the outlet's zone: week = [today-6, today], month = [today-29, today], since start = all.
 *
 * Hard rule #7: every row here carries counts, a proposal id and the stored (already redacted) change title only; the
 * decision slots are roles, never people.
 */

/**
 * The few proposal fields the Home reads (the store field-masks to exactly these, so no rejection reason, no
 * constraint id and no evidence ever enters this code path).
 */
export interface HomeProposalRow {
  proposal_id: string;
  status: ProposalStatus;
  /** `supervisor_review.decision`; null when the supervisor has not reviewed. */
  supervisor_decision: "feasible" | "rejected" | null;
  /** `owner_decision.{decision, decided_at_ms}`; null when the owner has not decided. */
  owner_decision: { decision: "approved" | "rejected"; decided_at_ms: number } | null;
  /** `content.change_title`; null on a contentless doc. */
  change_title: string | null;
  /** When the proposal was created; the Home's waiting list orders by it, like the approvals queue. */
  created_at_ms: number;
  updated_at_ms: number;
}

/** The two fields of an `sop_versions` doc the Home reads: both null on the seed. */
export interface HomeSopVersionRow {
  review_date: string | null;
  change_title: string | null;
}

export const WEEK_DAYS = 7;
export const MONTH_DAYS = 30;

function emptyTally(): Tally {
  return { approved: 0, rejected: 0 };
}

/** Feasible-and-decided proposals, bucketed by the business date of the owner's decision. */
export function progressTallies(rows: readonly HomeProposalRow[], today: string, tz: string): HomeR19Extension["progress"] {
  const weekFrom = addDays(today, -(WEEK_DAYS - 1));
  const monthFrom = addDays(today, -(MONTH_DAYS - 1));
  const week = emptyTally();
  const month = emptyTally();
  const since_start = emptyTally();

  for (const row of rows) {
    if (row.supervisor_decision !== "feasible") continue;
    const od = row.owner_decision;
    if (od === null) continue;
    const key = od.decision; // "approved" | "rejected"
    const date = businessDateOf(od.decided_at_ms, tz);
    since_start[key] += 1;
    if (date <= today) {
      if (date >= monthFrom) month[key] += 1;
      if (date >= weekFrom) week[key] += 1;
    }
  }
  return { week, month, since_start };
}

/**
 * Proposals the supervisor handed over (`awaiting_owner`): total count, and the first 5 titles in the approvals-queue
 * order (oldest `created_at_ms` first, ties by `proposal_id`), so the first row is the one "Review in order" opens.
 */
export function waitingApproval(rows: readonly HomeProposalRow[]): HomeR19Extension["waiting_approval"] {
  const open = rows
    .filter((r): r is HomeProposalRow & { change_title: string } => r.status === "awaiting_owner" && r.change_title !== null)
    .sort((a, b) => a.created_at_ms - b.created_at_ms || a.proposal_id.localeCompare(b.proposal_id));
  return {
    count: open.length,
    items: open.slice(0, HOME_WAITING_MAX).map((r) => ({ proposal_id: r.proposal_id, change_title: r.change_title })),
  };
}

/** The smallest `change.review_date >= today` across the outlet's SOP versions, with that change's title. */
export function nextReview(rows: readonly HomeSopVersionRow[], today: string): HomeR19Extension["next_review"] {
  let best: { date: string; change_title: string } | null = null;
  for (const row of rows) {
    if (row.review_date === null || row.change_title === null) continue;
    if (row.review_date < today) continue;
    if (best === null || row.review_date < best.date) best = { date: row.review_date, change_title: row.change_title };
  }
  return best ?? { date: null, change_title: null };
}
