import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { OutcomeSchema, SopVersionSchema, parseOutletDoc, type Outcome, type SopVersion } from "@/lib/firestore/schema";
import type { SopStore } from "@/lib/sop/service";

/**
 * Read-only Firestore `SopStore` (R-10 Task 4.2). Every read is outlet-scoped;
 * malformed or foreign-outlet docs are skipped and logged `{ doc_id,
 * error_class }` only, never step text. There is deliberately no write method:
 * SOP versions are written only by the owner-approval transaction and the seed
 * (hard rule #9; see lib/sop/write-boundary.test.ts). `listOutcomes` (R-11
 * Task 7) reads the remembered review outcomes so the SOP change card can show
 * them; outcomes carry no text.
 */

function logSkippedDoc(docId: string, kind: "sop_version" | "outcome" = "sop_version"): void {
  console.error(`[sop-store] skipping malformed ${kind} doc`, { doc_id: docId, error_class: "ZodError" });
}

export function firestoreSopStore(outletId: string, db: Firestore = adminDb()): SopStore {
  return {
    async getOutlet() {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      return doc.exists ? parseOutletDoc(doc.data()) : null;
    },

    async listVersions() {
      const snap = await db.collection(COLLECTIONS.sopVersions).where("outlet_id", "==", outletId).limit(50).get();
      const out: SopVersion[] = [];
      for (const doc of snap.docs) {
        const result = SopVersionSchema.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc(doc.id);
          continue;
        }
        if (result.data.outlet_id !== outletId) continue;
        out.push(result.data);
      }
      return out;
    },

    async listOutcomes() {
      const snap = await db.collection(COLLECTIONS.outcomes).where("outlet_id", "==", outletId).limit(50).get();
      const out: Outcome[] = [];
      for (const doc of snap.docs) {
        const result = OutcomeSchema.safeParse(doc.data());
        if (!result.success) {
          logSkippedDoc(doc.id, "outcome");
          continue;
        }
        if (result.data.outlet_id !== outletId) continue;
        out.push(result.data);
      }
      return out;
    },
  };
}
