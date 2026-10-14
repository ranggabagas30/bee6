// Test-only in-memory ResetStore (R-19 PR-7): a tiny "world" of sandbox docs so a reset can be checked end to end
// (delete really removes, write really refuses an existing id like Firestore `create`), with call tracking.
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Outlet } from "@/lib/firestore/schema";
import type { ClonedDoc, TemplateSet } from "@/lib/demo/clone";
import { SANDBOX_OUTLET_PREFIX } from "@/lib/demo/constants";
import { TemplateTooLargeError } from "@/lib/demo/store-types";
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
      if (n >= limit) return false;
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
      return state.proposalLockExpiresAtMs !== null && state.proposalLockExpiresAtMs > nowMs;
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
      for (const [k, d] of [...world]) if (outletIdOf(d) === outletId) world.delete(k);
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
