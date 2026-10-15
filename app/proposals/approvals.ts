import type { ListProposalsResponse, ProposalListItem } from "@/lib/proposals/review-contract";
import type { SopChangeView, SopOverview } from "@/lib/sop/contract";

/**
 * Pure helpers for the owner's Approvals screen (R-19 PR-12b, plan 9.5; page-1 W8 "Review in order"). No I/O.
 *
 * The owner's queue is every proposal the supervisor handed over: the ones waiting for the owner plus the ones the
 * owner already decided, in the recommended order = oldest `created_at_ms` first. Proposals still with the
 * supervisor, ones the supervisor rejected, and suppressed/blocked ones (no content) are not the owner's to decide,
 * so they never appear (W6: owner progress counts owner decisions only).
 */

export function isOwnerDecided(item: ProposalListItem): boolean {
  return item.review.owner !== null;
}

export function approvalsQueue(data: Pick<ListProposalsResponse, "open" | "decided">): ProposalListItem[] {
  return [...data.open, ...data.decided]
    .filter((i) => i.proposal.content !== null && (i.proposal.status === "awaiting_owner" || isOwnerDecided(i)))
    .sort((a, b) => a.proposal.created_at_ms - b.proposal.created_at_ms || a.proposal.proposal_id.localeCompare(b.proposal.proposal_id));
}

/** The oldest proposal still waiting for the owner; null once every one is decided (or the queue is empty). */
export function firstUndecided(queue: readonly ProposalListItem[]): ProposalListItem | null {
  return queue.find((i) => !isOwnerDecided(i)) ?? null;
}

/**
 * The SOP change an approved proposal shipped as (R-10 writes one change per approval). The SOP overview carries no
 * proposal id (nothing may leak), so the match is the change title plus the approval date; null when the proposal is
 * not approved, the overview has not loaded, or no change matches.
 */
export function shippedChangeFor(item: ProposalListItem, sop: SopOverview | null): SopChangeView | null {
  const owner = item.review.owner;
  const content = item.proposal.content;
  if (!sop || !owner || !content || item.proposal.status !== "approved" || owner.decision !== "approved") return null;
  return sop.changes.find((c) => c.change_title === content.change_title && c.approved_date === owner.decided_date) ?? null;
}
