import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { ConflictError } from "@/lib/http/errors";
import { firestoreConstraintStore } from "@/lib/firestore/constraint-store";
import {
  ConstraintSchema,
  ProposalSchema,
  SopVersionSchema,
  ThreadSchema,
  parseOutletDoc,
  type Proposal,
  type SopVersion,
} from "@/lib/firestore/schema";
import { MAX_CONSTRAINTS } from "@/lib/proposals/constants";
import type { FreshThread } from "@/lib/proposals/freshness";
import type { DecisionSnapshot } from "@/lib/proposals/review-plan";
import type { ProposalReviewStore, ReviewThreadRow } from "@/lib/proposals/review-service";

/**
 * Firestore-backed `ProposalReviewStore` (R-09 Task 5.2). Same "pure logic /
 * thin store" split as `proposal-store.ts`: every read is outlet-scoped;
 * malformed or foreign-outlet docs are skipped and logged
 * `{ doc_id, error_class }` only. Equality-only queries (no composite index).
 */

const LIST_READ_PER_STATUS = 50;

/**
 * Firestore ALREADY_EXISTS as the Admin SDK surfaces it: `tx.create` queues a
 * write with an `exists: false` precondition, so a duplicate id fails the
 * COMMIT (not the `tx.create` call) with gRPC status 6, which the SDK does not
 * retry. Checked as the numeric code, the lower-case gRPC name and the
 * upper-case status name.
 */
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

function logSkippedDoc(context: string, docId: string): void {
  console.error(`[proposal-review-store] skipping malformed ${context} doc`, {
    doc_id: docId,
    error_class: "ZodError",
  });
}

const REVIEW_THREAD_FIELDS = ["outlet_id", "status", "excluded_from_evidence", "label_source", "summary"] as const;
const REVIEW_THREAD_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  status: true,
  excluded_from_evidence: true,
  label_source: true,
  summary: true,
});

const FRESH_THREAD_FIELDS = ["outlet_id", "status", "excluded_from_evidence", "label_source"] as const;
const FRESH_THREAD_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  status: true,
  excluded_from_evidence: true,
  label_source: true,
});

/** Reads the same way inside and outside a transaction. */
interface SnapshotReader {
  getDoc(ref: DocumentReference): Promise<DocumentSnapshot>;
  getAll(refs: DocumentReference[], fieldMask: string[]): Promise<DocumentSnapshot[]>;
  getQuery(q: Query): Promise<QuerySnapshot>;
}

const dbReader = (db: Firestore): SnapshotReader => ({
  getDoc: (ref) => ref.get(),
  getAll: (refs, fieldMask) => db.getAll(...refs, { fieldMask }),
  getQuery: (q) => q.get(),
});

const txReader = (tx: Transaction): SnapshotReader => ({
  getDoc: (ref) => tx.get(ref),
  getAll: (refs, fieldMask) => tx.getAll(...refs, { fieldMask }),
  getQuery: (q) => tx.get(q) as Promise<QuerySnapshot>,
});

export function firestoreProposalReviewStore(outletId: string, db: Firestore = adminDb()): ProposalReviewStore {
  const proposalRef = (id: string) => db.collection(COLLECTIONS.proposals).doc(id);

  async function loadSnapshot(reader: SnapshotReader, proposalId: string): Promise<DecisionSnapshot> {
    const empty: DecisionSnapshot = {
      proposal: null,
      same_range: [],
      fresh: new Map(),
      constraint_ids: [],
      current_sop_version_id: null,
      current_sop: null,
      drafted_sop: null,
    };

    // 1. The proposal itself.
    const doc = await reader.getDoc(proposalRef(proposalId));
    if (!doc.exists) return empty;
    const parsed = ProposalSchema.safeParse(doc.data());
    if (!parsed.success) {
      logSkippedDoc("proposal", doc.id);
      return empty;
    }
    const proposal = parsed.data;
    if (proposal.outlet_id !== outletId) return empty;

    // 2. Other proposals of the identical range (the exact query R-08's findOpenProposalForRange runs).
    const sameRangeSnap = await reader.getQuery(
      db
        .collection(COLLECTIONS.proposals)
        .where("outlet_id", "==", outletId)
        .where("range.from_date", "==", proposal.range.from_date)
        .where("range.to_date", "==", proposal.range.to_date),
    );
    const same_range: Proposal[] = [];
    for (const d of sameRangeSnap.docs) {
      if (d.id === proposalId) continue;
      const r = ProposalSchema.safeParse(d.data());
      if (!r.success) {
        logSkippedDoc("proposal", d.id);
        continue;
      }
      if (r.data.outlet_id !== outletId || r.data.proposal_id === proposalId) continue;
      same_range.push(r.data);
    }

    // 3. Cited threads (freshness fields only).
    const fresh = new Map<string, FreshThread>();
    const ids = [...new Set(proposal.content?.evidence.map((e) => e.thread_id) ?? [])];
    if (ids.length > 0) {
      const col = db.collection(COLLECTIONS.threads);
      const snaps = await reader.getAll(
        ids.map((id) => col.doc(id)),
        [...FRESH_THREAD_FIELDS],
      );
      for (const s of snaps) {
        if (!s.exists) continue;
        const r = FRESH_THREAD_SHAPE.safeParse(s.data());
        if (!r.success) {
          logSkippedDoc("thread", s.id);
          continue;
        }
        if (r.data.outlet_id !== outletId) continue;
        fresh.set(s.id, {
          status: r.data.status,
          ...(r.data.excluded_from_evidence !== undefined ? { excluded_from_evidence: r.data.excluded_from_evidence } : {}),
          ...(r.data.label_source !== undefined ? { label_source: r.data.label_source } : {}),
        });
      }
    }

    // 4. Constraints (same query shape as firestoreConstraintStore).
    const constraintSnap = await reader.getQuery(
      db
        .collection(COLLECTIONS.constraints)
        .where("outlet_id", "==", outletId)
        .limit(MAX_CONSTRAINTS + 1),
    );
    const constraint_ids: string[] = [];
    for (const d of constraintSnap.docs) {
      const r = ConstraintSchema.safeParse(d.data());
      if (!r.success) {
        logSkippedDoc("constraint", d.id);
        continue;
      }
      if (r.data.outlet_id !== outletId) continue;
      constraint_ids.push(r.data.constraint_id);
    }

    // 5. Current SOP version.
    const sopSnap = await reader.getQuery(
      db.collection(COLLECTIONS.sopVersions).where("outlet_id", "==", outletId).limit(50),
    );
    let best: SopVersion | null = null;
    let drafted: SopVersion | null = null; // the version the proposal was drafted on (item 20 step-level re-base)
    for (const d of sopSnap.docs) {
      const r = SopVersionSchema.safeParse(d.data());
      if (!r.success) {
        logSkippedDoc("sop_version", d.id);
        continue;
      }
      if (r.data.outlet_id !== outletId) continue;
      if (!best || r.data.version > best.version) best = r.data;
      if (r.data.sop_version_id === proposal.generator.sop_version_id) drafted = r.data;
    }

    return {
      proposal,
      same_range,
      fresh,
      constraint_ids,
      current_sop_version_id: best?.sop_version_id ?? null,
      current_sop: best,
      drafted_sop: drafted,
    };
  }

  return {
    async getOutlet() {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? parseOutletDoc(doc.data()) : null;
    },

    async listByStatuses(statuses) {
      const snaps = await Promise.all(
        statuses.map((s) =>
          db
            .collection(COLLECTIONS.proposals)
            .where("outlet_id", "==", outletId)
            .where("status", "==", s)
            .limit(LIST_READ_PER_STATUS)
            .get(),
        ),
      );
      const out: Proposal[] = [];
      for (const snap of snaps) {
        for (const doc of snap.docs) {
          const r = ProposalSchema.safeParse(doc.data());
          if (!r.success) {
            logSkippedDoc("proposal", doc.id);
            continue;
          }
          if (r.data.outlet_id !== outletId) {
            logSkippedDoc("proposal", doc.id);
            continue;
          }
          out.push(r.data);
        }
      }
      return out;
    },

    async getThreads(ids) {
      const map = new Map<string, ReviewThreadRow>();
      if (ids.length === 0) return map;
      const col = db.collection(COLLECTIONS.threads);
      const snaps = await db.getAll(...ids.map((id) => col.doc(id)), { fieldMask: [...REVIEW_THREAD_FIELDS] });
      for (const s of snaps) {
        if (!s.exists) continue;
        const r = REVIEW_THREAD_SHAPE.safeParse(s.data());
        if (!r.success) {
          logSkippedDoc("thread", s.id);
          continue;
        }
        if (r.data.outlet_id !== outletId) continue;
        map.set(s.id, {
          status: r.data.status,
          ...(r.data.excluded_from_evidence !== undefined ? { excluded_from_evidence: r.data.excluded_from_evidence } : {}),
          ...(r.data.label_source !== undefined ? { label_source: r.data.label_source } : {}),
          summary: r.data.summary,
        });
      }
      return map;
    },

    async getSopVersions(ids) {
      const map = new Map<string, SopVersion>();
      if (ids.length === 0) return map;
      const col = db.collection(COLLECTIONS.sopVersions);
      const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
      for (const s of snaps) {
        if (!s.exists) continue;
        const r = SopVersionSchema.safeParse(s.data());
        if (!r.success) {
          logSkippedDoc("sop_version", s.id);
          continue;
        }
        if (r.data.outlet_id !== outletId) continue;
        map.set(s.id, r.data);
      }
      return map;
    },

    async getCurrentSopVersionId() {
      const snap = await db.collection(COLLECTIONS.sopVersions).where("outlet_id", "==", outletId).limit(50).get();
      let best: SopVersion | null = null;
      for (const d of snap.docs) {
        const r = SopVersionSchema.safeParse(d.data());
        if (!r.success) {
          logSkippedDoc("sop_version", d.id);
          continue;
        }
        if (r.data.outlet_id !== outletId) continue;
        if (!best || r.data.version > best.version) best = r.data;
      }
      return best?.sop_version_id ?? null;
    },

    async listConstraints() {
      return (await firestoreConstraintStore(outletId, db).list()).slice(0, MAX_CONSTRAINTS);
    },

    readDecisionSnapshot(proposalId) {
      return loadSnapshot(dbReader(db), proposalId);
    },

    async transactDecision(proposalId, decide) {
      // Set on every attempt (a retried transaction re-runs the callback); read only to classify a failure.
      let shippingSop = false;
      try {
        return await db.runTransaction(async (tx: Transaction) => {
          shippingSop = false;
          const snap = await loadSnapshot(txReader(tx), proposalId);
          const { write, outcome } = decide(snap);
          if (write) {
            if (write.proposal.proposal_id !== proposalId) throw new Error("transactDecision: id mismatch");
            if (write.sop_version && write.sop_version.outlet_id !== outletId) {
              throw new Error("transactDecision: sop outlet mismatch");
            }
            tx.set(proposalRef(proposalId), write.proposal);
            tx.create(db.collection(COLLECTIONS.auditLog).doc(), write.audit);
            if (write.sop_version) {
              shippingSop = true;
              // create, never set: sop_versions are immutable, and a second create of the same id fails the commit.
              tx.create(db.collection(COLLECTIONS.sopVersions).doc(write.sop_version.sop_version_id), write.sop_version);
            }
            if (write.sop_audit) tx.create(db.collection(COLLECTIONS.auditLog).doc(), write.sop_audit);
          }
          return outcome;
        });
      } catch (error) {
        // A lost race on the version id: the whole commit (proposal, audits, SOP doc) was rejected atomically.
        if (shippingSop && isAlreadyExists(error)) throw new ConflictError("Decision refused", "SOP_CHANGED");
        throw error;
      }
    },
  };
}
