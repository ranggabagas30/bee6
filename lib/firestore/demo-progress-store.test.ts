import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreProgressStore } from "@/lib/firestore/demo-progress-store";

/**
 * Review-agent plan Part 1 (3.2.2): the progress store's review read. One equality filter on `outlet_id`, a
 * field-masked `status` read, unknown statuses dropped. Hand-rolled fake Firestore (same technique as demo-store tests).
 */
type Doc = Record<string, unknown>;
const SBX = "sbx-0123456789ab";
const OTHER = "sbx-ffffffffffff";

function fakeDb(seed: Record<string, Record<string, Doc>>) {
  const queries: { col: string; filters: [string, unknown][]; select: string[] | null }[] = [];
  const db = {
    collection: (c: string) => {
      const make = (filters: [string, unknown][], select: string[] | null) => ({
        where: (f: string, _o: string, v: unknown) => make([...filters, [f, v]], select),
        select: (...fields: string[]) => make(filters, fields),
        async get() {
          queries.push({ col: c, filters, select });
          const docs = Object.entries(seed[c] ?? {}).filter(([, d]) => filters.every(([f, v]) => d[f] === v));
          return { docs: docs.map(([id, d]) => ({ id, data: () => d })) };
        },
      });
      return make([], null);
    },
  };
  return { db: db as unknown as Firestore, queries };
}

describe("firestoreProgressStore.listReviewStatuses", () => {
  it("returns the statuses of THIS outlet's reviews only, dropping unknown values, reading nothing but status", async () => {
    const f = fakeDb({
      [COLLECTIONS.reviews]: {
        r1: { outlet_id: SBX, status: "awaiting_supervisor", change_title: "never read" },
        r2: { outlet_id: SBX, status: "confirmed" },
        r3: { outlet_id: SBX, status: "bogus" },
        r4: { outlet_id: OTHER, status: "awaiting_owner" },
      },
    });
    expect(await firestoreProgressStore(f.db).listReviewStatuses(SBX)).toEqual(["awaiting_supervisor", "confirmed"]);
    expect(f.queries).toEqual([{ col: "reviews", filters: [["outlet_id", SBX]], select: ["status"] }]);
  });

  it("is empty when the outlet has no review", async () => {
    expect(await firestoreProgressStore(fakeDb({}).db).listReviewStatuses(SBX)).toEqual([]);
  });
});
