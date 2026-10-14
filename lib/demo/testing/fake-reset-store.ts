// Test-only in-memory ResetStore (R-19 PR-7): a tiny "world" of sandbox docs so a reset can be checked end to end
// (delete really removes, write really refuses an existing id like Firestore `create`), with call tracking.
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Outlet } from "@/lib/firestore/schema";
import type { ClonedDoc, TemplateSet } from "@/lib/demo/clone";
import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";
import { TemplateTooLargeError } from "@/lib/demo/store-types";
import { SHIFT_MARKER_STALE_MS } from "@/lib/demo/next-day";
import type { ResetStore } from "@/lib/demo/service";
import { templateSet } from "@/lib/demo/testing/fixtures";

export interface FakeResetSeed {
  /** The sandbox's docs, as the clone writes them, plus any dirty extras (proposals, segments, ...). */
  docs: ClonedDoc[];
  template?: TemplateSet | null;
  counters?: Record<string, number>;
  proposalLockExpiresAtMs?: number | null;
  leaseHeld?: boolean;
}

const outletIdOf = (d: ClonedDoc): string | undefined =>
  d.collection === COLLECTIONS.outlets ? d.id : (d.data as { outlet_id?: string }).outlet_id;

export function fakeResetStore(seed: FakeResetSeed) {
  const calls: string[] = [];
  const world = new Map<string, ClonedDoc>(seed.docs.map((d) => [`${d.collection}/${d.id}`, d]));
  const counters = new Map<string, number>(Object.entries(seed.counters ?? {}));
  const bumps: { id: string; kind: string; limit: number }[] = [];
  const state = {
    template: "template" in seed ? seed.template : templateSet(),
    tooLarge: false,
    proposalLockExpiresAtMs: seed.proposalLockExpiresAtMs ?? null,
    leaseHeld: seed.leaseHeld ?? false,
    leases: [] as { outletId: string; deviceId: string; ttlMs: number; token: number }[],
    released: [] as number[],
    failDelete: false,
    failWrite: false,
    failBump: false,
    failRead: false,
    failRelease: false,
    /** The counter pre-check passes but the charge is refused (another reset spent the last slot in between). */
    bumpRefused: false,
    /** A proposal lock that appears only after the lease is taken (a generate that started in the gap). */
    lockAppearsAfterLease: false,
    /** Awaited at the start of `deleteSandbox`, after the lease doc is gone: lets a test hold a reset mid-wipe. */
    deleteGate: null as Promise<void> | null,
    /** Awaited at the end of `deleteSandbox`, after the outlet doc is gone (the window between the wipe and the re-clone). */
    afterDeleteGate: null as Promise<void> | null,
    /** Called once the outlet doc is deleted, just before `afterDeleteGate` is awaited. */
    onOutletDeleted: null as (() => void) | null,
    tokenHashOverride: undefined as string | null | undefined,
  };
  const outletDoc = (id: string): Outlet | null => (world.get(`${COLLECTIONS.outlets}/${id}`)?.data as unknown as Outlet | undefined) ?? null;

  const store: ResetStore = {
    async readTemplate() {
      calls.push("readTemplate");
      if (state.tooLarge) throw new TemplateTooLargeError();
      return state.template ?? null;
    },
    async getOutlet(id) {
      calls.push("getOutlet");
      if (state.failRead) throw new Error("read failed");
      return outletDoc(id);
    },
    async readCounter(id) {
      calls.push("readCounter");
      if (state.failBump) throw new Error("counter unavailable");
      return counters.get(id) ?? 0;
    },
    async bumpCounter(id, kind, _day, limit) {
      calls.push("bumpCounter");
      bumps.push({ id, kind, limit });
      if (state.failBump) throw new Error("counter unavailable");
      const n = counters.get(id) ?? 0;
      if (state.bumpRefused || n >= limit) return false;
      counters.set(id, n + 1);
      return true;
    },
    async readJudgeTokenHash(outletId, deviceId) {
      calls.push("readJudgeTokenHash");
      if (state.tokenHashOverride !== undefined) return state.tokenHashOverride;
      const doc = [...world.values()].find((d) => d.collection === COLLECTIONS.devices && (d.data as { outlet_id?: string; device_id?: string }).outlet_id === outletId && (d.data as { device_id?: string }).device_id === deviceId);
      return (doc?.data as { token_hash?: string } | undefined)?.token_hash ?? null;
    },
    async proposalLockLive(_outletId, nowMs) {
      calls.push("proposalLockLive");
      if (state.lockAppearsAfterLease && calls.includes("acquireLease")) return true;
      return state.proposalLockExpiresAtMs !== null && state.proposalLockExpiresAtMs > nowMs;
    },
    async takeResetMarker(outletId, nowMs) {
      calls.push("takeResetMarker"); // one atomic step, like the Firestore transaction
      const doc = world.get(`${COLLECTIONS.outlets}/${outletId}`);
      const outlet = doc?.data as unknown as Outlet | undefined;
      if (!doc || !outlet?.sandbox) return { taken: false as const, reason: "gone" as const };
      const prior = outlet.sandbox.shift_started_at_ms ?? null;
      if (prior !== null && nowMs - prior <= SHIFT_MARKER_STALE_MS) return { taken: false as const, reason: "busy" as const };
      world.set(`${COLLECTIONS.outlets}/${outletId}`, { ...doc, data: { ...doc.data, sandbox: { ...outlet.sandbox, shift_started_at_ms: nowMs } } });
      return { taken: true as const, prior };
    },
    async restoreResetMarker(outletId, ours, prior) {
      calls.push("restoreResetMarker");
      const doc = world.get(`${COLLECTIONS.outlets}/${outletId}`);
      const outlet = doc?.data as unknown as Outlet | undefined;
      if (!doc || !outlet?.sandbox) return;
      if ((outlet.sandbox.shift_started_at_ms ?? null) !== ours) return;
      world.set(`${COLLECTIONS.outlets}/${outletId}`, { ...doc, data: { ...doc.data, sandbox: { ...outlet.sandbox, shift_started_at_ms: prior } } });
    },
    async acquireLease(outletId, deviceId, nowMs, ttlMs) {
      calls.push("acquireLease");
      if (state.leaseHeld) return null;
      state.leaseHeld = true;
      state.leases.push({ outletId, deviceId, ttlMs, token: nowMs });
      return nowMs;
    },
    async releaseLease(_outletId, _deviceId, token) {
      calls.push("releaseLease");
      if (state.failRelease) throw new Error("release failed");
      state.leaseHeld = false;
      state.released.push(token);
    },
    async deleteSandbox(outletId) {
      calls.push("deleteSandbox");
      if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) throw new Error("refusing to delete a non-sandbox outlet");
      if (state.failDelete) throw new Error("delete failed");
      state.leaseHeld = false; // the lease doc lives in the sandbox's collections: the wipe removes it (the M1 hazard)
      if (state.deleteGate) await state.deleteGate;
      // The outlet doc goes last, so its marker covers the whole wipe (as the Firestore store does).
      const entries = [...world].filter(([, d]) => outletIdOf(d) === outletId);
      for (const [k, d] of entries) if (d.collection !== COLLECTIONS.outlets) world.delete(k);
      for (const [k, d] of entries) if (d.collection === COLLECTIONS.outlets) world.delete(k);
      state.onOutletDeleted?.();
      if (state.afterDeleteGate) await state.afterDeleteGate;
    },
    async writeSandbox(docs) {
      calls.push("writeSandbox");
      if (state.failWrite) throw new Error("write failed");
      for (const d of docs) {
        const k = `${d.collection}/${d.id}`;
        if (world.has(k)) throw new Error("ALREADY_EXISTS"); // Firestore create() semantics
        world.set(k, d);
      }
    },
  };
  return { store, calls, world, counters, bumps, state, outletDoc };
}
