import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreProposalStore } from "@/lib/firestore/proposal-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Constraint, Outlet, Proposal, SopVersion } from "@/lib/firestore/schema";

/**
 * Hand-rolled fake Firestore (R-08 Task 5.3) — the same technique as
 * `lib/firestore/day-store.test.ts` and `tick-store.test.ts`, combined and
 * extended with `tx.create()` / `tx.delete()` / `tx.getAll()` and
 * `doc.create()` (none of those two files need all three together). NOT the
 * Firestore emulator — only checks that `firestoreProposalStore` calls the
 * Admin SDK surface correctly and applies the plan's drop/skip rules.
 */
interface FakeDocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface FakeDocRef {
  id: string;
  get(): Promise<FakeDocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  create(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  /** Test-only synchronous access so `tx.create`/`tx.delete` can mirror the
   * real Transaction API's synchronous queuing (a duplicate `tx.create`
   * must reject the surrounding `runTransaction` callback promise, which a
   * `void`-wrapped async call would silently swallow instead). */
  _sync: { exists(): boolean; write(data: Record<string, unknown>): void; remove(): void };
}
interface FakeTx {
  get(ref: FakeDocRef): Promise<FakeDocSnap>;
  getAll(...args: unknown[]): Promise<FakeDocSnap[]>;
  set(ref: FakeDocRef, data: Record<string, unknown>): void;
  create(ref: FakeDocRef, data: Record<string, unknown>): void;
  delete(ref: FakeDocRef): void;
}
interface FakeQuery {
  where(field: string, op: string, value: unknown): FakeQuery;
  orderBy(field: string, direction?: "asc" | "desc"): FakeQuery;
  limit(n: number): FakeQuery;
  select(...fields: string[]): FakeQuery;
  get(): Promise<{ docs: FakeDocSnap[] }>;
}

class AlreadyExistsError extends Error {
  readonly code = 6;
  constructor() {
    super("ALREADY_EXISTS");
  }
}

function matches(data: Record<string, unknown>, field: string, op: string, value: unknown): boolean {
  const v = field.includes(".")
    ? field.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), data)
    : data[field];
  if (op === "==") return v === value;
  if (op === ">=") return (v as number) >= (value as number);
  if (op === "<") return (v as number) < (value as number);
  if (op === "in") return Array.isArray(value) && (value as unknown[]).includes(v);
  throw new Error(`fake firestore: unsupported op ${op}`);
}

function pickFields(data: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in data) out[f] = data[f];
  return out;
}

interface QueryLogEntry {
  name: string;
  selectFields: string[] | undefined;
}

function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [colName, docs] of Object.entries(seed)) {
    collections.set(colName, new Map(Object.entries(docs)));
  }
  const queryLog: QueryLogEntry[] = [];

  function col(name: string): Map<string, Record<string, unknown>> {
    let c = collections.get(name);
    if (!c) {
      c = new Map();
      collections.set(name, c);
    }
    return c;
  }

  function makeQuery(
    name: string,
    filters: [string, string, unknown][],
    orderField: string | undefined,
    orderDirection: "asc" | "desc" | undefined,
    limitN: number | undefined,
    selectFields: string[] | undefined,
  ): FakeQuery {
    return {
      where(field, op, value) {
        return makeQuery(name, [...filters, [field, op, value]], orderField, orderDirection, limitN, selectFields);
      },
      orderBy(field, direction) {
        return makeQuery(name, filters, field, direction, limitN, selectFields);
      },
      limit(n) {
        return makeQuery(name, filters, orderField, orderDirection, n, selectFields);
      },
      select(...fields) {
        return makeQuery(name, filters, orderField, orderDirection, limitN, fields);
      },
      async get() {
        queryLog.push({ name, selectFields });
        let entries = Array.from(col(name).entries()).filter(([, data]) =>
          filters.every(([f, o, v]) => matches(data, f, o, v)),
        );
        if (orderField) {
          const sign = orderDirection === "desc" ? -1 : 1;
          entries = [...entries].sort((a, b) => {
            const av = a[1][orderField] as number;
            const bv = b[1][orderField] as number;
            return sign * (av - bv);
          });
        }
        if (limitN !== undefined) entries = entries.slice(0, limitN);
        const docs = entries.map(([id, data]) => ({
          id,
          exists: true,
          data: () => (selectFields ? pickFields(data, selectFields) : data),
        }));
        return { docs };
      },
    };
  }

  let autoIdCounter = 0;

  function doc(name: string, id: string): FakeDocRef {
    return {
      id,
      async get() {
        const data = col(name).get(id);
        return { id, exists: data !== undefined, data: () => data };
      },
      async set(data) {
        col(name).set(id, data);
      },
      async create(data) {
        if (col(name).has(id)) throw new AlreadyExistsError();
        col(name).set(id, data);
      },
      async delete() {
        col(name).delete(id);
      },
      _sync: {
        exists() {
          return col(name).has(id);
        },
        write(data) {
          col(name).set(id, data);
        },
        remove() {
          col(name).delete(id);
        },
      },
    };
  }

  function getAllImpl(args: unknown[]): Promise<FakeDocSnap[]> {
    const maybeOptions = args[args.length - 1];
    const hasOptions =
      typeof maybeOptions === "object" &&
      maybeOptions !== null &&
      !("get" in maybeOptions) &&
      "fieldMask" in maybeOptions;
    const refs = (hasOptions ? args.slice(0, -1) : args) as FakeDocRef[];
    const fieldMask = hasOptions ? (maybeOptions as { fieldMask?: string[] }).fieldMask : undefined;
    return Promise.all(refs.map((r) => r.get())).then((snaps) =>
      fieldMask
        ? snaps.map((s) => ({ id: s.id, exists: s.exists, data: () => (s.exists ? pickFields(s.data()!, fieldMask) : undefined) }))
        : snaps,
    );
  }

  const db = {
    collection(name: string) {
      return {
        where(field: string, op: string, value: unknown) {
          return makeQuery(name, [[field, op, value]], undefined, undefined, undefined, undefined);
        },
        orderBy(field: string, direction?: "asc" | "desc") {
          return makeQuery(name, [], field, direction, undefined, undefined);
        },
        select(...fields: string[]) {
          return makeQuery(name, [], undefined, undefined, undefined, fields);
        },
        doc(id?: string) {
          autoIdCounter += 1;
          return doc(name, id ?? `auto-${autoIdCounter}`);
        },
      };
    },
    async runTransaction(fn: (tx: FakeTx) => Promise<unknown>) {
      const tx: FakeTx = {
        get: (ref) => ref.get(),
        getAll: (...args) => getAllImpl(args),
        set: (ref, data) => {
          ref._sync.write(data);
        },
        create: (ref, data) => {
          if (ref._sync.exists()) throw new AlreadyExistsError();
          ref._sync.write(data);
        },
        delete: (ref) => {
          ref._sync.remove();
        },
      };
      return fn(tx);
    },
    async getAll(...args: unknown[]) {
      return getAllImpl(args);
    },
  };

  return { db: db as unknown as Firestore, collections, queryLog };
}

const OUTLET_ID = "o1";
const FOREIGN_OUTLET_ID = "o2";

function makeOutlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET_ID,
    name: "Test Outlet",
    project_kind: "demo",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    retention_days: 14,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSop(overrides: Partial<SopVersion> = {}): SopVersion {
  return {
    outlet_id: OUTLET_ID,
    sop_version_id: `${OUTLET_ID}:v1`,
    version: 1,
    steps: [{ step_id: "stock-01", title: "t", text: "t", role: "staff" }],
    source: "seed",
    source_proposal_id: null,
    created_at_ms: 1,
    ...overrides,
  };
}

function makeConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    outlet_id: OUTLET_ID,
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "c",
    source: "manual",
    source_proposal_id: null,
    created_by_role: "supervisor",
    created_at_ms: 1,
    ...overrides,
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    outlet_id: OUTLET_ID,
    proposal_id: "22222222-2222-4222-8222-222222222222",
    status: "awaiting_supervisor",
    requested_by_role: "supervisor",
    range: { from_date: "2026-10-01", to_date: "2026-10-02" },
    generator: {
      kind: "adk",
      model: "gemini-3.5-flash",
      location: "asia-southeast1",
      agent_version: "proposal-v1",
      gate_version: "pgate-v1",
      library_version: { interventions: 1, rubric: 1 },
      sop_version_id: `${OUTLET_ID}:v1`,
      attempts: 1,
    },
    gate: { passed: true, fired_rule: null, checks: [] },
    counts: { candidate_facts: 2, candidate_dates: 2, constraints: 0 },
    suppression: null,
    content: {
      intervention_id: "change_quantity_time",
      rubric_criterion_ids: ["observable"],
      target_step_id: "stock-01",
      change_title: "t",
      change_text: "c",
      rationale: "r",
      metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 1, baseline_days: 2 },
      failure_condition: "f",
      review_after_days: 7,
      review_date: "2026-10-09",
      evidence: [
        { thread_id: "t1", local_date: "2026-10-01", category: "CUSTOMER_SERVICE", first_line_start_ms: 1 },
        { thread_id: "t2", local_date: "2026-10-02", category: "CUSTOMER_SERVICE", first_line_start_ms: 2 },
      ],
      constraint_ids_acknowledged: [],
      censored_floor: true,
    },
    created_at_ms: 1,
    updated_at_ms: 1,
    ...overrides,
  };
}

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  errorSpy.mockClear();
});

describe("firestoreProposalStore.getOutlet", () => {
  it("returns the parsed outlet doc, or null when absent", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.outlets]: { [OUTLET_ID]: makeOutlet() as unknown as Record<string, unknown> },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    expect((await store.getOutlet())?.outlet_id).toBe(OUTLET_ID);
    const empty = firestoreProposalStore("no-such-outlet", db);
    expect(await empty.getOutlet()).toBeNull();
  });
});

describe("firestoreProposalStore.listThreadsInRange", () => {
  it("selects only the allowed fields — never lines/evidence_line_ids/line_ids", async () => {
    const { db, queryLog } = fakeDb({
      [COLLECTIONS.threads]: {
        t1: {
          outlet_id: OUTLET_ID,
          thread_id: "t1",
          device_id: "d1",
          category: "CUSTOMER_SERVICE",
          status: "fact",
          first_line_start_ms: 10,
          summary: "s",
        },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    await store.listThreadsInRange(0, 100);
    const entry = queryLog.find((q) => q.name === COLLECTIONS.threads);
    expect(entry?.selectFields).toBeDefined();
    for (const forbidden of ["lines", "evidence_line_ids", "line_ids"]) {
      expect(entry?.selectFields).not.toContain(forbidden);
    }
  });

  it("drops a malformed doc, logging only { doc_id, error_class }", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        good: { outlet_id: OUTLET_ID, thread_id: "good", device_id: "d1", category: "CUSTOMER_SERVICE", status: "fact", first_line_start_ms: 10, summary: "s" },
        bad: { outlet_id: OUTLET_ID, thread_id: "bad", first_line_start_ms: 20 }, // missing status/category/summary
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const result = await store.listThreadsInRange(0, 100);
    expect(result.map((r) => r.thread_id)).toEqual(["good"]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[proposal-store] skipping malformed thread doc",
      expect.objectContaining({ doc_id: "bad", error_class: "ZodError" }),
    );
  });
});

describe("firestoreProposalStore.getCurrentSop", () => {
  it("picks the max version", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.sopVersions]: {
        v1: makeSop({ version: 1, sop_version_id: `${OUTLET_ID}:v1` }) as unknown as Record<string, unknown>,
        v3: makeSop({ version: 3, sop_version_id: `${OUTLET_ID}:v3` }) as unknown as Record<string, unknown>,
        v2: makeSop({ version: 2, sop_version_id: `${OUTLET_ID}:v2` }) as unknown as Record<string, unknown>,
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const result = await store.getCurrentSop();
    expect(result?.version).toBe(3);
  });

  it("returns null when none exist", async () => {
    const { db } = fakeDb({});
    const store = firestoreProposalStore(OUTLET_ID, db);
    expect(await store.getCurrentSop()).toBeNull();
  });

  it("drops a foreign-outlet doc from the max pick (defensive — the query already filters by outlet_id)", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.sopVersions]: {
        mine: makeSop({ version: 1 }) as unknown as Record<string, unknown>,
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const result = await store.getCurrentSop();
    expect(result?.version).toBe(1);
  });
});

describe("firestoreProposalStore.listConstraints", () => {
  it("sorts oldest first and drops malformed docs", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.constraints]: {
        c2: makeConstraint({ constraint_id: "11111111-1111-4111-8111-111111111112", created_at_ms: 20 }) as unknown as Record<string, unknown>,
        c1: makeConstraint({ constraint_id: "11111111-1111-4111-8111-111111111111", created_at_ms: 10 }) as unknown as Record<string, unknown>,
        bad: { outlet_id: OUTLET_ID },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const result = await store.listConstraints();
    expect(result.map((c) => c.created_at_ms)).toEqual([10, 20]);
    // Delegates to firestoreConstraintStore (R-08 Task 8.4: one
    // implementation of the constraints query) — the log prefix is now
    // "[constraint-store]", not "[proposal-store]".
    expect(errorSpy).toHaveBeenCalledWith(
      "[constraint-store] skipping malformed constraint doc",
      expect.objectContaining({ doc_id: "bad" }),
    );
  });

  it("caps the result to MAX_CONSTRAINTS (200), even if the store returns more", async () => {
    // Create 201 constraints
    const constraints: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 201; i++) {
      constraints[`c${i}`] = makeConstraint({
        constraint_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
        created_at_ms: i,
      }) as unknown as Record<string, unknown>;
    }
    const { db } = fakeDb({
      [COLLECTIONS.constraints]: constraints,
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const result = await store.listConstraints();
    expect(result).toHaveLength(200);
    expect(result[0]?.created_at_ms).toBe(0);
    expect(result[199]?.created_at_ms).toBe(199);
  });
});

describe("firestoreProposalStore.findOpenProposalForRange", () => {
  it("picks the newest awaiting_* proposal, ignores suppressed/blocked and malformed docs", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposals]: {
        old: makeProposal({ proposal_id: "22222222-2222-4222-8222-222222222221", created_at_ms: 1 }) as unknown as Record<string, unknown>,
        newer: makeProposal({ proposal_id: "22222222-2222-4222-8222-222222222222", created_at_ms: 5 }) as unknown as Record<string, unknown>,
        suppressed: makeProposal({
          proposal_id: "22222222-2222-4222-8222-222222222223",
          status: "suppressed",
          content: null,
          suppression: { reason: "insufficient_evidence", model_reason: null, followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 } },
          created_at_ms: 10,
        }) as unknown as Record<string, unknown>,
        bad: { outlet_id: OUTLET_ID, range: { from_date: "2026-10-01", to_date: "2026-10-02" } },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const result = await store.findOpenProposalForRange("2026-10-01", "2026-10-02");
    expect(result?.proposal_id).toBe("22222222-2222-4222-8222-222222222222");
  });
});

describe("firestoreProposalStore.acquireLock / releaseLock", () => {
  it("acquires when no lock doc exists", async () => {
    const { db } = fakeDb({});
    const store = firestoreProposalStore(OUTLET_ID, db);
    const token = await store.acquireLock(1000, 180_000);
    expect(token).not.toBeNull();
  });

  it("refuses to acquire when a live (non-expired) lock is held", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposalLocks]: {
        [OUTLET_ID]: { outlet_id: OUTLET_ID, lease_token: "33333333-3333-4333-8333-333333333333", acquired_at_ms: 1000, expires_at_ms: 2000 },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const token = await store.acquireLock(1500, 180_000);
    expect(token).toBeNull();
  });

  it("reclaims an expired lock", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposalLocks]: {
        [OUTLET_ID]: { outlet_id: OUTLET_ID, lease_token: "33333333-3333-4333-8333-333333333333", acquired_at_ms: 1000, expires_at_ms: 2000 },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const token = await store.acquireLock(5000, 180_000);
    expect(token).not.toBeNull();
    expect(token).not.toBe("33333333-3333-4333-8333-333333333333");
  });

  it("treats a malformed lock doc as expired and reclaims it", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposalLocks]: {
        [OUTLET_ID]: { outlet_id: OUTLET_ID }, // missing required fields
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const token = await store.acquireLock(1000, 180_000);
    expect(token).not.toBeNull();
  });

  it("release ignores a foreign token (lock untouched)", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.proposalLocks]: {
        [OUTLET_ID]: { outlet_id: OUTLET_ID, lease_token: "33333333-3333-4333-8333-333333333333", acquired_at_ms: 1000, expires_at_ms: 999_999_999 },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    await store.releaseLock("not-the-real-token");
    expect(collections.get(COLLECTIONS.proposalLocks)?.get(OUTLET_ID)).toBeDefined();
  });

  it("release deletes the lock when the token matches", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.proposalLocks]: {
        [OUTLET_ID]: { outlet_id: OUTLET_ID, lease_token: "33333333-3333-4333-8333-333333333333", acquired_at_ms: 1000, expires_at_ms: 999_999_999 },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    await store.releaseLock("33333333-3333-4333-8333-333333333333");
    expect(collections.get(COLLECTIONS.proposalLocks)?.get(OUTLET_ID)).toBeUndefined();
  });

  it("releaseLock never throws, even if the transaction fails", async () => {
    const { db } = fakeDb({});
    (db as unknown as { runTransaction: () => Promise<never> }).runTransaction = () => Promise.reject(new Error("boom"));
    const store = firestoreProposalStore(OUTLET_ID, db);
    await expect(store.releaseLock("any-token")).resolves.toBeUndefined();
  });
});

describe("firestoreProposalStore.commit", () => {
  it("re-reads cited threads inside the transaction and passes them to build", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        t1: { outlet_id: OUTLET_ID, thread_id: "t1", status: "fact", device_id: "d1", category: "CUSTOMER_SERVICE", first_line_start_ms: 1, summary: "s" },
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const captured: { fresh: Map<string, unknown> | null } = { fresh: null };
    const proposal = makeProposal();
    await store.commit(["t1"], (fresh) => {
      captured.fresh = fresh;
      return { proposal, audit: { outlet_id: OUTLET_ID, ts: "2026-10-10T00:00:00.000Z", actor_role: "supervisor", action: "proposal.generated", target_type: "proposal", target_id: proposal.proposal_id } };
    });
    expect(captured.fresh?.get("t1")).toMatchObject({ status: "fact" });
  });

  it("refuses an existing proposal id (tx.create throws)", async () => {
    const existing = makeProposal();
    const { db } = fakeDb({
      [COLLECTIONS.proposals]: { [existing.proposal_id]: existing as unknown as Record<string, unknown> },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    await expect(
      store.commit([], () => ({
        proposal: existing,
        audit: { outlet_id: OUTLET_ID, ts: "2026-10-10T00:00:00.000Z", actor_role: "supervisor", action: "proposal.generated", target_type: "proposal", target_id: existing.proposal_id },
      })),
    ).rejects.toThrow();
  });

  it("drops a malformed or foreign-outlet cited thread, logging only { doc_id, error_class }", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        foreign: { outlet_id: FOREIGN_OUTLET_ID, status: "fact" },
        malformed: {},
      },
    });
    const store = firestoreProposalStore(OUTLET_ID, db);
    const captured: { fresh: Map<string, unknown> | null } = { fresh: null };
    const proposal = makeProposal();
    await store.commit(["foreign", "malformed"], (fresh) => {
      captured.fresh = fresh;
      return { proposal, audit: { outlet_id: OUTLET_ID, ts: "2026-10-10T00:00:00.000Z", actor_role: "supervisor", action: "proposal.generated", target_type: "proposal", target_id: proposal.proposal_id } };
    });
    expect(captured.fresh?.size).toBe(0);
  });
});
