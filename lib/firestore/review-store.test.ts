import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreReviewStore, listAllOutlets } from "@/lib/firestore/review-store";
import type { Outlet } from "@/lib/firestore/schema";
import { buildExpiry } from "@/lib/reviews/plan";
import { OUTLET, reviewDoc, shippedVersion } from "@/lib/reviews/testing/fixtures";
import { proposalV1 } from "@/lib/sop/testing/fixtures";

/** Hand-rolled fake Firestore (same technique as proposal-store.test.ts), with a write log. */
class AlreadyExistsError extends Error {
  readonly code = 6;
  constructor() {
    super("ALREADY_EXISTS");
  }
}
type Doc = Record<string, unknown>;
interface Ref {
  id: string;
  col: string;
  get(): Promise<{ id: string; exists: boolean; data(): Doc | undefined }>;
}

function fakeDb(seed: Record<string, Record<string, Doc>> = {}) {
  const cols = new Map<string, Map<string, Doc>>();
  for (const [c, docs] of Object.entries(seed)) cols.set(c, new Map(Object.entries(docs)));
  const col = (n: string) => {
    let c = cols.get(n);
    if (!c) cols.set(n, (c = new Map()));
    return c;
  };
  const writes: { col: string; op: "set" | "create" | "update" | "delete"; id: string }[] = [];
  const queries: { col: string; filters: [string, string, unknown][]; selectFields?: string[]; limit?: number }[] = [];
  let auto = 0;
  const ref = (c: string, id: string): Ref => ({
    id,
    col: c,
    async get() {
      const d = col(c).get(id);
      return { id, exists: d !== undefined, data: () => d };
    },
  });
  function query(c: string, filters: [string, string, unknown][], order?: string, lim?: number, sel?: string[]) {
    const q = {
      where: (f: string, o: string, v: unknown) => query(c, [...filters, [f, o, v]], order, lim, sel),
      orderBy: (f: string) => query(c, filters, f, lim, sel),
      limit: (n: number) => query(c, filters, order, n, sel),
      select: (...f: string[]) => query(c, filters, order, lim, f),
      async get() {
        queries.push({ col: c, filters, selectFields: sel, limit: lim });
        let entries = [...col(c).entries()].filter(([, d]) =>
          filters.every(([f, o, v]) => {
            if (o === "==") return d[f] === v;
            if (o === ">=") return (d[f] as number) >= (v as number);
            if (o === "<") return (d[f] as number) < (v as number);
            if (o === "in") return (v as unknown[]).includes(d[f]);
            throw new Error(`unsupported op ${o}`);
          }),
        );
        if (order) entries = entries.sort((a, b) => (a[1][order] as number) - (b[1][order] as number));
        if (lim !== undefined) entries = entries.slice(0, lim);
        return { docs: entries.map(([id, d]) => ({ id, exists: true, data: () => d })) };
      },
    };
    return q;
  }
  const db = {
    collection(c: string) {
      return {
        where: (f: string, o: string, v: unknown) => query(c, [[f, o, v]]),
        limit: (n: number) => query(c, [], undefined, n),
        doc: (id?: string) => ref(c, id ?? `auto-${++auto}`),
      };
    },
    async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
      const staged: (() => void)[] = [];
      const tx = {
        get: (r: Ref) => r.get(),
        set: (r: Ref, d: Doc) => {
          staged.push(() => {
            writes.push({ col: r.col, op: "set", id: r.id });
            col(r.col).set(r.id, d);
          });
        },
        create: (r: Ref, d: Doc) => {
          staged.push(() => {
            if (col(r.col).has(r.id)) throw new AlreadyExistsError();
            writes.push({ col: r.col, op: "create", id: r.id });
            col(r.col).set(r.id, d);
          });
        },
      };
      const out = await fn(tx);
      staged.forEach((s) => s());
      return out;
    },
  };
  return { db: db as unknown as Firestore, cols, writes, queries };
}

const NOW_AUDIT = { outlet_id: OUTLET, ts: "2026-10-23T02:00:00.000Z", actor_role: "system" as const, action: "review.created", target_type: "review", target_id: `${OUTLET}:v2`, details: { version: 2 } };
const asDoc = (x: unknown) => x as Doc;
const outlet = (over: Partial<Outlet> = {}): Outlet => ({
  outlet_id: OUTLET, name: "T", project_kind: "demo", timezone: "Asia/Jakarta", opening_time: "07:00", closing_time: "21:45", created_at: "2026-01-01T00:00:00.000Z", ...over,
});
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => errorSpy.mockClear());

describe("firestoreReviewStore reads", () => {
  it("4.S1 listReviews / getReview / getProposal are outlet-scoped; malformed and foreign are skipped; logs carry only doc_id + error_class", async () => {
    const good = reviewDoc();
    const { db } = fakeDb({
      [COLLECTIONS.reviews]: {
        [good.review_id]: asDoc(good),
        "o1:v9": { outlet_id: OUTLET, review_id: "SECRET_TEXT_not_valid" },
        "o2:v2": asDoc({ ...good, outlet_id: "o2", review_id: "o2:v2", sop_version_id: "o2:v2" }),
      },
      [COLLECTIONS.proposals]: {
        p1: asDoc(proposalV1()),
        p2: asDoc({ ...proposalV1(), outlet_id: "o2" }),
        p3: { outlet_id: OUTLET, junk: "SECRET_TEXT" },
      },
    });
    const store = firestoreReviewStore(OUTLET, db);
    const list = await store.listReviews();
    expect(list.map((r) => r.review_id)).toEqual([good.review_id]);
    expect(await store.getReview(good.review_id)).toMatchObject({ review_id: good.review_id });
    expect(await store.getReview("o1:v9")).toBeNull();
    expect(await store.getReview("o2:v2")).toBeNull();
    expect(await store.getReview("missing")).toBeNull();
    expect(await store.getProposal("p1")).toMatchObject({ outlet_id: OUTLET });
    expect(await store.getProposal("p2")).toBeNull();
    expect(await store.getProposal("p3")).toBeNull();
    expect(await store.getProposal("nope")).toBeNull();
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("SECRET_TEXT");
      expect(call[0]).toContain("[review-store]");
    }
    expect(errorSpy).toHaveBeenCalled();
  });

  it("4.S1 listReviews queries the outlet with a limit; getOutlet parses or returns null", async () => {
    const { db, queries } = fakeDb({ [COLLECTIONS.outlets]: { [OUTLET]: asDoc(outlet()) } });
    const store = firestoreReviewStore(OUTLET, db);
    await store.listReviews();
    expect(queries[0]).toMatchObject({ col: COLLECTIONS.reviews, filters: [["outlet_id", "==", OUTLET]], limit: 50 });
    expect((await store.getOutlet())?.outlet_id).toBe(OUTLET);
    expect(await firestoreReviewStore("zzz", db).getOutlet()).toBeNull();
  });

  it("listVersions is outlet-scoped (delegates to the SOP store)", async () => {
    const v2 = shippedVersion(2);
    const { db } = fakeDb({ [COLLECTIONS.sopVersions]: { a: asDoc(v2), b: asDoc({ ...v2, outlet_id: "o2", sop_version_id: "o2:v2" }) } });
    expect((await firestoreReviewStore(OUTLET, db).listVersions()).map((v) => v.sop_version_id)).toEqual([`${OUTLET}:v2`]);
  });

  it("4.S2 listSessions with 45 dates issues two queries (30 + 15); empty issues none", async () => {
    const { db, queries } = fakeDb();
    const store = firestoreReviewStore(OUTLET, db);
    expect(await store.listSessions([])).toEqual([]);
    expect(queries).toHaveLength(0);
    const dates = Array.from({ length: 45 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    await store.listSessions(dates);
    expect(queries).toHaveLength(2);
    expect((queries[0]!.filters.find((f) => f[1] === "in")![2] as string[]).length).toBe(30);
    expect((queries[1]!.filters.find((f) => f[1] === "in")![2] as string[]).length).toBe(15);
    expect(queries.every((q) => q.col === COLLECTIONS.captureSessions && q.filters.some((f) => f[0] === "outlet_id" && f[2] === OUTLET))).toBe(true);
  });

  it("listThreadsInRange reads field-masked rows and flags truncation past the cap", async () => {
    const mk = (i: number) => ({
      outlet_id: OUTLET, thread_id: `t${i}`, device_id: "d", category: "CUSTOMER_SERVICE", status: "fact", first_line_start_ms: 1000 + i, summary: "s",
    });
    const { db, queries } = fakeDb({ [COLLECTIONS.threads]: { t1: mk(1), t2: mk(2), tx: { ...mk(3), outlet_id: "o2" } } });
    const r = await firestoreReviewStore(OUTLET, db).listThreadsInRange(1000, 2000);
    expect(r.rows.map((x) => x.thread_id)).toEqual(["t1", "t2"]);
    expect(r.truncated).toBe(false);
    expect(queries[0]!.selectFields).toContain("first_line_start_ms");
    expect(queries[0]!.selectFields).not.toContain("lines");
    expect(queries[0]!.limit).toBe(5001);
  });
});

describe("firestoreReviewStore thread truncation", () => {
  it("4.S2b more than 5000 threads in range is truncated to 5000 and flagged", async () => {
    const docs: Record<string, Doc> = {};
    for (let i = 0; i < 5001; i++) {
      docs[`t${i}`] = { outlet_id: OUTLET, thread_id: `t${i}`, device_id: "d", category: "CUSTOMER_SERVICE", status: "fact", first_line_start_ms: 1000 + i, summary: "s" };
    }
    const { db } = fakeDb({ [COLLECTIONS.threads]: docs });
    const r = await firestoreReviewStore(OUTLET, db).listThreadsInRange(0, 10_000_000);
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(5000);
  });
});

describe("firestoreReviewStore writes", () => {
  it("4.S3 createReview on an existing id returns exists and writes nothing; new writes review + audit", async () => {
    const r = reviewDoc();
    const { db, writes, cols } = fakeDb({ [COLLECTIONS.reviews]: { [r.review_id]: asDoc(r) } });
    const store = firestoreReviewStore(OUTLET, db);
    expect(await store.createReview(r, NOW_AUDIT)).toBe("exists");
    expect(writes).toEqual([]);
    const fresh = fakeDb();
    expect(await firestoreReviewStore(OUTLET, fresh.db).createReview(r, NOW_AUDIT)).toBe("created");
    expect(fresh.writes.map((w) => `${w.col}:${w.op}`).sort()).toEqual([`${COLLECTIONS.auditLog}:create`, `${COLLECTIONS.reviews}:create`]);
    expect(cols.get(COLLECTIONS.auditLog)).toBeUndefined();
  });

  it("4.S3 a commit-time ALREADY_EXISTS is also reported as exists", async () => {
    const throwing = {
      collection: () => ({ doc: (id?: string) => ({ id: id ?? "a", get: async () => ({ exists: false, data: () => undefined }) }) }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        await fn({ get: async () => ({ exists: false }), create: () => {} });
        throw new AlreadyExistsError();
      },
    } as unknown as Firestore;
    expect(await firestoreReviewStore(OUTLET, throwing).createReview(reviewDoc(), NOW_AUDIT)).toBe("exists");
  });

  it("createReview rejects a foreign-outlet review", async () => {
    const { db } = fakeDb();
    const foreign = reviewDoc({ outlet_id: "o2", review_id: "o2:v2", sop_version_id: "o2:v2" });
    await expect(firestoreReviewStore(OUTLET, db).createReview(foreign, NOW_AUDIT)).rejects.toThrow();
  });

  it("4.S4 transactReview writes via set + create only when write is non-null, outcome via create", async () => {
    const r = reviewDoc();
    const { db, writes, cols } = fakeDb({ [COLLECTIONS.reviews]: { [r.review_id]: asDoc(r) } });
    const store = firestoreReviewStore(OUTLET, db);

    const noWrite = await store.transactReview(r.review_id, (cur) => ({ write: null, outcome: cur?.status }));
    expect(noWrite).toBe("awaiting_supervisor");
    expect(writes).toEqual([]);

    const w = buildExpiry({ review: r, now_ms: 1_700_000_999_000 });
    const calls: unknown[] = [];
    const out = await store.transactReview(r.review_id, (cur) => {
      calls.push(cur);
      return { write: w, outcome: "expired" };
    });
    expect(out).toBe("expired");
    expect(calls).toHaveLength(1);
    expect(writes.map((x) => `${x.col}:${x.op}`).sort()).toEqual([
      `${COLLECTIONS.auditLog}:create`,
      `${COLLECTIONS.outcomes}:create`,
      `${COLLECTIONS.reviews}:set`,
    ]);
    expect((cols.get(COLLECTIONS.reviews)!.get(r.review_id) as { status: string }).status).toBe("unknown");
    expect(cols.get(COLLECTIONS.outcomes)!.has(r.review_id)).toBe(true);
  });

  it("4.S4 transactReview hands decide null for a missing or foreign review, and throws on an id mismatch", async () => {
    const r = reviewDoc();
    const foreign = reviewDoc({ outlet_id: "o2", review_id: "o2:v2", sop_version_id: "o2:v2" });
    const { db } = fakeDb({ [COLLECTIONS.reviews]: { "o2:v2": asDoc(foreign), [r.review_id]: asDoc(r) } });
    const store = firestoreReviewStore(OUTLET, db);
    expect(await store.transactReview("o2:v2", (cur) => ({ write: null, outcome: cur }))).toBeNull();
    expect(await store.transactReview("o1:v7", (cur) => ({ write: null, outcome: cur }))).toBeNull();
    const wrong = buildExpiry({ review: reviewDoc({ review_id: "o1:v3", sop_version_id: "o1:v3", version: 3 }), now_ms: 5 });
    await expect(store.transactReview(r.review_id, () => ({ write: wrong, outcome: 1 }))).rejects.toThrow();
  });

  it("4.S5 no code path writes sop_versions, proposals or any collection beyond reviews / outcomes / audit_log", async () => {
    const r = reviewDoc();
    const { db, writes } = fakeDb({ [COLLECTIONS.reviews]: { [r.review_id]: asDoc(r) } });
    const store = firestoreReviewStore(OUTLET, db);
    await store.createReview(reviewDoc({ review_id: "o1:v3", sop_version_id: "o1:v3", version: 3 }), NOW_AUDIT);
    await store.transactReview(r.review_id, () => ({ write: buildExpiry({ review: r, now_ms: 5 }), outcome: 1 }));
    const allowed = new Set<string>([COLLECTIONS.reviews, COLLECTIONS.outcomes, COLLECTIONS.auditLog]);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => allowed.has(w.col))).toBe(true);
  });
});

describe("listAllOutlets", () => {
  it("reads outlets with a cap (+1 to detect truncation) and skips malformed docs", async () => {
    const { db, queries } = fakeDb({
      [COLLECTIONS.outlets]: { a: asDoc(outlet()), b: asDoc(outlet({ outlet_id: "o2" })), c: { junk: "SECRET_TEXT" } },
    });
    const all = await listAllOutlets(db);
    expect(all.outlets.map((o) => o.outlet_id).sort()).toEqual(["o1", "o2"]);
    expect(all.truncated).toBe(false);
    expect(queries[0]!.limit).toBe(51);
    for (const call of errorSpy.mock.calls) expect(JSON.stringify(call)).not.toContain("SECRET_TEXT");
  });

  it("M2 exactly the cap is not truncated; one more is processed up to the cap, flagged and logged, never silent", async () => {
    const docs = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`d${i}`, asDoc(outlet({ outlet_id: `o${i}` }))]));
    const atCap = await listAllOutlets(fakeDb({ [COLLECTIONS.outlets]: docs(50) }).db);
    expect(atCap).toMatchObject({ truncated: false });
    expect(atCap.outlets).toHaveLength(50);
    expect(errorSpy).not.toHaveBeenCalledWith("[review] outlets truncated", expect.anything());

    const over = await listAllOutlets(fakeDb({ [COLLECTIONS.outlets]: docs(51) }).db);
    expect(over.truncated).toBe(true);
    expect(over.outlets).toHaveLength(50);
    expect(errorSpy).toHaveBeenCalledWith("[review] outlets truncated", { error_class: "outlets_truncated" });
  });
});
