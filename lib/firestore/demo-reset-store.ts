import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { DeviceSchema, ProposalLockSchema, parseOutletDoc } from "@/lib/firestore/schema";
import { deviceDocId } from "@/lib/firestore/stores";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";
import { SHIFT_MARKER_STALE_MS } from "@/lib/demo/next-day";
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
  const outlets = () => db.collection(COLLECTIONS.outlets);
  /** The sandbox outlet or a throw: a marker is never written on a pilot outlet, a missing doc or a non-sandbox doc. */
  const requireSandbox = (raw: unknown, outletId: string) => {
    if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX) || raw === undefined) throw new Error("demo-reset-store: not a sandbox outlet");
    const outlet = parseOutletDoc(raw);
    if (!outlet.sandbox) throw new Error("demo-reset-store: not a sandbox outlet");
    return outlet.sandbox;
  };
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

    async takeResetMarker(outletId, nowMs) {
      const ref = outlets().doc(outletId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const sandbox = requireSandbox(snap.exists ? snap.data() : undefined, outletId);
        const prior = sandbox.shift_started_at_ms ?? null;
        // A fresh marker (a shift or another reset in flight; a future one counts) wins; a stale one is a crash.
        if (prior !== null && nowMs - prior <= SHIFT_MARKER_STALE_MS) return { taken: false as const };
        tx.update(ref, { sandbox: { ...sandbox, shift_started_at_ms: nowMs } });
        return { taken: true as const, prior };
      });
    },

    async restoreResetMarker(outletId, ours, prior) {
      const ref = outlets().doc(outletId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return; // the wipe got there first: nothing to restore
        const sandbox = requireSandbox(snap.data(), outletId);
        if ((sandbox.shift_started_at_ms ?? null) !== ours) return; // not ours any more: never clobber it
        tx.update(ref, { sandbox: { ...sandbox, shift_started_at_ms: prior } });
      });
    },

    acquireLease: (outletId, deviceId, nowMs, ttlMs) => tick.acquireLease(outletId, deviceId, nowMs, ttlMs),
    releaseLease: (outletId, deviceId, token) => tick.releaseLease(outletId, deviceId, token),
  };
}
