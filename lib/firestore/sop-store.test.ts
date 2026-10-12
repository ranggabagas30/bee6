import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreSopStore } from "@/lib/firestore/sop-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { outcomeFor, seedV1 } from "@/lib/sop/testing/fixtures";

const SENTINEL = "STEP-TEXT-SENTINEL";

interface Call {
  collection: string;
  wheres: Array<[string, string, unknown]>;
  limit: number | null;
  orderBy: boolean;
}

function fakeDb(docs: Record<string, Record<string, unknown>>, outlet?: Record<string, unknown>) {
  const calls: Call[] = [];
  const db = {
    collection(name: string) {
      if (name === COLLECTIONS.outlets) {
        return {
          doc: (id: string) => ({
            get: async () => ({ id, exists: outlet !== undefined, data: () => outlet }),
          }),
        };
      }
      const call: Call = { collection: name, wheres: [], limit: null, orderBy: false };
      const q = {
        where(f: string, op: string, v: unknown) {
          call.wheres.push([f, op, v]);
          return q;
        },
        limit(n: number) {
          call.limit = n;
          return q;
        },
        orderBy() {
          call.orderBy = true;
          return q;
        },
        async get() {
          calls.push(call);
          return { docs: Object.entries(docs).map(([id, data]) => ({ id, data: () => data })) };
        },
      };
      return q;
    },
  };
  return { db: db as unknown as Firestore, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("firestoreSopStore", () => {
  it("4.S1 queries by outlet_id equality + limit(50), no orderBy; skips malformed and foreign docs; logs ids only", async () => {
    const good = seedV1();
    const foreign = { ...seedV1(), outlet_id: "other", sop_version_id: "other:v1" };
    const malformed = { ...seedV1(), version: "two", steps: [{ step_id: "x", title: SENTINEL }] };
    const { db, calls } = fakeDb({ "o1:v1": good, "other:v1": foreign, "o1:vX": malformed });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await firestoreSopStore("o1", db).listVersions();

    expect(out.map((v) => v.sop_version_id)).toEqual(["o1:v1"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ collection: COLLECTIONS.sopVersions, wheres: [["outlet_id", "==", "o1"]], limit: 50, orderBy: false });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[sop-store]"), { doc_id: "o1:vX", error_class: "ZodError" });
    expect(JSON.stringify(err.mock.calls)).not.toContain(SENTINEL);
  });

  it("4.S2 exposes only the three read methods (read-only)", () => {
    const { db } = fakeDb({});
    expect(Object.keys(firestoreSopStore("o1", db)).sort()).toEqual(["getOutlet", "listOutcomes", "listVersions"]);
  });

  it("7.S1 listOutcomes queries outcomes by outlet_id equality + limit(50); skips malformed and foreign docs; logs ids only", async () => {
    const good = outcomeFor(2);
    const foreign = { ...outcomeFor(3), outlet_id: "other" };
    const malformed = { ...outcomeFor(4), verdict: "maybe", in_memory: SENTINEL };
    const { db, calls } = fakeDb({ "o1:v2": good, "other:v3": foreign, "o1:v4": malformed });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await firestoreSopStore("o1", db).listOutcomes();

    expect(out.map((o) => o.outcome_id)).toEqual(["o1:v2"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ collection: COLLECTIONS.outcomes, wheres: [["outlet_id", "==", "o1"]], limit: 50, orderBy: false });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[sop-store]"), { doc_id: "o1:v4", error_class: "ZodError" });
    expect(JSON.stringify(err.mock.calls)).not.toContain(SENTINEL);
  });

  it("getOutlet returns null for a missing outlet doc", async () => {
    const { db } = fakeDb({});
    expect(await firestoreSopStore("o1", db).getOutlet()).toBeNull();
  });
});
