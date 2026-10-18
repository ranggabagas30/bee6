import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreProposalReviewStore } from "@/lib/firestore/proposal-review-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { AuditLog, Constraint, Outlet, Proposal, SopVersion } from "@/lib/firestore/schema";
import type { DecisionSnapshot } from "@/lib/proposals/review-plan";
import { ConflictError } from "@/lib/http/errors";
import { planShip } from "@/lib/sop/ship";
import { proposalV1, seedV1 } from "@/lib/sop/testing/fixtures";

/**
 * Hand-rolled fake Firestore (copied from proposal-store.test.ts, R-09 Task 5.3) — the same technique as
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
const P1 = "22222222-2222-4222-8222-222222222222";
const P2 = "33333333-3333-4333-8333-333333333333";
const P3 = "44444444-4444-4444-8444-444444444444";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "55555555-5555-4555-8555-555555555555";

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

function makeSop(version: number, overrides: Partial<SopVersion> = {}): SopVersion {
  return {
    outlet_id: OUTLET_ID,
    sop_version_id: `${OUTLET_ID}:v${version}`,
    version,
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
    constraint_id: C1,
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
    proposal_id: P1,
    status: "awaiting_supervisor",
    requested_by_role: "supervisor",
    range: { from_date: "2026-10-01", to_date: "2026-10-02" },
    generator: {
      kind: "adk",
      model: "gemini-3.5-flash",
      location: "global",
      agent_version: "proposal-v1",
      gate_version: "pgate-v1",
      library_version: { interventions: 2, rubric: 1 },
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

function threadDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outlet_id: OUTLET_ID,
    thread_id: "t",
    device_id: "SECRET_DEVICE",
    status: "fact",
    summary: "Customers asked for sold-out items.",
    label_source: "model",
    ...overrides,
  };
}

const asDoc = (x: unknown) => x as unknown as Record<string, unknown>;

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  errorSpy.mockClear();
});

describe("firestoreProposalReviewStore.getOutlet", () => {
  it("returns the parsed outlet or null", async () => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: { [OUTLET_ID]: asDoc(makeOutlet()) } });
    expect((await firestoreProposalReviewStore(OUTLET_ID, db).getOutlet())?.outlet_id).toBe(OUTLET_ID);
    expect(await firestoreProposalReviewStore("nope", db).getOutlet()).toBeNull();
  });
});

describe("firestoreProposalReviewStore.listByStatuses (5.S1)", () => {
  it("issues one equality query per status with limit(50) and no orderBy; skips malformed and foreign docs", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposals]: {
        [P1]: asDoc(makeProposal()),
        [P2]: asDoc(makeProposal({ proposal_id: P2, status: "awaiting_supervisor", outlet_id: FOREIGN_OUTLET_ID })),
        [P3]: { outlet_id: OUTLET_ID, status: "awaiting_supervisor", garbage: true },
      },
    });
    const out = await firestoreProposalReviewStore(OUTLET_ID, db).listByStatuses(["awaiting_supervisor", "awaiting_owner"]);
    expect(out.map((p) => p.proposal_id)).toEqual([P1]);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain(P3);
    expect(logged).not.toContain("garbage");
    expect(logged).toContain("ZodError");
  });

  it("builds exactly the two equality filters and limit(50)", async () => {
    const filters: Array<[string, string, unknown]> = [];
    const limits: number[] = [];
    let ordered = false;
    const q = (): Record<string, unknown> => ({
      where: (f: string, o: string, v: unknown) => {
        filters.push([f, o, v]);
        return q();
      },
      orderBy: () => {
        ordered = true;
        return q();
      },
      limit: (n: number) => {
        limits.push(n);
        return q();
      },
      get: async () => ({ docs: [] }),
    });
    const db = { collection: () => q() } as unknown as Firestore;
    await firestoreProposalReviewStore(OUTLET_ID, db).listByStatuses(["approved", "rejected"]);
    expect(filters).toEqual([
      ["outlet_id", "==", OUTLET_ID],
      ["status", "==", "approved"],
      ["outlet_id", "==", OUTLET_ID],
      ["status", "==", "rejected"],
    ]);
    expect(limits).toEqual([50, 50]);
    expect(ordered).toBe(false);
  });
});

describe("firestoreProposalReviewStore.getThreads (5.S2)", () => {
  it("reads with the field mask, drops foreign docs, and does not read for empty ids", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        t1: threadDoc(),
        t2: threadDoc({ outlet_id: FOREIGN_OUTLET_ID }),
      },
    });
    const getAll = vi.spyOn(db, "getAll");
    const store = firestoreProposalReviewStore(OUTLET_ID, db);
    expect((await store.getThreads([])).size).toBe(0);
    expect(getAll).not.toHaveBeenCalled();
    const map = await store.getThreads(["t1", "t2", "t3"]);
    expect([...map.keys()]).toEqual(["t1"]);
    expect(map.get("t1")?.summary).toBe("Customers asked for sold-out items.");
    expect(map.get("t1")?.status).toBe("fact");
    const call = getAll.mock.calls[0]!;
    const opts = call[call.length - 1] as { fieldMask: string[] };
    expect(opts.fieldMask).toEqual(["outlet_id", "status", "excluded_from_evidence", "label_source", "summary"]);
  });
});

describe("sop reads (5.S3)", () => {
  it("getSopVersions drops foreign and malformed; getCurrentSopVersionId returns the highest, null with none", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.sopVersions]: {
        [`${OUTLET_ID}:v1`]: asDoc(makeSop(1)),
        [`${OUTLET_ID}:v2`]: asDoc(makeSop(2)),
        "o2:v1": asDoc(makeSop(1, { outlet_id: FOREIGN_OUTLET_ID, sop_version_id: "o2:v1" })),
        bad: { outlet_id: OUTLET_ID },
      },
    });
    const store = firestoreProposalReviewStore(OUTLET_ID, db);
    const map = await store.getSopVersions([`${OUTLET_ID}:v1`, "o2:v1", "bad", "missing"]);
    expect([...map.keys()]).toEqual([`${OUTLET_ID}:v1`]);
    expect((await store.getSopVersions([])).size).toBe(0);
    expect(await store.getCurrentSopVersionId()).toBe(`${OUTLET_ID}:v2`);
    const empty = fakeDb({});
    expect(await firestoreProposalReviewStore(OUTLET_ID, empty.db).getCurrentSopVersionId()).toBeNull();
  });
});

describe("listConstraints", () => {
  it("returns the outlet's constraints, oldest first", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.constraints]: {
        [C2]: asDoc(makeConstraint({ constraint_id: C2, created_at_ms: 5 })),
        [C1]: asDoc(makeConstraint({ constraint_id: C1, created_at_ms: 2 })),
      },
    });
    const list = await firestoreProposalReviewStore(OUTLET_ID, db).listConstraints();
    expect(list.map((c) => c.constraint_id)).toEqual([C1, C2]);
  });
});

describe("decision snapshot (5.S4, 5.S5)", () => {
  it("5.S4 a missing proposal gives an empty snapshot and no further reads", async () => {
    const { db, queryLog } = fakeDb({});
    const getAll = vi.spyOn(db, "getAll");
    const snap = await firestoreProposalReviewStore(OUTLET_ID, db).readDecisionSnapshot(P1);
    expect(snap).toEqual({
      proposal: null,
      same_range: [],
      fresh: new Map(),
      constraint_ids: [],
      current_sop_version_id: null,
      current_sop: null,
      drafted_sop: null,
    });
    expect(queryLog).toHaveLength(0);
    expect(getAll).not.toHaveBeenCalled();
  });

  it("5.S4 a foreign proposal gives proposal: null", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposals]: { [P1]: asDoc(makeProposal({ outlet_id: FOREIGN_OUTLET_ID })) },
    });
    const snap = await firestoreProposalReviewStore(OUTLET_ID, db).readDecisionSnapshot(P1);
    expect(snap.proposal).toBeNull();
  });

  it("5.S4 a malformed proposal gives proposal: null and logs doc id + error class only", async () => {
    const { db } = fakeDb({ [COLLECTIONS.proposals]: { [P1]: { outlet_id: OUTLET_ID, secret: "xyz" } } });
    const snap = await firestoreProposalReviewStore(OUTLET_ID, db).readDecisionSnapshot(P1);
    expect(snap.proposal).toBeNull();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("ZodError");
    expect(logged).not.toContain("xyz");
  });

  it("5.S5 same_range excludes itself and other ranges; fresh omits a missing thread; constraint ids and current sop", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.proposals]: {
        [P1]: asDoc(makeProposal()),
        [P2]: asDoc(makeProposal({ proposal_id: P2, created_at_ms: 9 })),
        [P3]: asDoc(makeProposal({ proposal_id: P3, range: { from_date: "2026-10-01", to_date: "2026-10-05" } })),
        "foreign-p": asDoc(makeProposal({ proposal_id: "66666666-6666-4666-8666-666666666666", outlet_id: FOREIGN_OUTLET_ID })),
      },
      [COLLECTIONS.threads]: { t1: threadDoc() },
      [COLLECTIONS.constraints]: {
        [C1]: asDoc(makeConstraint()),
        [C2]: asDoc(makeConstraint({ constraint_id: C2, created_at_ms: 2 })),
      },
      [COLLECTIONS.sopVersions]: { [`${OUTLET_ID}:v1`]: asDoc(makeSop(1)), [`${OUTLET_ID}:v3`]: asDoc(makeSop(3)) },
    });
    const snap = await firestoreProposalReviewStore(OUTLET_ID, db).readDecisionSnapshot(P1);
    expect(snap.proposal?.proposal_id).toBe(P1);
    expect(snap.same_range.map((p) => p.proposal_id)).toEqual([P2]);
    expect([...snap.fresh.keys()]).toEqual(["t1"]);
    expect(snap.fresh.get("t1")).toEqual({ status: "fact", label_source: "model" });
    expect(snap.constraint_ids.sort()).toEqual([C1, C2].sort());
    expect(snap.current_sop_version_id).toBe(`${OUTLET_ID}:v3`);
    expect(snap.current_sop?.sop_version_id).toBe(`${OUTLET_ID}:v3`);
    // the proposal was drafted on v1: the snapshot also carries that doc (item 20)
    expect(snap.drafted_sop?.sop_version_id).toBe(`${OUTLET_ID}:v1`);
  });

  it("5.S5b drafted_sop is null when the drafted version doc is missing, malformed or another outlet's", async () => {
    const read = async (versions: Record<string, Record<string, unknown>>) => {
      const { db } = fakeDb({
        [COLLECTIONS.proposals]: { [P1]: asDoc(makeProposal()) },
        [COLLECTIONS.sopVersions]: versions,
      });
      return firestoreProposalReviewStore(OUTLET_ID, db).readDecisionSnapshot(P1);
    };
    // missing: only v3 exists
    const missing = await read({ [`${OUTLET_ID}:v3`]: asDoc(makeSop(3)) });
    expect(missing.drafted_sop).toBeNull();
    expect(missing.current_sop?.version).toBe(3);
    // malformed v1
    const bad = await read({ [`${OUTLET_ID}:v1`]: { nonsense: true }, [`${OUTLET_ID}:v3`]: asDoc(makeSop(3)) });
    expect(bad.drafted_sop).toBeNull();
    // foreign outlet's doc with the same id never counts
    const foreign = await read({
      [`${OUTLET_ID}:v1`]: asDoc(makeSop(1, { outlet_id: FOREIGN_OUTLET_ID })),
      [`${OUTLET_ID}:v3`]: asDoc(makeSop(3)),
    });
    expect(foreign.drafted_sop).toBeNull();
  });
});

describe("transactDecision (5.S6, 5.S7)", () => {
  function seeded() {
    return fakeDb({
      [COLLECTIONS.proposals]: { [P1]: asDoc(makeProposal()) },
      [COLLECTIONS.threads]: { t1: threadDoc(), t2: threadDoc() },
      [COLLECTIONS.sopVersions]: { [`${OUTLET_ID}:v1`]: asDoc(makeSop(1)) },
    });
  }
  const audit: AuditLog = {
    outlet_id: OUTLET_ID,
    ts: "2026-10-11T00:00:00.000Z",
    actor_role: "supervisor",
    action: "proposal.feasible",
    target_type: "proposal",
    target_id: P1,
    details: { from_status: "awaiting_supervisor", to_status: "awaiting_owner", late_constraints_acknowledged: 0 },
  };
  const awaitingOwner = (): Proposal => ({
    ...makeProposal(),
    status: "awaiting_owner",
    supervisor_review: {
      decision: "feasible",
      reason: null,
      constraint_id: null,
      acknowledged_constraint_ids: [],
      decided_at_ms: 5,
    },
    owner_decision: null,
    updated_at_ms: 5,
  });

  it("5.S6 reads through the transaction (not db.getAll) and writes the proposal + audit only when write is non-null", async () => {
    const { db, collections } = seeded();
    const dbGetAll = vi.spyOn(db, "getAll");
    const origRun = db.runTransaction.bind(db);
    const txGetAll = vi.fn();
    const txGet = vi.fn();
    vi.spyOn(db, "runTransaction").mockImplementation(((fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
      origRun((tx: unknown) => {
        const t = tx as { get: (...a: unknown[]) => unknown; getAll: (...a: unknown[]) => unknown };
        return fn({
          ...t,
          get: (...a: unknown[]) => {
            txGet(...a);
            return t.get(...a);
          },
          getAll: (...a: unknown[]) => {
            txGetAll(...a);
            return t.getAll(...a);
          },
        });
      })) as never);
    const store = firestoreProposalReviewStore(OUTLET_ID, db);
    const result = await store.transactDecision(P1, (snap: DecisionSnapshot) => ({
      write: { proposal: awaitingOwner(), audit },
      outcome: snap.proposal?.status,
    }));
    expect(result).toBe("awaiting_supervisor");
    expect(txGet).toHaveBeenCalled();
    expect(txGetAll).toHaveBeenCalledTimes(1);
    expect(dbGetAll).not.toHaveBeenCalled();
    expect((collections.get(COLLECTIONS.proposals)!.get(P1) as Proposal).status).toBe("awaiting_owner");
    expect(collections.get(COLLECTIONS.auditLog)?.size).toBe(1);
  });

  it("5.S6 writes nothing when write is null", async () => {
    const { db, collections } = seeded();
    const out = await firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(P1, () => ({
      write: null,
      outcome: "nothing",
    }));
    expect(out).toBe("nothing");
    expect((collections.get(COLLECTIONS.proposals)!.get(P1) as Proposal).status).toBe("awaiting_supervisor");
    expect(collections.get(COLLECTIONS.auditLog)?.size ?? 0).toBe(0);
  });

  it("5.S6 throws on a proposal id mismatch and writes nothing", async () => {
    const { db, collections } = seeded();
    await expect(
      firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(P1, () => ({
        write: { proposal: { ...awaitingOwner(), proposal_id: P2 }, audit },
        outcome: 1,
      })),
    ).rejects.toThrow(/id mismatch/);
    expect(collections.get(COLLECTIONS.auditLog)?.size ?? 0).toBe(0);
  });

  it("5.S7 the object passed to tx.set has no undefined at any depth", async () => {
    const { db, collections } = seeded();
    await firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(P1, () => ({
      write: { proposal: awaitingOwner(), audit },
      outcome: 1,
    }));
    const stored = collections.get(COLLECTIONS.proposals)!.get(P1);
    const has = (v: unknown): boolean =>
      v === undefined ||
      (Array.isArray(v) ? v.some(has) : v !== null && typeof v === "object" ? Object.values(v).some(has) : false);
    expect(has(stored)).toBe(false);
    expect(has(collections.get(COLLECTIONS.auditLog)!.values().next().value)).toBe(false);
  });
});

describe("transactDecision ships the SOP version (R-10 Task 6)", () => {
  const NOW_MS = Date.parse("2026-10-15T16:30:00Z");
  const owner = (): Proposal => proposalV1() as Proposal;
  const decisionAudit: AuditLog = {
    outlet_id: OUTLET_ID,
    ts: "2026-10-15T16:30:00.000Z",
    actor_role: "owner",
    action: "proposal.approved",
    target_type: "proposal",
    target_id: proposalV1().proposal_id,
    details: { from_status: "awaiting_owner", to_status: "approved", late_constraints_acknowledged: 0 },
  };
  const sopAudit: AuditLog = {
    outlet_id: OUTLET_ID,
    ts: "2026-10-15T16:30:00.000Z",
    actor_role: "owner",
    action: "sop.version_created",
    target_type: "sop_version",
    target_id: `${OUTLET_ID}:v2`,
    details: { version: 2 },
  };
  function v2(): SopVersion {
    const plan = planShip({ current: seedV1(), drafted: seedV1(), proposal: owner(), now_ms: NOW_MS, tz: "Asia/Jakarta" });
    if (plan.kind !== "ship") throw new Error("fixture must ship");
    return plan.sop_version;
  }
  const approvedProposal = (): Proposal => ({ ...owner(), status: "approved", updated_at_ms: NOW_MS });
  const PID = proposalV1().proposal_id;
  function seeded(extra: Record<string, Record<string, unknown>> = {}) {
    return fakeDb({
      [COLLECTIONS.proposals]: { [PID]: asDoc(owner()) },
      [COLLECTIONS.sopVersions]: { [`${OUTLET_ID}:v1`]: asDoc(seedV1()), ...extra },
    });
  }
  /** Records every tx write as [method, ref.id] in call order. */
  function recordTx(db: Firestore) {
    const calls: Array<[string, string]> = [];
    const orig = db.runTransaction.bind(db);
    vi.spyOn(db, "runTransaction").mockImplementation(((fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
      orig((tx: unknown) => {
        const t = tx as Record<string, (...a: unknown[]) => unknown>;
        const wrap = (m: string) => (ref: { id: string }, ...rest: unknown[]) => {
          calls.push([m, ref.id]);
          return t[m]!(ref, ...rest);
        };
        return fn({ ...t, set: wrap("set"), create: wrap("create"), delete: wrap("delete") });
      })) as never);
    return calls;
  }

  /** Runs the callback (so the store sees a SOP write queued), then fails the commit like the real SDK does. */
  function failCommitWith(db: Firestore, err: unknown) {
    const orig = db.runTransaction.bind(db);
    vi.spyOn(db, "runTransaction").mockImplementationOnce((async (fn: (tx: unknown) => Promise<unknown>) => {
      await orig((tx: unknown) => fn(tx) as never);
      throw err;
    }) as never);
  }

  it("6.S1 the snapshot carries current_sop (the highest version) read through the transaction", async () => {
    const { db } = seeded({ [`${OUTLET_ID}:v2`]: asDoc(v2()) });
    const dbGetAll = vi.spyOn(db, "getAll");
    const seen: Array<DecisionSnapshot["current_sop"]> = [];
    await firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, (snap) => {
      seen.push(snap.current_sop);
      return { write: null, outcome: 1 };
    });
    expect(seen[0]?.sop_version_id).toBe(`${OUTLET_ID}:v2`);
    expect(seen[0]?.version).toBe(2);
    expect(dbGetAll).not.toHaveBeenCalled();
  });

  it("6.S2 a write with sop_version: set(proposal), create(audit), create(sop version), create(sop audit) in one runTransaction, never set on sop_versions", async () => {
    const { db, collections } = seeded();
    const calls = recordTx(db);
    await firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, () => ({
      write: { proposal: approvedProposal(), audit: decisionAudit, sop_version: v2(), sop_audit: sopAudit },
      outcome: 1,
    }));
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(calls.map(([m]) => m)).toEqual(["set", "create", "create", "create"]);
    expect(calls[0]).toEqual(["set", PID]);
    expect(calls[2]).toEqual(["create", `${OUTLET_ID}:v2`]);
    expect(calls.filter(([m, id]) => m === "set" && id.includes(":v"))).toHaveLength(0);
    expect(collections.get(COLLECTIONS.sopVersions)!.has(`${OUTLET_ID}:v2`)).toBe(true);
    expect([...collections.get(COLLECTIONS.auditLog)!.values()].map((a) => (a as AuditLog).action)).toEqual([
      "proposal.approved",
      "sop.version_created",
    ]);
  });

  it("6.S2 a write without sop_version touches no sop_versions doc (R-09 behaviour)", async () => {
    const { db, collections } = seeded();
    const calls = recordTx(db);
    await firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, () => ({
      write: { proposal: approvedProposal(), audit: decisionAudit },
      outcome: 1,
    }));
    expect(calls.map(([m]) => m)).toEqual(["set", "create"]);
    expect(collections.get(COLLECTIONS.sopVersions)!.size).toBe(1);
  });

  it("6.S3 create on an existing sop_versions id (numeric code 6) becomes ConflictError SOP_CHANGED", async () => {
    const { db } = seeded({ [`${OUTLET_ID}:v2`]: asDoc(v2()) });
    const err = await firestoreProposalReviewStore(OUTLET_ID, db)
      .transactDecision(PID, () => ({
        write: { proposal: approvedProposal(), audit: decisionAudit, sop_version: v2(), sop_audit: sopAudit },
        outcome: 1,
      }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe("SOP_CHANGED");
    expect((err as ConflictError).statusCode).toBe(409);
  });

  it.each([["already-exists"], ["ALREADY_EXISTS"], [6]])("6.S3 ALREADY_EXISTS shape %s is recognised", async (code) => {
    const { db } = seeded();
    failCommitWith(db, Object.assign(new Error("boom"), { code }));
    await expect(
      firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, () => ({
        write: { proposal: approvedProposal(), audit: decisionAudit, sop_version: v2(), sop_audit: sopAudit },
        outcome: 1,
      })),
    ).rejects.toMatchObject({ code: "SOP_CHANGED" });
  });

  it("6.S3 an unrelated error while shipping is rethrown unchanged", async () => {
    const { db } = seeded();
    const boom = Object.assign(new Error("unavailable"), { code: 14 });
    failCommitWith(db, boom);
    await expect(
      firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, () => ({
        write: { proposal: approvedProposal(), audit: decisionAudit, sop_version: v2(), sop_audit: sopAudit },
        outcome: 1,
      })),
    ).rejects.toBe(boom);
  });

  it("6.S3 ALREADY_EXISTS when no SOP was being shipped is rethrown unchanged", async () => {
    const { db } = seeded();
    const dup = Object.assign(new Error("dup"), { code: 6 });
    vi.spyOn(db, "runTransaction").mockImplementationOnce((async (fn: (tx: unknown) => Promise<unknown>) => {
      await fn({
        get: async (r: { get(): Promise<unknown> }) => r.get(),
        getAll: async () => [],
        set: () => {},
        create: () => {},
      });
      throw dup;
    }) as never);
    await expect(
      firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, () => ({
        write: { proposal: approvedProposal(), audit: decisionAudit },
        outcome: 1,
      })),
    ).rejects.toBe(dup);
  });

  it("6.S4 a sop_version of another outlet throws and nothing is written", async () => {
    const { db, collections } = seeded();
    const foreign = { ...v2(), outlet_id: "o2", sop_version_id: "o2:v2", previous_version_id: "o2:v1" } as SopVersion;
    await expect(
      firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, () => ({
        write: { proposal: approvedProposal(), audit: decisionAudit, sop_version: foreign, sop_audit: sopAudit },
        outcome: 1,
      })),
    ).rejects.toThrow(/sop outlet mismatch/);
    expect(collections.get(COLLECTIONS.sopVersions)!.has("o2:v2")).toBe(false);
    expect(collections.get(COLLECTIONS.auditLog)?.size ?? 0).toBe(0);
  });

  it("6.S4 the SOP version written has no undefined at any depth", async () => {
    const { db, collections } = seeded();
    await firestoreProposalReviewStore(OUTLET_ID, db).transactDecision(PID, () => ({
      write: { proposal: approvedProposal(), audit: decisionAudit, sop_version: v2(), sop_audit: sopAudit },
      outcome: 1,
    }));
    const has = (v: unknown): boolean =>
      v === undefined ||
      (Array.isArray(v) ? v.some(has) : v !== null && typeof v === "object" ? Object.values(v).some(has) : false);
    expect(has(collections.get(COLLECTIONS.sopVersions)!.get(`${OUTLET_ID}:v2`))).toBe(false);
  });
});
