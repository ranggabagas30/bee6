import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { CaptureSessionSchema, type CaptureSession } from "@/lib/firestore/schema";
import { captureSessionDocId } from "@/lib/firestore/stores";
import type { ClosingStore } from "@/lib/demo/closing";

/**
 * Firestore adapter behind `jumpToClosing` (R-19 PR-4a). Demo sandbox only (the route 404s elsewhere).
 * - `countLines` uses the same three equality filters the discard delete already queries (no new index) and
 *   `select("lines")` so no other field of a segment is read; it only ever counts array lengths.
 * - `markClosing` re-reads the session inside the transaction so a concurrent End or discard wins: the mark is
 *   written only on a still-open, unmarked session.
 * `db` is injectable so the adapter is unit-tested against an in-memory model.
 */
export function firestoreClosingStore(outletId: string, db: Firestore = adminDb()): ClosingStore {
  const sessions = () => db.collection(COLLECTIONS.captureSessions);

  function parse(data: Record<string, unknown> | undefined): CaptureSession | null {
    return data === undefined ? null : CaptureSessionSchema.parse(data);
  }

  return {
    async getSession(key) {
      const snap = await sessions().doc(captureSessionDocId(key)).get();
      return snap.exists ? parse(snap.data()) : null;
    },

    async countLines(key) {
      const snap = await db
        .collection(COLLECTIONS.segments)
        .where("outlet_id", "==", outletId)
        .where("device_id", "==", key.device_id)
        .where("session_id", "==", key.session_id)
        .select("lines")
        .get();
      let have = 0;
      for (const doc of snap.docs) {
        const lines = (doc.data() as { lines?: unknown }).lines;
        if (Array.isArray(lines)) have += lines.length;
      }
      return have;
    },

    async markClosing(key, at_ms) {
      await db.runTransaction(async (tx) => {
        const ref = sessions().doc(captureSessionDocId(key));
        const snap = await tx.get(ref);
        const session = snap.exists ? parse(snap.data()) : null;
        if (!session || session.ended_at_ms !== null || session.end_reason !== null) return;
        if (session.demo_closing_at_ms !== undefined) return;
        tx.update(ref, { demo_closing_at_ms: at_ms });
      });
    },
  };
}
