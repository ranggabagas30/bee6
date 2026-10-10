import type { Firestore, QuerySnapshot, Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import { ConstraintSchema, parseOutletDoc, type Constraint } from "@/lib/firestore/schema";
import { MAX_CONSTRAINTS } from "@/lib/proposals/constants";
import type { ConstraintStore } from "@/lib/constraints/service";

/**
 * Firestore-backed `ConstraintStore` (R-08 Task 8.4; web spec §6.6). Same
 * "pure logic / thin store" split as the other Firestore stores in this
 * codebase (`day-store.ts`, `tick-store.ts`, `proposal-store.ts`): every
 * read is outlet-scoped by an equality filter (no composite index needed);
 * malformed or foreign-outlet docs are skipped and logged
 * `{ doc_id, error_class }` only, never the raw doc or zod error.
 */

/** Logs only `{doc_id, error_class}` — same discipline as the other stores. */
function logSkippedDoc(context: string, docId: string): void {
  console.error(`[constraint-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

export function firestoreConstraintStore(outletId: string, db: Firestore = adminDb()): ConstraintStore {
  const constraintsCollection = () => db.collection(COLLECTIONS.constraints);

  /** Equality-only query: no composite index. Sorting happens in memory. */
  const constraintsQuery = () => constraintsCollection().where("outlet_id", "==", outletId).limit(MAX_CONSTRAINTS + 1);

  function parseSnap(snap: QuerySnapshot): Constraint[] {
    const out: Constraint[] = [];
    for (const doc of snap.docs) {
      const result = ConstraintSchema.safeParse(doc.data());
      if (!result.success) {
        logSkippedDoc("constraint", doc.id);
        continue;
      }
      // Defence in depth: the query already filters by outlet_id, but a
      // doc never reaches the caller if it somehow disagrees.
      if (result.data.outlet_id !== outletId) {
        logSkippedDoc("constraint", doc.id);
        continue;
      }
      out.push(result.data);
    }
    return out.sort((a, b) => a.created_at_ms - b.created_at_ms || a.constraint_id.localeCompare(b.constraint_id));
  }

  return {
    async getOutlet() {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? parseOutletDoc(doc.data()) : null;
    },

    async list() {
      const snap = await constraintsQuery().get();
      return parseSnap(snap);
    },

    async listStaffScrubNames() {
      return firestoreTickStore(db).listStaffScrubNames(outletId);
    },

    async createInTransaction(decide) {
      return db.runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(constraintsQuery());
        const existing = parseSnap(snap as unknown as QuerySnapshot);
        const result = decide(existing);
        if (result.kind !== "create") return result;

        const constraintRef = constraintsCollection().doc(result.constraint.constraint_id);
        const auditRef = db.collection(COLLECTIONS.auditLog).doc();
        tx.create(constraintRef, result.constraint);
        tx.create(auditRef, result.audit);
        return { kind: "create" as const, constraint: result.constraint };
      });
    },
  };
}
