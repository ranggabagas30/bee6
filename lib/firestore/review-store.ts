import type { Firestore, Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreConstraintStore } from "@/lib/firestore/constraint-store";
import { firestoreSopStore } from "@/lib/firestore/sop-store";
import {
  CaptureSessionSchema,
  ProposalSchema,
  ReviewSchema,
  ThreadSchema,
  parseOutletDoc,
  type Outlet,
} from "@/lib/firestore/schema";
import type { AttributionSession } from "@/lib/day/attribution";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";
import { MAX_THREADS_READ } from "@/lib/proposals/constants";
import { OUTLETS_READ_MAX, REVIEWS_READ_MAX, SESSIONS_IN_CHUNK } from "@/lib/reviews/constants";
import type { ReviewStore } from "@/lib/reviews/service";

/**
 * Firestore-backed `ReviewStore` (R-11 Task 4.2). Same "pure logic / thin
 * store" split as `proposal-store.ts`: every read is outlet-scoped; malformed
 * or foreign-outlet docs are skipped and logged `{ doc_id, error_class }`
 * only. The only collections ever written are `reviews`, `outcomes` and
 * `audit_log` (hard rule #9: no SOP or proposal write from here).
 */

function logSkippedDoc(context: string, docId: string): void {
  console.error(`[review-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

/** Firestore ALREADY_EXISTS as the Admin SDK surfaces it on a failed commit (see proposal-review-store.ts). */
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

// Same field-masked thread read as proposal-store.ts: never line text.
const THREAD_FIELDS = [
  "outlet_id",
  "thread_id",
  "device_id",
  "category",
  "confirmed_category",
  "status",
  "excluded_from_evidence",
  "label_source",
  "first_line_start_ms",
  "summary",
  "fields",
] as const;
const THREAD_ROW_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  thread_id: true,
  device_id: true,
  category: true,
  confirmed_category: true,
  status: true,
  excluded_from_evidence: true,
  label_source: true,
  first_line_start_ms: true,
  summary: true,
  fields: true,
});

/**
 * All outlets of this project (the daily run reviews each, isolated). Malformed docs skipped and
 * logged. Reads one past the cap so truncation is detected: the first OUTLETS_READ_MAX are returned
 * and `truncated` is set (and logged), so the run can count it as an error instead of silently
 * never reviewing the rest.
 *
 * R-12: demo sandbox outlets (an outlet doc with a `sandbox` object) are skipped here; the shared
 * `demo-outlet` and the pilot outlet have no `sandbox` and are kept. The cap counts raw docs.
 */
export async function listAllOutlets(db: Firestore = adminDb()): Promise<{ outlets: Outlet[]; truncated: boolean }> {
  const snap = await db.collection(COLLECTIONS.outlets).limit(OUTLETS_READ_MAX + 1).get();
  const truncated = snap.docs.length > OUTLETS_READ_MAX;
  if (truncated) console.error("[review] outlets truncated", { error_class: "outlets_truncated" });
  const outlets: Outlet[] = [];
  for (const doc of snap.docs.slice(0, OUTLETS_READ_MAX)) {
    try {
      const outlet = parseOutletDoc(doc.data());
      if (outlet.sandbox === undefined) outlets.push(outlet);
    } catch {
      logSkippedDoc("outlet", doc.id);
    }
  }
  return { outlets, truncated };
}

export function firestoreReviewStore(outletId: string, db: Firestore = adminDb()): ReviewStore {
  const reviewRef = (id: string) => db.collection(COLLECTIONS.reviews).doc(id);

  function parseReview(id: string, raw: unknown) {
    const result = ReviewSchema.safeParse(raw);
    if (!result.success) {
      logSkippedDoc("review", id);
      return null;
    }
    return result.data.outlet_id === outletId ? result.data : null;
  }

  return {
    async getOutlet() {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? parseOutletDoc(doc.data()) : null;
    },

    async listVersions() {
      return firestoreSopStore(outletId, db).listVersions();
    },

    async getProposal(id) {
      const doc = await db.collection(COLLECTIONS.proposals).doc(id).get();
      if (!doc.exists) return null;
      const result = ProposalSchema.safeParse(doc.data());
      if (!result.success) {
        logSkippedDoc("proposal", id);
        return null;
      }
      return result.data.outlet_id === outletId ? result.data : null;
    },

    async listSessions(dates) {
      const out: AttributionSession[] = [];
      for (let i = 0; i < dates.length; i += SESSIONS_IN_CHUNK) {
        const chunk = dates.slice(i, i + SESSIONS_IN_CHUNK);
        const snap = await db
          .collection(COLLECTIONS.captureSessions)
          .where("outlet_id", "==", outletId)
          .where("local_date", "in", chunk)
          .get();
        for (const doc of snap.docs) {
          const result = CaptureSessionSchema.safeParse(doc.data());
          if (!result.success) {
            logSkippedDoc("capture_session", doc.id);
            continue;
          }
          if (result.data.outlet_id !== outletId) continue;
          out.push(result.data);
        }
      }
      return out;
    },

    async listThreadsInRange(fromMs, toMs) {
      const snap = await db
        .collection(COLLECTIONS.threads)
        .where("outlet_id", "==", outletId)
        .where("first_line_start_ms", ">=", fromMs)
        .where("first_line_start_ms", "<", toMs)
        .orderBy("first_line_start_ms")
        .limit(MAX_THREADS_READ + 1)
        .select(...THREAD_FIELDS)
        .get();
      const rows: ProposalThreadRow[] = [];
      for (const doc of snap.docs) {
        const result = THREAD_ROW_SHAPE.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc("thread", doc.id);
          continue;
        }
        if (result.data.outlet_id !== outletId) continue;
        rows.push(result.data as ProposalThreadRow);
      }
      const truncated = snap.docs.length > MAX_THREADS_READ;
      if (truncated) console.error("[review-store] threads truncated", { outlet_id: outletId, error_class: "threads_truncated" });
      return { rows: truncated ? rows.slice(0, MAX_THREADS_READ) : rows, truncated };
    },

    async listReviews() {
      const snap = await db.collection(COLLECTIONS.reviews).where("outlet_id", "==", outletId).limit(REVIEWS_READ_MAX).get();
      const out = [];
      for (const doc of snap.docs) {
        const review = parseReview(doc.id, doc.data());
        if (review) out.push(review);
      }
      return out;
    },

    async getReview(id) {
      const doc = await reviewRef(id).get();
      return doc.exists ? parseReview(id, doc.data()) : null;
    },

    async listStaffScrubNames() {
      return firestoreConstraintStore(outletId, db).listStaffScrubNames();
    },

    async createReview(review, audit) {
      if (review.outlet_id !== outletId || audit.outlet_id !== outletId) throw new Error("createReview: outlet mismatch");
      try {
        return await db.runTransaction(async (tx: Transaction) => {
          const ref = reviewRef(review.review_id);
          if ((await tx.get(ref)).exists) return "exists" as const;
          tx.create(ref, review);
          tx.create(db.collection(COLLECTIONS.auditLog).doc(), audit);
          return "created" as const;
        });
      } catch (error) {
        // A concurrent create that lost the race fails the commit, not the tx.create call.
        if (isAlreadyExists(error)) return "exists";
        throw error;
      }
    },

    async transactReview(reviewId, decide) {
      return db.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(reviewRef(reviewId));
        const current = snap.exists ? parseReview(reviewId, snap.data()) : null;
        const { write, outcome } = decide(current);
        if (write) {
          if (write.review.review_id !== reviewId) throw new Error("transactReview: id mismatch");
          if (write.review.outlet_id !== outletId || write.audit.outlet_id !== outletId) throw new Error("transactReview: outlet mismatch");
          if (write.outcome && (write.outcome.outcome_id !== reviewId || write.outcome.outlet_id !== outletId)) {
            throw new Error("transactReview: outcome mismatch");
          }
          tx.set(reviewRef(reviewId), write.review);
          if (write.outcome) tx.create(db.collection(COLLECTIONS.outcomes).doc(write.outcome.outcome_id), write.outcome);
          tx.create(db.collection(COLLECTIONS.auditLog).doc(), write.audit);
        }
        return outcome;
      });
    },
  };
}
