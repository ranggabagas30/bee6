import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreConstraintStore } from "@/lib/firestore/constraint-store";
import type { AuditLog, Constraint } from "@/lib/firestore/schema";

/**
 * Hand-rolled fake Firestore (same technique as `lib/firestore/proposal-store.test.ts`
 * and `tick-store.test.ts`): NOT the emulator, only checks the Admin SDK
 * surface is called correctly (equality-only query, `tx.create` not `tx.set`,
 * the transaction's own read feeding `decide`).
 */
interface FakeDocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface FakeDocRef {
  id: string;
  get(): Promise<FakeDocSnap>;
  _sync: { exists(): boolean; write(data: Record<string, unknown>): void };
}
interface FakeQuery {
  where(field: string, op: string, value: unknown): FakeQuery;
  limit(n: number): FakeQuery;
  get(): Promise<{ docs: FakeDocSnap[] }>;
}

class AlreadyExistsError extends Error {
  readonly code = 6;
  constructor() {
    super("ALREADY_EXISTS");
  }
}

function matches(data: Record<string, unknown>, field: string, op: string, value: unknown): boolean {
  const v = data[field];
  if (op === "==") return v === value;
  throw new Error(`fake firestore: unsupported op ${op}`);
}

function fakeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const col = new Map<string, Record<string, unknown>>(Object.entries(seed));
  const createCalls: string[] = [];
  const setCalls: string[] = [];
  let autoIdCounter = 0;

  function makeQuery(filters: [string, string, unknown][], limitN: number | undefined): FakeQuery {
    return {
      where(field, op, value) {
        return makeQuery([...filters, [field, op, value]], limitN);
      },
      limit(n) {
        return makeQuery(filters, n);
      },
      async get() {
        let entries = Array.from(col.entries()).filter(([, data]) =>
          filters.every(([f, o, v]) => matches(data as Record<string, unknown>, f, o, v)),
        );
        if (limitN !== undefined) entries = entries.slice(0, limitN);
        return { docs: entries.map(([id, data]) => ({ id, exists: true, data: () => data })) };
      },
    };
  }

  function doc(id: string): FakeDocRef {
    return {
      id,
      async get() {
        const data = col.get(id);
        return { id, exists: data !== undefined, data: () => data };
      },
      _sync: {
        exists() {
          return col.has(id);
        },
        write(data) {
          col.set(id, data);
        },
      },
    };
  }

  const collectionApi = {
    where(field: string, op: string, value: unknown) {
      return makeQuery([[field, op, value]], undefined);
    },
    doc(id?: string) {
      autoIdCounter += 1;
      return doc(id ?? `auto-${autoIdCounter}`);
    },
  };

  const db = {
    collection() {
      return collectionApi;
    },
    async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        get: (q: FakeQuery) => q.get(),
        set: (ref: FakeDocRef, data: Record<string, unknown>) => {
          setCalls.push(ref.id);
          ref._sync.write(data);
        },
        create: (ref: FakeDocRef, data: Record<string, unknown>) => {
          if (ref._sync.exists()) throw new AlreadyExistsError();
          createCalls.push(ref.id);
          ref._sync.write(data);
        },
      };
      return fn(tx);
    },
  };

  return { db: db as unknown as Firestore, col, createCalls, setCalls };
}

const OUTLET_ID = "proofed";

function makeConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    outlet_id: OUTLET_ID,
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "an existing constraint",
    source: "manual",
    source_proposal_id: null,
    created_by_role: "supervisor",
    created_at_ms: 1,
    ...overrides,
  };
}

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  errorSpy.mockClear();
});

vi.mock("@/lib/firestore/tick-store", () => ({
  firestoreTickStore: () => ({ listStaffScrubNames: async () => [] }),
}));

describe("firestoreConstraintStore.list", () => {
  // A foreign-outlet doc is also skipped + logged by `parseSnap`'s defensive
  // check (defence in depth), but a `.where("outlet_id", "==", outletId)`
  // query cannot return one from a real Firestore, and this hand-rolled
  // fake applies the same filter before `parseSnap` ever sees a doc — so
  // there is no fake-db shape that reaches that branch without bypassing
  // the query filter itself (which would test the fake, not the store).
  it("skips a malformed doc, logging only { doc_id, error_class }", async () => {
    const { db, col } = fakeDb();
    col.set("good", makeConstraint({ constraint_id: "11111111-1111-4111-8111-111111111112", created_at_ms: 2 }) as unknown as Record<string, unknown>);
    col.set("malformed", { outlet_id: OUTLET_ID }); // fails ConstraintSchema

    const store = firestoreConstraintStore(OUTLET_ID, db);
    const result = await store.list();

    expect(result.map((c) => c.constraint_id)).toEqual(["11111111-1111-4111-8111-111111111112"]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[constraint-store] skipping malformed constraint doc",
      expect.objectContaining({ doc_id: "malformed", error_class: "ZodError" }),
    );
  });

  it("sorts oldest first, then by constraint_id on a tie", async () => {
    const { db, col } = fakeDb();
    col.set("c2", makeConstraint({ constraint_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", created_at_ms: 5 }) as unknown as Record<string, unknown>);
    col.set("c1", makeConstraint({ constraint_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", created_at_ms: 5 }) as unknown as Record<string, unknown>);
    col.set("c3", makeConstraint({ constraint_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", created_at_ms: 1 }) as unknown as Record<string, unknown>);

    const store = firestoreConstraintStore(OUTLET_ID, db);
    const result = await store.list();
    expect(result.map((c) => c.constraint_id)).toEqual([
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  });
});

describe("firestoreConstraintStore.createInTransaction", () => {
  it("uses tx.create (not set) for both the constraint and the audit entry", async () => {
    const { db, createCalls, setCalls } = fakeDb();
    const store = firestoreConstraintStore(OUTLET_ID, db);
    const constraint = makeConstraint({ constraint_id: "22222222-2222-4222-8222-222222222222" });
    const audit: AuditLog = {
      outlet_id: OUTLET_ID,
      ts: "2026-01-01T00:00:00.000Z",
      actor_role: "supervisor",
      action: "constraint.created",
      target_type: "constraint",
      target_id: constraint.constraint_id,
      details: { source: "manual" },
    };
    const result = await store.createInTransaction(() => ({ kind: "create", constraint, audit }));
    expect(result.kind).toBe("create");
    expect(createCalls).toContain(constraint.constraint_id);
    expect(createCalls.length).toBe(2); // constraint + audit
    expect(setCalls).toEqual([]);
  });

  it("the decide callback receives the transaction's own read, not a prior list() read", async () => {
    const { db, col } = fakeDb();
    const store = firestoreConstraintStore(OUTLET_ID, db);

    // A prior read sees nothing.
    const before = await store.list();
    expect(before).toHaveLength(0);

    // Something is written directly to the collection "concurrently", after
    // the prior read but before the transaction starts.
    col.set("late", makeConstraint({ constraint_id: "33333333-3333-4333-8333-333333333333" }) as unknown as Record<string, unknown>);

    let seenByDecide: Constraint[] = [];
    await store.createInTransaction((existing) => {
      seenByDecide = existing;
      return { kind: "limit" };
    });

    expect(seenByDecide.map((c) => c.constraint_id)).toEqual(["33333333-3333-4333-8333-333333333333"]);
  });

  it("limit and duplicate results pass through without writing", async () => {
    const { db, createCalls } = fakeDb();
    const store = firestoreConstraintStore(OUTLET_ID, db);

    const limitResult = await store.createInTransaction(() => ({ kind: "limit" }));
    expect(limitResult).toEqual({ kind: "limit" });

    const existing = makeConstraint();
    const dupResult = await store.createInTransaction(() => ({ kind: "duplicate", existing }));
    expect(dupResult).toEqual({ kind: "duplicate", existing });

    expect(createCalls).toEqual([]);
  });
});

describe("firestoreConstraintStore.listStaffScrubNames", () => {
  it("delegates to the tick store helper", async () => {
    const { db } = fakeDb();
    const store = firestoreConstraintStore(OUTLET_ID, db);
    expect(await store.listStaffScrubNames()).toEqual([]);
  });
});
