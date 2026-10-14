import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { LastEndedSchema, parseOutletDoc, type LastEnded } from "@/lib/firestore/schema";
import type { ProgressStore, ProgressProposalRow } from "@/lib/demo/progress";

/**
 * Firestore adapter behind `demoProgress` (R-19 PR-5). Demo sandbox only (the route 404s elsewhere). Every read is
 * one equality filter on `outlet_id` (no new index) with `select(...)` of the few fields the counts need: a
 * proposal's text, a device's id and token hash are never read. `db` is injectable for unit tests.
 */
export function firestoreProgressStore(db: Firestore = adminDb()): ProgressStore {
  return {
    async getOutlet(outletId) {
      const doc = await db.collection(COLLECTIONS.outlets).doc(outletId).get();
      if (!doc.exists) return null;
      try {
        return parseOutletDoc(doc.data());
      } catch {
        // Counts only: the doc id is a sandbox id, never a person. Same wording as the other stores' skipped-doc log.
        console.warn(JSON.stringify({ event: "firestore.skipped_doc", context: "outlet", doc_id: outletId }));
        return null;
      }
    },

    async listProposalRows(outletId) {
      const snap = await db
        .collection(COLLECTIONS.proposals)
        .where("outlet_id", "==", outletId)
        .select("content", "supervisor_review", "owner_decision")
        .get();
      const rows: ProgressProposalRow[] = [];
      for (const doc of snap.docs) {
        const raw = (doc.data() ?? {}) as { content?: unknown; supervisor_review?: { decision?: unknown } | null; owner_decision?: { decision?: unknown } | null };
        const sup = raw.supervisor_review?.decision;
        const own = raw.owner_decision?.decision;
        rows.push({
          has_content: raw.content !== null && raw.content !== undefined,
          supervisor_decision: sup === "feasible" || sup === "rejected" ? sup : null,
          owner_decision: own === "approved" || own === "rejected" ? own : null,
        });
      }
      return rows;
    },

    async listDeviceLastEnded(outletId) {
      const snap = await db.collection(COLLECTIONS.devices).where("outlet_id", "==", outletId).select("last_ended").get();
      const out: LastEnded[] = [];
      for (const doc of snap.docs) {
        const parsed = LastEndedSchema.safeParse((doc.data() as { last_ended?: unknown }).last_ended);
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    },
  };
}
