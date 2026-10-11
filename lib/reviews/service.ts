import type { AttributionSession } from "@/lib/day/attribution";
import type { AuditLog, Outcome, Outlet, Proposal, Review, SopVersion } from "@/lib/firestore/schema";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";

/**
 * Review service (R-11 Task 4): the daily run, the verdict transactions, the
 * list and the demo fast-forward. The store interface lives here, next to its
 * consumer (same convention as `lib/proposals/review-service.ts`).
 */

export interface ReviewStore {
  getOutlet(): Promise<Outlet | null>;
  /** Delegates to firestoreSopStore(outletId, db).listVersions(). */
  listVersions(): Promise<SopVersion[]>;
  /** By id; outlet-checked; missing, foreign or malformed -> null (logged). */
  getProposal(id: string): Promise<Proposal | null>;
  /** Chunked "in" queries (SESSIONS_IN_CHUNK); outlet-scoped. */
  listSessions(dates: readonly string[]): Promise<AttributionSession[]>;
  listThreadsInRange(fromMs: number, toMs: number): Promise<{ rows: ProposalThreadRow[]; truncated: boolean }>;
  /** where outlet_id == X, limit REVIEWS_READ_MAX; malformed skipped. */
  listReviews(): Promise<Review[]>;
  /** By id, no transaction; malformed or foreign -> null (logged). */
  getReview(id: string): Promise<Review | null>;
  listStaffScrubNames(): Promise<string[]>;
  /** tx.create(reviews/{id}) + tx.create(audit). "exists" if the doc already exists (no throw). */
  createReview(review: Review, audit: AuditLog): Promise<"created" | "exists">;
  /** One transaction: read reviews/{id}, call decide(review|null) once; if it returns a write:
   *  tx.set(review), tx.create(outcome) if any, tx.create(audit). */
  transactReview<T>(
    reviewId: string,
    decide: (r: Review | null) => { write: { review: Review; outcome: Outcome | null; audit: AuditLog } | null; outcome: T },
  ): Promise<T>;
}

export interface ReviewDeps {
  redact: (texts: readonly string[]) => Promise<string[]>; // redactBatch()
}
