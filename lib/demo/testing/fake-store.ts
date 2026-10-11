// Test-only in-memory DemoStore with call tracking and real counter semantics (shared by the service and route tests).
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Outlet } from "@/lib/firestore/schema";
import type { ClonedDoc, TemplateSet } from "@/lib/demo/clone";
import { TemplateTooLargeError, type DemoStore } from "@/lib/demo/store-types";
import { templateSet } from "@/lib/demo/testing/fixtures";

/** In-memory DemoStore with call tracking and real counter semantics. */
export function fakeStore(over: Partial<{ template: TemplateSet | null; expired: string[] }> = {}) {
  const calls: string[] = [];
  const written: ClonedDoc[] = [];
  const sandboxes = new Map<string, Outlet>();
  const counters = new Map<string, number>();
  const bumps: { id: string; kind: string; limit: number }[] = [];
  const deleted: string[] = [];
  const rotations: { outletId: string; deviceId: string; hash: string; exp: number }[] = [];
  const state = { template: "template" in over ? over.template : templateSet(), expired: over.expired ?? [], failDelete: false, failWrite: false, tooLarge: false };

  const store: DemoStore = {
    async readTemplate() {
      calls.push("readTemplate");
      if (state.tooLarge) throw new TemplateTooLargeError();
      return state.template ?? null;
    },
    async writeSandbox(docs) {
      calls.push("writeSandbox");
      if (state.failWrite) throw new Error("boom");
      written.push(...docs);
      const outletDoc = docs.find((d) => d.collection === COLLECTIONS.outlets);
      if (outletDoc) sandboxes.set(outletDoc.id, outletDoc.data as unknown as Outlet);
    },
    async findSandboxByKey(h) {
      calls.push("findSandboxByKey");
      return [...sandboxes.values()].find((o) => o.sandbox?.key_sha256 === h) ?? null;
    },
    async rotateDeviceToken(outletId, deviceId, hash, exp) {
      calls.push("rotateDeviceToken");
      rotations.push({ outletId, deviceId, hash, exp });
    },
    async bumpCounter(id, kind, _day, limit) {
      calls.push("bumpCounter");
      bumps.push({ id, kind, limit });
      const n = counters.get(id) ?? 0;
      if (n >= limit) return false;
      counters.set(id, n + 1);
      return true;
    },
    async readCounter(id) {
      calls.push("readCounter");
      return counters.get(id) ?? 0;
    },
    async listExpiredSandboxes(_now, limit) {
      calls.push("listExpiredSandboxes");
      return state.expired.slice(0, limit);
    },
    async deleteSandbox(id) {
      calls.push("deleteSandbox");
      if (state.failDelete) throw new Error("delete failed");
      deleted.push(id);
    },
    async getOutlet(id) {
      calls.push("getOutlet");
      return sandboxes.get(id) ?? null;
    },
  };
  return { store, calls, written, sandboxes, counters, bumps, deleted, rotations, state };
}

