import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreConstraintStore } from "@/lib/firestore/constraint-store";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import {
  CaptureSessionSchema,
  ProposalLockSchema,
  ProposalSchema,
  SopVersionSchema,
  ThreadSchema,
  parseOutletDoc,
  type Proposal,
  type SopVersion,
} from "@/lib/firestore/schema";
import type { AttributionSession } from "@/lib/day/attribution";
import { MAX_CONSTRAINTS, MAX_THREADS_READ } from "@/lib/proposals/constants";
import type { FreshThread, ProposalStore } from "@/lib/proposals/service";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";

/**
 * Firestore-backed `ProposalStore` (R-08 Task 5.3). Same "pure logic / thin
 * store" split as `lib/firestore/day-store.ts` and `tick-store.ts` — every
 * read is outlet-scoped; malformed or foreign-outlet docs are skipped and
 * logged `{ doc_id, error_class }` only (never the raw doc or zod error).
 */

/** Logs only `{doc_id, error_class}` — same discipline as day-store.ts / tick-store.ts. */
function logSkippedDoc(context: string, docId: string): void {
  console.error(`[proposal-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

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

const FRESH_THREAD_FIELDS = ["outlet_id", "status", "excluded_from_evidence", "label_source"] as const;
const FRESH_THREAD_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  status: true,
  excluded_from_evidence: true,
  label_source: true,
});

const GET_THREADS_FIELDS = [
  "outlet_id",
  "status",
  "excluded_from_evidence",
  "label_source",
  "summary",
  "first_line_start_ms",
] as const;
const GET_THREADS_SHAPE = ThreadSchema.pick({
  outlet_id: true,
  status: true,
  excluded_from_evidence: true,
  label_source: true,
  summary: true,
  first_line_start_ms: true,
});

const PROPOSAL_LOCK_COLLECTION = COLLECTIONS.proposalLocks;

export function firestoreProposalStore(outletId: string, db: Firestore = adminDb()): ProposalStore {
  return {
    async getOutlet() {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? parseOutletDoc(doc.data()) : null;
    },

    async listSessions(dates) {
      if (dates.length === 0) return [];
      const snap = await db
        .collection(COLLECTIONS.captureSessions)
        .where("outlet_id", "==", outletId)
        .where("local_date", "in", [...dates])
        .get();
      const out: AttributionSession[] = [];
      for (const doc of snap.docs) {
        const result = CaptureSessionSchema.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc("capture_session", doc.id);
          continue;
        }
        out.push(result.data);
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

      const out: ProposalThreadRow[] = [];
      for (const doc of snap.docs) {
        const result = THREAD_ROW_SHAPE.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc("thread", doc.id);
          continue;
        }
        out.push(result.data as ProposalThreadRow);
      }
      if (out.length > MAX_THREADS_READ) {
        console.error("[proposal-store] threads truncated", { outlet_id: outletId, error_class: "threads_truncated" });
        return out.slice(0, MAX_THREADS_READ);
      }
      return out;
    },

    async getCurrentSop() {
      const snap = await db.collection(COLLECTIONS.sopVersions).where("outlet_id", "==", outletId).limit(50).get();
      let best: SopVersion | null = null;
      for (const doc of snap.docs) {
        const result = SopVersionSchema.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc("sop_version", doc.id);
          continue;
        }
        if (!best || result.data.version > best.version) best = result.data;
      }
      return best;
    },

    // One implementation of the constraints query (R-08 Task 8.4).
    // Caps the result to MAX_CONSTRAINTS (200), as per the ProposalStore contract.
    async listConstraints() {
      return (await firestoreConstraintStore(outletId, db).list()).slice(0, MAX_CONSTRAINTS);
    },

    async findOpenProposalForRange(from, to) {
      const snap = await db
        .collection(COLLECTIONS.proposals)
        .where("outlet_id", "==", outletId)
        .where("range.from_date", "==", from)
        .where("range.to_date", "==", to)
        .get();
      let newest: Proposal | null = null;
      for (const doc of snap.docs) {
        const result = ProposalSchema.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc("proposal", doc.id);
          continue;
        }
        if (result.data.status !== "awaiting_supervisor" && result.data.status !== "awaiting_owner") continue;
        if (!newest || result.data.created_at_ms > newest.created_at_ms) newest = result.data;
      }
      return newest;
    },

    async getThreads(ids) {
      const map = new Map<
        string,
        { status: "fact" | "open" | "unverified"; excluded_from_evidence?: boolean; label_source?: string; summary: string; first_line_start_ms: number }
      >();
      if (ids.length === 0) return map;
      const col = db.collection(COLLECTIONS.threads);
      const refs = ids.map((id) => col.doc(id));
      const snaps = await db.getAll(...refs, { fieldMask: [...GET_THREADS_FIELDS] });
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const result = GET_THREADS_SHAPE.safeParse(snap.data());
        if (!result.success) {
          logSkippedDoc("thread", snap.id);
          continue;
        }
        if (result.data.outlet_id !== outletId) continue;
        map.set(snap.id, {
          status: result.data.status,
          excluded_from_evidence: result.data.excluded_from_evidence,
          label_source: result.data.label_source,
          summary: result.data.summary,
          first_line_start_ms: result.data.first_line_start_ms,
        });
      }
      return map;
    },

    async listStaffScrubNames() {
      return firestoreTickStore(db).listStaffScrubNames(outletId);
    },

    async acquireLock(nowMs, leaseMs) {
      const ref = db.collection(PROPOSAL_LOCK_COLLECTION).doc(outletId);
      return db.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const existing = ProposalLockSchema.safeParse(snap.data());
          if (existing.success) {
            if (existing.data.expires_at_ms > nowMs) return null; // still held
          } else {
            logSkippedDoc("proposal_lock", ref.id);
          }
        }
        const token = randomUUID();
        const lock = ProposalLockSchema.parse({
          outlet_id: outletId,
          lease_token: token,
          acquired_at_ms: nowMs,
          expires_at_ms: nowMs + leaseMs,
        });
        tx.set(ref, lock);
        return token;
      });
    },

    async releaseLock(token) {
      const ref = db.collection(PROPOSAL_LOCK_COLLECTION).doc(outletId);
      try {
        await db.runTransaction(async (tx: Transaction) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const existing = ProposalLockSchema.safeParse(snap.data());
          if (existing.success && existing.data.lease_token === token) {
            tx.delete(ref);
          }
        });
      } catch (error) {
        console.error("[proposal-store] releaseLock failed", {
          error_class: error instanceof Error ? error.constructor.name : "unknown",
        });
      }
    },

    async commit(threadIds, build) {
      return db.runTransaction(async (tx: Transaction) => {
        const fresh = new Map<string, FreshThread>();
        if (threadIds.length > 0) {
          const col = db.collection(COLLECTIONS.threads);
          const refs = threadIds.map((id) => col.doc(id));
          const snaps = await tx.getAll(...refs, { fieldMask: [...FRESH_THREAD_FIELDS] });
          for (const snap of snaps) {
            if (!snap.exists) continue;
            const result = FRESH_THREAD_SHAPE.safeParse(snap.data());
            if (!result.success) {
              logSkippedDoc("thread", snap.id);
              continue;
            }
            if (result.data.outlet_id !== outletId) continue;
            fresh.set(snap.id, {
              status: result.data.status,
              excluded_from_evidence: result.data.excluded_from_evidence,
              label_source: result.data.label_source,
            });
          }
        }
        const { proposal, audit } = build(fresh);
        const proposalRef = db.collection(COLLECTIONS.proposals).doc(proposal.proposal_id);
        const auditRef = db.collection(COLLECTIONS.auditLog).doc();
        tx.create(proposalRef, proposal);
        tx.create(auditRef, audit);
        return proposal;
      });
    },
  };
}
