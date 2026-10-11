import type { AuditLog, Constraint, Outlet, Proposal, ProposalStatus, SopVersion } from "@/lib/firestore/schema";
import type { FreshThread } from "@/lib/proposals/freshness";
import type { DecisionSnapshot } from "@/lib/proposals/review-plan";
import type { ProposalLibrary } from "@/config/proposal-library";

/**
 * Review/approve service for R-09. The store interface lives here (next to its
 * consumer) the same way `ProposalStore` lives in `service.ts`.
 */

export interface ReviewThreadRow extends FreshThread {
  summary: string;
}

export interface ProposalReviewStore {
  getOutlet(): Promise<Outlet | null>;
  /** One equality query per status: where outlet_id == X, where status == s, limit LIST_READ_PER_STATUS (50).
   *  Malformed / foreign docs skipped and logged { doc_id, error_class }. Unsorted. */
  listByStatuses(statuses: readonly ProposalStatus[]): Promise<Proposal[]>;
  /** By id, fieldMask outlet_id,status,excluded_from_evidence,label_source,summary; outlet-checked; missing absent. */
  getThreads(ids: readonly string[]): Promise<Map<string, ReviewThreadRow>>;
  /** sop_versions by doc id (= sop_version_id); outlet-checked; malformed skipped. */
  getSopVersions(ids: readonly string[]): Promise<Map<string, SopVersion>>;
  /** Highest-version sop_versions id of the outlet, or null. Same query as R-08's getCurrentSop. */
  getCurrentSopVersionId(): Promise<string | null>;
  /** All constraints, oldest first, at most MAX_CONSTRAINTS (delegates to firestoreConstraintStore(...).list()). */
  listConstraints(): Promise<Constraint[]>;
  /** The DecisionSnapshot, read WITHOUT a transaction (pre-check only). */
  readDecisionSnapshot(proposalId: string): Promise<DecisionSnapshot>;
  /** One Firestore transaction: reads the DecisionSnapshot, calls decide(snap) exactly once; if it returns a
   *  write, tx.set(proposals/{id}, write.proposal) + tx.create(audit_log/<auto>, write.audit). Returns outcome. */
  transactDecision<T>(
    proposalId: string,
    decide: (snap: DecisionSnapshot) => { write: { proposal: Proposal; audit: AuditLog } | null; outcome: T },
  ): Promise<T>;
}

export interface ReviewDeps {
  /** Throws LibraryNotReadyError. */
  loadLibrary: () => ProposalLibrary;
  redact: (texts: readonly string[]) => Promise<string[]>; // redactBatch()
  newId: () => string; // passed to createConstraint
}
