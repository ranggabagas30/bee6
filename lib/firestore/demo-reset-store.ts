import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DeviceSchema, ProposalLockSchema } from "@/lib/firestore/schema";
import { deviceDocId } from "@/lib/firestore/stores";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";
import type { ResetStore } from "@/lib/demo/service";

/**
 * R-19 PR-7: the Firestore `ResetStore` behind the owner reset (lib/demo/service.ts `resetSandbox`). Demo project
 * only (the route 404s first). The wipe, the re-clone write, the counters and the template read are the demo store's;
 * the pipeline lease is the tick store's, so a tick, a next-day shift and a reset can never run on the same device at
 * once. The only reads added here are the judge device's token hash and the proposal lock. Nothing here reads a name,
 * a transcript or audio, and nothing logs a hash: a malformed doc is reported by its id and the error class only.
 */
function logSkippedDoc(context: string, docId: string): void {
  console.error(`[demo-reset-store] skipping malformed ${context} doc`, { doc_id: docId, error_class: "ZodError" });
}

export function firestoreResetStore(db: Firestore = adminDb()): ResetStore {
  const demo = firestoreDemoStore(db);
  const tick = firestoreTickStore(db);
  return {
    readTemplate: () => demo.readTemplate(),
    writeSandbox: (docs) => demo.writeSandbox(docs),
    deleteSandbox: (outletId) => demo.deleteSandbox(outletId),
    getOutlet: (outletId) => demo.getOutlet(outletId),
    bumpCounter: (...args) => demo.bumpCounter(...args),
    readCounter: (counterId) => demo.readCounter(counterId),

    async readJudgeTokenHash(outletId, deviceId) {
      if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) return null;
      const snap = await db.collection(COLLECTIONS.devices).doc(deviceDocId(outletId, deviceId)).get();
      if (!snap.exists) return null;
      const parsed = DeviceSchema.safeParse(snap.data());
      if (!parsed.success) {
        logSkippedDoc("device", snap.id);
        return null;
      }
      // The doc id names the outlet and device; the fields must agree (a doc under another outlet is never trusted).
      if (parsed.data.outlet_id !== outletId || parsed.data.device_id !== deviceId) return null;
      return parsed.data.token_hash ?? null; // the schema already refuses an empty string
    },

    async proposalLockLive(outletId, nowMs) {
      const snap = await db.collection(COLLECTIONS.proposalLocks).doc(outletId).get();
      if (!snap.exists) return false;
      const lock = ProposalLockSchema.safeParse(snap.data());
      if (!lock.success) {
        logSkippedDoc("proposal_lock", snap.id);
        return false; // the wipe deletes it
      }
      return lock.data.expires_at_ms > nowMs;
    },

    acquireLease: (outletId, deviceId, nowMs, ttlMs) => tick.acquireLease(outletId, deviceId, nowMs, ttlMs),
    releaseLease: (outletId, deviceId, token) => tick.releaseLease(outletId, deviceId, token),
  };
}
