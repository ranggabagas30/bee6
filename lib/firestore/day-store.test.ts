import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreDayStore } from "@/lib/firestore/day-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { evaluateGate } from "@/lib/pipeline/gate";
import type { CaptureSession, Correction, Device, Outlet, Question, Thread } from "@/lib/firestore/schema";

const SAMPLE_GATE = evaluateGate({
  category: "ROUTINE_OPS",
  confidence: 0.95,
  evidence_line_ids: ["s1#0"],
  label_conflict: false,
});

/**
 * Hand-rolled fake Firestore — same technique as `lib/firestore/tick-store.test.ts`,
 * extended with `.orderBy()`, `.limit()`, `.select()` and a top-level
 * `db.getAll(...refs, { fieldMask })`, none of which that file's fake needs.
 * This is NOT the Firestore emulator; it only checks that `firestoreDayStore`
 * calls the Admin SDK surface correctly (field lists, fieldMask, query
 * shape) and applies the same drop/skip rules the plan specifies.
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
  update(patch: Record<string, unknown>): Promise<void>;
}
interface FakeTx {
  get(ref: FakeDocRef): Promise<FakeDocSnap>;
  set(ref: FakeDocRef, data: Record<string, unknown>): void;
  update(ref: FakeDocRef, patch: Record<string, unknown>): void;
}
interface FakeQuery {
  where(field: string, op: string, value: unknown): FakeQuery;
  orderBy(field: string, direction?: "asc" | "desc"): FakeQuery;
  limit(n: number): FakeQuery;
  select(...fields: string[]): FakeQuery;
  get(): Promise<{ docs: FakeDocSnap[] }>;
}

function matches(data: Record<string, unknown>, field: string, op: string, value: unknown): boolean {
  const v = data[field];
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

/** One entry per `.get()` call on a query, recording the field list `.select()` set (tech-lead PR-6 review, finding 1). */
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
      async set(data: Record<string, unknown>) {
        col(name).set(id, data);
      },
      async update(patch: Record<string, unknown>) {
        const existing = col(name).get(id) ?? {};
        col(name).set(id, { ...existing, ...patch });
      },
    };
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
        set: (ref, data) => {
          void ref.set(data);
        },
        update: (ref, patch) => {
          void ref.update(patch);
        },
      };
      return fn(tx);
    },
    async getAll(...args: unknown[]) {
      const maybeOptions = args[args.length - 1];
      const hasOptions =
        typeof maybeOptions === "object" &&
        maybeOptions !== null &&
        !("get" in maybeOptions) &&
        "fieldMask" in maybeOptions;
      const refs = (hasOptions ? args.slice(0, -1) : args) as FakeDocRef[];
      const fieldMask = hasOptions ? (maybeOptions as { fieldMask?: string[] }).fieldMask : undefined;
      const snaps = await Promise.all(refs.map((r) => r.get()));
      if (!fieldMask) return snaps;
      return snaps.map((s) => ({
        id: s.id,
        exists: s.exists,
        data: () => (s.exists ? pickFields(s.data()!, fieldMask) : undefined),
      }));
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
    opening_time: "09:30",
    closing_time: "01:00",
    retention_days: 14,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    outlet_id: OUTLET_ID,
    device_id: "dev-1",
    session_id: "00000000-0000-4000-8000-000000000001",
    started_at_ms: 1_000,
    ended_at_ms: null,
    end_reason: null,
    local_date: "2026-10-08",
    auto_stop_at_ms: 999_999,
    debrief_ends_at_ms: null,
    received_start_at: "2026-10-08T03:00:00.000Z",
    received_end_at: null,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    outlet_id: OUTLET_ID,
    thread_id: "unit_dev-1_w1:0",
    device_id: "dev-1",
    category: "ROUTINE_OPS",
    confidence: 0.95,
    line_ids: ["s1#0"],
    evidence_line_ids: ["s1#0"],
    lines: [{ line_id: "s1#0", start_ms: 1_000, end_ms: 2_000, text: "Checked the oven" }],
    first_line_start_ms: 1_000,
    last_line_end_ms: 2_000,
    summary: "Checked the oven",
    label_conflict: false,
    status: "fact",
    gate: SAMPLE_GATE,
    created_at_ms: 1_000,
    updated_at_ms: 1_000,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    outlet_id: OUTLET_ID,
    question_id: "q_thread_unit_dev-1_w1:0",
    device_id: "dev-1",
    thread_id: "unit_dev-1_w1:0",
    kind: "gate",
    status: "open",
    category: "ROUTINE_OPS",
    window_start_ms: 1_000,
    window_end_ms: 2_000,
    created_at_ms: 1_000,
    ...overrides,
  };
}

function makeCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    outlet_id: OUTLET_ID,
    correction_id: "q_thread_unit_dev-1_w1:0",
    question_id: "q_thread_unit_dev-1_w1:0",
    thread_id: "unit_dev-1_w1:0",
    answer: "yes",
    reason_text: "Because of X",
    answered_device_id: "dev-1",
    debrief_business_date: "2026-10-08",
    answered_at_ms: 1_000,
    received_at_ms: 1_000,
    needs_supervisor_confirm: false,
    expires_at: "2026-10-22T00:00:00.000Z",
    created_at: "2026-10-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    outlet_id: OUTLET_ID,
    device_id: "dev-1",
    label: "Front counter phone",
    token_hash: "hash",
    paired_at: "2026-09-01T00:00:00.000Z",
    revoked: false,
    pairing_code: null,
    pairing_code_expires_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("firestoreDayStore.getOutlet", () => {
  it("returns the parsed outlet doc", async () => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: { [OUTLET_ID]: makeOutlet() } });
    const store = firestoreDayStore(OUTLET_ID, db);
    await expect(store.getOutlet()).resolves.toEqual(makeOutlet());
  });

  it("returns null when the outlet doc is missing", async () => {
    const { db } = fakeDb();
    const store = firestoreDayStore(OUTLET_ID, db);
    await expect(store.getOutlet()).resolves.toBeNull();
  });
});

describe("firestoreDayStore.listSessions", () => {
  it("filters by outlet and local_date, and skips malformed docs", async () => {
    const good = makeSession({ local_date: "2026-10-08" });
    const foreign = makeSession({ outlet_id: FOREIGN_OUTLET_ID, local_date: "2026-10-08" });
    const malformed = { outlet_id: OUTLET_ID, local_date: "2026-10-08" }; // missing required fields
    const { db } = fakeDb({
      [COLLECTIONS.captureSessions]: { s1: good, s2: foreign, s3: malformed },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const result = await store.listSessions(["2026-10-08"]);
    expect(result).toEqual([good]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("capture_session"),
      expect.objectContaining({ doc_id: "s3", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });

  it("returns an empty array without querying when dates is empty", async () => {
    const { db } = fakeDb({ [COLLECTIONS.captureSessions]: { s1: makeSession() } });
    const store = firestoreDayStore(OUTLET_ID, db);
    await expect(store.listSessions([])).resolves.toEqual([]);
  });
});

describe("firestoreDayStore.listThreads", () => {
  it("the owner (withText:false) field list never includes lines or evidence_line_ids", async () => {
    const t = makeThread();
    const { db } = fakeDb({ [COLLECTIONS.threads]: { t1: t } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listThreads(0, 10_000, { withText: false, limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("lines");
    expect(rows[0]).not.toHaveProperty("evidence_line_ids");
    expect(rows[0]).toMatchObject({ thread_id: "unit_dev-1_w1:0", category: "ROUTINE_OPS" });
  });

  it("the supervisor (withText:true) field list includes lines and evidence_line_ids", async () => {
    const t = makeThread();
    const { db } = fakeDb({ [COLLECTIONS.threads]: { t1: t } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listThreads(0, 10_000, { withText: true, limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lines).toEqual(t.lines);
    expect(rows[0]!.evidence_line_ids).toEqual(t.evidence_line_ids);
  });

  it("the supervisor field list includes runner_up (Task 11); the owner list does not", async () => {
    const t = makeThread({ runner_up: { category: "CUSTOMER_SERVICE", why_not: "RUNUP-SENTINEL-1" } });
    const { db } = fakeDb({ [COLLECTIONS.threads]: { t1: t } });
    const store = firestoreDayStore(OUTLET_ID, db);

    const supervisorRows = await store.listThreads(0, 10_000, { withText: true, limit: 100 });
    expect(supervisorRows[0]!.runner_up).toEqual(t.runner_up);

    const ownerRows = await store.listThreads(0, 10_000, { withText: false, limit: 100 });
    expect(ownerRows[0]).not.toHaveProperty("runner_up");
  });

  it("filters by first_line_start_ms range (inclusive start, exclusive end)", async () => {
    const inRange = makeThread({ thread_id: "in", first_line_start_ms: 5_000 });
    const atStart = makeThread({ thread_id: "at-start", first_line_start_ms: 1_000 });
    const atEnd = makeThread({ thread_id: "at-end", first_line_start_ms: 10_000 });
    const { db } = fakeDb({
      [COLLECTIONS.threads]: { a: inRange, b: atStart, c: atEnd },
    });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listThreads(1_000, 10_000, { withText: false, limit: 100 });
    expect(rows.map((r) => r.thread_id).sort()).toEqual(["at-start", "in"]);
  });

  it("skips malformed thread docs and logs only doc_id/error_class", async () => {
    const malformed = { outlet_id: OUTLET_ID, thread_id: "bad", first_line_start_ms: 1_000 };
    const { db } = fakeDb({ [COLLECTIONS.threads]: { bad: malformed } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listThreads(0, 10_000, { withText: false, limit: 100 });
    expect(rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("thread"),
      expect.objectContaining({ doc_id: "bad", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });
});

describe("firestoreDayStore.getQuestions / getCorrections", () => {
  it("getQuestions drops a missing id, a malformed doc, and a foreign-outlet doc", async () => {
    const good = makeQuestion({ question_id: "q1" });
    const foreign = makeQuestion({ question_id: "q2", outlet_id: FOREIGN_OUTLET_ID });
    const malformed = { outlet_id: OUTLET_ID }; // missing required fields
    const { db } = fakeDb({
      [COLLECTIONS.questions]: { q1: good, q2: foreign, q3: malformed },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const result = await store.getQuestions(["q1", "q2", "q3", "q-missing"]);
    expect(result.size).toBe(1);
    expect(result.get("q1")).toMatchObject({ question_id: "q1" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("question"),
      expect.objectContaining({ doc_id: "q3", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });

  it("getQuestions never requests answered_by/any staff field (the question schema itself carries none)", async () => {
    const good = makeQuestion({ question_id: "q1", status: "answered", answer: "yes", answered_at_ms: 1_000 });
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: good } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const result = await store.getQuestions(["q1"]);
    expect(Object.keys(result.get("q1")!).sort()).toEqual(["answer", "outlet_id", "question_id", "status"].sort());
  });

  it("getCorrections reads reason_text but never answered_device_id", async () => {
    const good = makeCorrection({ question_id: "q1" });
    const { db } = fakeDb({ [COLLECTIONS.corrections]: { q1: good } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const result = await store.getCorrections(["q1"]);
    expect(result.get("q1")).toEqual({
      outlet_id: OUTLET_ID,
      question_id: "q1",
      answer: "yes",
      reason_text: "Because of X",
      debrief_business_date: "2026-10-08",
    });
    expect(result.get("q1")).not.toHaveProperty("answered_device_id");
  });

  it("returns an empty map without reading when ids is empty", async () => {
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: makeQuestion() } });
    const store = firestoreDayStore(OUTLET_ID, db);
    await expect(store.getQuestions([])).resolves.toEqual(new Map());
  });

  it("chunks more than 100 ids into multiple getAll calls", async () => {
    const seed: Record<string, Record<string, unknown>> = {};
    const ids: string[] = [];
    for (let i = 0; i < 150; i++) {
      const id = `q${i}`;
      ids.push(id);
      seed[id] = makeQuestion({ question_id: id });
    }
    const { db } = fakeDb({ [COLLECTIONS.questions]: seed });
    const getAllSpy = vi.spyOn(db, "getAll");
    const store = firestoreDayStore(OUTLET_ID, db);
    const result = await store.getQuestions(ids);
    expect(result.size).toBe(150);
    expect(getAllSpy).toHaveBeenCalledTimes(2); // 100 + 50
  });
});

describe("firestoreDayStore.listUnlabelledQuestions (R-06 Task 12)", () => {
  function makeUnlabelled(overrides: Partial<Question> = {}): Question {
    return makeQuestion({
      question_id: "q_unit_1",
      thread_id: null,
      kind: "unlabelled_unit",
      category: null,
      status: "open",
      window_start_ms: 5_000,
      window_end_ms: 7_000,
      ...overrides,
    });
  }

  it("filters by kind and window_start_ms range (inclusive start, exclusive end), ordered ascending", async () => {
    const inRange = makeUnlabelled({ question_id: "in", window_start_ms: 5_000 });
    const atStart = makeUnlabelled({ question_id: "at-start", window_start_ms: 1_000 });
    const atEnd = makeUnlabelled({ question_id: "at-end", window_start_ms: 10_000 });
    const gateQuestion = makeQuestion({ question_id: "gate-1", kind: "gate", window_start_ms: 5_000 });
    const { db } = fakeDb({
      [COLLECTIONS.questions]: { a: inRange, b: atStart, c: atEnd, d: gateQuestion },
    });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(1_000, 10_000, 100);
    expect(rows.map((r) => r.question_id)).toEqual(["at-start", "in"]);
  });

  it("the row carries no thread_id/category and maps answer null when unset", async () => {
    const q = makeUnlabelled({ question_id: "q1" });
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: q } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(rows).toEqual([
      {
        outlet_id: OUTLET_ID,
        question_id: "q1",
        device_id: "dev-1",
        status: "open",
        answer: null,
        window_start_ms: 5_000,
        window_end_ms: 7_000,
      },
    ]);
  });

  it("maps a real answer through", async () => {
    const q = makeUnlabelled({
      question_id: "q1",
      status: "answered",
      answer: "yes",
      answered_at_ms: 9_000,
    });
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: q } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(rows[0]!.status).toBe("answered");
    expect(rows[0]!.answer).toBe("yes");
  });

  it("drops a foreign-outlet row and a non-unlabelled kind, defensively (the query already filters both)", async () => {
    const foreign = makeUnlabelled({ question_id: "foreign", outlet_id: FOREIGN_OUTLET_ID });
    const gate = makeQuestion({ question_id: "gate-1", kind: "gate" });
    const { db } = fakeDb({
      [COLLECTIONS.questions]: { a: foreign, b: gate },
    });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(rows).toEqual([]);
  });

  it("skips a malformed doc and logs only doc_id/error_class", async () => {
    // Carries `kind: "unlabelled_unit"` and an in-range `window_start_ms` so
    // it passes the query's own filters and actually reaches the schema
    // parse (the other missing required fields fail there).
    const malformed = {
      outlet_id: OUTLET_ID,
      question_id: "bad",
      kind: "unlabelled_unit",
      window_start_ms: 5_000,
    };
    const { db } = fakeDb({ [COLLECTIONS.questions]: { bad: malformed } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unlabelled_question"),
      expect.objectContaining({ doc_id: "bad", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });

  it("the kind filter runs before the limit (not just the store's own defensive check)", async () => {
    // Three `gate` docs (early window_start_ms, so they would win a plain
    // ordered+limited query) plus one `unlabelled_unit` doc. If the store's
    // query ever dropped `.where("kind", "==", "unlabelled_unit")`, these
    // gate docs would satisfy `limit=1` before the unlabelled row is ever
    // reached — the store's own post-parse `kind` check only drops rows
    // AFTER the query already returned them, so it would see zero rows here.
    const gate1 = makeQuestion({ question_id: "gate-1", kind: "gate", window_start_ms: 100 });
    const gate2 = makeQuestion({ question_id: "gate-2", kind: "gate", window_start_ms: 200 });
    const gate3 = makeQuestion({ question_id: "gate-3", kind: "gate", window_start_ms: 300 });
    const unl = makeUnlabelled({ question_id: "unl-1", window_start_ms: 5_000 });
    const { db } = fakeDb({ [COLLECTIONS.questions]: { a: gate1, b: gate2, c: gate3, d: unl } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 1);
    expect(rows.map((r) => r.question_id)).toEqual(["unl-1"]);
  });

  it("respects the limit parameter", async () => {
    const u1 = makeUnlabelled({ question_id: "u1", window_start_ms: 1_000 });
    const u2 = makeUnlabelled({ question_id: "u2", window_start_ms: 2_000 });
    const u3 = makeUnlabelled({ question_id: "u3", window_start_ms: 3_000 });
    const { db } = fakeDb({ [COLLECTIONS.questions]: { a: u1, b: u2, c: u3 } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 2);
    expect(rows.map((r) => r.question_id)).toEqual(["u1", "u2"]);
  });

  it("selects exactly the UNLABELLED_QUESTION_FIELDS field list", async () => {
    const q = makeUnlabelled({ question_id: "q1" });
    const { db, queryLog } = fakeDb({ [COLLECTIONS.questions]: { q1: q } });
    const store = firestoreDayStore(OUTLET_ID, db);
    await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(queryLog).toHaveLength(1);
    expect(queryLog[0]!.name).toBe(COLLECTIONS.questions);
    expect(queryLog[0]!.selectFields).toEqual([
      "outlet_id",
      "question_id",
      "device_id",
      "kind",
      "status",
      "answer",
      "answered_at_ms",
      "window_start_ms",
      "window_end_ms",
    ]);
  });

  it("skips an inconsistent doc: status answered with no answered_at_ms (the reverse direction) and logs by doc id only", async () => {
    // The other direction of the inconsistency rule — `status: "answered"`
    // but missing `answered_at_ms` — is not covered by the existing
    // open-with-an-answer-set case below.
    const inconsistent = {
      outlet_id: OUTLET_ID,
      question_id: "q2",
      device_id: "dev-1",
      kind: "unlabelled_unit",
      status: "answered",
      answer: "yes",
      window_start_ms: 5_000,
      window_end_ms: 7_000,
      // no answered_at_ms
    };
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q2: inconsistent } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unlabelled_question"),
      expect.objectContaining({ doc_id: "q2", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });

  it("skips an inconsistent answered doc (answer set but status not answered) and logs by doc id only", async () => {
    // Build the raw doc by hand — `makeUnlabelled`/`QuestionSchema` would
    // themselves reject this shape; the store must survive a corrupted doc
    // that got written some other way.
    const inconsistent = {
      outlet_id: OUTLET_ID,
      question_id: "q1",
      device_id: "dev-1",
      kind: "unlabelled_unit",
      status: "open",
      answer: "yes",
      window_start_ms: 5_000,
      window_end_ms: 7_000,
    };
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: inconsistent } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unlabelled_question"),
      expect.objectContaining({ doc_id: "q1", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });

  it("the returned row shape matches DayUnlabelledRow exactly (no thread_id/category — the field mask never selects them)", async () => {
    const q = makeUnlabelled({ question_id: "q1" });
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: q } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listUnlabelledQuestions(0, 100_000, 100);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["outlet_id", "question_id", "device_id", "status", "answer", "window_start_ms", "window_end_ms"].sort(),
    );
  });
});

describe("firestoreDayStore.countPairedDevices", () => {
  it("counts only paired, unrevoked devices of this outlet", async () => {
    const paired = makeDevice({ device_id: "d1" });
    const unpaired = makeDevice({ device_id: "d2", paired_at: null });
    const revoked = makeDevice({ device_id: "d3", revoked: true });
    const foreign = makeDevice({ device_id: "d4", outlet_id: FOREIGN_OUTLET_ID });
    const { db } = fakeDb({
      [COLLECTIONS.devices]: { d1: paired, d2: unpaired, d3: revoked, d4: foreign },
    });
    const store = firestoreDayStore(OUTLET_ID, db);
    await expect(store.countPairedDevices()).resolves.toBe(1);
  });
});

describe("firestoreDayStore.listAnsweredGateQuestions (R-06 Task 13.2)", () => {
  it("filters to this outlet's answered gate questions at/after sinceMs, newest first, at most limit", async () => {
    const gateAnswered = makeQuestion({
      question_id: "q1",
      kind: "gate",
      status: "answered",
      answer: "yes",
      answered_at_ms: 5_000,
    });
    const tooOld = makeQuestion({
      question_id: "q2",
      kind: "gate",
      status: "answered",
      answer: "yes",
      answered_at_ms: 1_000,
    });
    const stillOpen = makeQuestion({ question_id: "q3", kind: "gate", status: "open" });
    const unlabelledUnit = makeQuestion({
      question_id: "q4",
      kind: "unlabelled_unit",
      status: "answered",
      answer: "yes",
      answered_at_ms: 6_000,
      thread_id: null,
      category: null,
    });
    const foreign = makeQuestion({
      question_id: "q5",
      outlet_id: FOREIGN_OUTLET_ID,
      kind: "gate",
      status: "answered",
      answer: "yes",
      answered_at_ms: 7_000,
    });
    const newer = makeQuestion({
      question_id: "q6",
      kind: "gate",
      status: "answered",
      answer: "no",
      answered_at_ms: 9_000,
    });
    const { db } = fakeDb({
      [COLLECTIONS.questions]: {
        q1: gateAnswered,
        q2: tooOld,
        q3: stillOpen,
        q4: unlabelledUnit,
        q5: foreign,
        q6: newer,
      },
    });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listAnsweredGateQuestions(2_000, 10);
    expect(rows.map((r) => r.question_id)).toEqual(["q6", "q1"]); // newest first
    expect(rows[0]).toEqual({
      outlet_id: OUTLET_ID,
      question_id: "q6",
      thread_id: "unit_dev-1_w1:0",
      answer: "no",
      answered_at_ms: 9_000,
    });
  });

  it("applies the limit", async () => {
    const seed: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 5; i++) {
      seed[`q${i}`] = makeQuestion({
        question_id: `q${i}`,
        kind: "gate",
        status: "answered",
        answer: "yes",
        answered_at_ms: 1_000 + i,
      });
    }
    const { db } = fakeDb({ [COLLECTIONS.questions]: seed });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listAnsweredGateQuestions(0, 3);
    expect(rows).toHaveLength(3);
  });

  it("drops and logs (by doc id only) a doc with a null thread_id, a non yes/no answer, or a non-numeric answered_at_ms", async () => {
    // `thread_id: null` only happens for kind: "unlabelled_unit" in practice,
    // but the query already filters to kind: "gate" — this exercises the
    // defensive drop in case a doc is ever inconsistent with its own kind.
    const nullThread = {
      outlet_id: OUTLET_ID,
      question_id: "q1",
      device_id: "dev-1",
      thread_id: null,
      kind: "gate",
      status: "answered",
      category: "ROUTINE_OPS",
      window_start_ms: 1_000,
      window_end_ms: 2_000,
      created_at_ms: 1_000,
      answer: "yes",
      answered_at_ms: 5_000,
    };
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: nullThread } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listAnsweredGateQuestions(0, 10);
    expect(rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("question"),
      expect.objectContaining({ doc_id: "q1", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });

  it("the returned row never carries device_id or kind", async () => {
    const good = makeQuestion({
      question_id: "q1",
      kind: "gate",
      status: "answered",
      answer: "yes",
      answered_at_ms: 5_000,
    });
    const { db } = fakeDb({ [COLLECTIONS.questions]: { q1: good } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const rows = await store.listAnsweredGateQuestions(0, 10);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ["outlet_id", "question_id", "thread_id", "answer", "answered_at_ms"].sort(),
    );
  });
});

describe("firestoreDayStore.getThreads (R-06 Task 13.2)", () => {
  it("reads the supervisor field mask, including lines and runner_up", async () => {
    const t = makeThread({ runner_up: { category: "CUSTOMER_SERVICE", why_not: "RUNUP-SENTINEL-Q" } });
    const { db } = fakeDb({ [COLLECTIONS.threads]: { [t.thread_id]: t } });
    const store = firestoreDayStore(OUTLET_ID, db);
    const result = await store.getThreads([t.thread_id]);
    expect(result.get(t.thread_id)!.lines).toEqual(t.lines);
    expect(result.get(t.thread_id)!.evidence_line_ids).toEqual(t.evidence_line_ids);
    expect(result.get(t.thread_id)!.runner_up).toEqual(t.runner_up);
  });

  it("drops a missing id, a malformed doc, and a foreign-outlet doc", async () => {
    const good = makeThread({ thread_id: "t1" });
    const foreign = makeThread({ thread_id: "t2", outlet_id: FOREIGN_OUTLET_ID });
    const { db } = fakeDb({ [COLLECTIONS.threads]: { t1: good, t2: foreign, t3: { outlet_id: OUTLET_ID } } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = firestoreDayStore(OUTLET_ID, db);
    const result = await store.getThreads(["t1", "t2", "t3", "t-missing"]);
    expect(result.size).toBe(1);
    expect(result.get("t1")).toMatchObject({ thread_id: "t1" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("thread"),
      expect.objectContaining({ doc_id: "t3", error_class: "ZodError" }),
    );
    errorSpy.mockRestore();
  });
});

describe("firestoreDayStore.transactConfirm (R-06 Task 10.6)", () => {
  const THREAD_ID = "unit_dev-1_w1:0";
  const QUESTION_ID = "q_thread_unit_dev-1_w1:0";

  it("writes the thread patch with tx.update and one audit_log doc only on a write plan", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.threads]: { [THREAD_ID]: makeThread({ status: "open" }) },
      [COLLECTIONS.questions]: { [QUESTION_ID]: makeQuestion({ status: "answered", answer: "yes", answered_at_ms: 1_500 }) },
    });
    const store = firestoreDayStore(OUTLET_ID, db);

    const plan = await store.transactConfirm(THREAD_ID, QUESTION_ID, (snap) => {
      expect(snap.thread).not.toBeNull();
      expect(snap.question).not.toBeNull();
      return {
        kind: "write",
        thread_patch: { status: "fact", label_source: "supervisor_confirmed" },
        audit: {
          actor_role: "supervisor",
          action: "thread.supervisor_confirm",
          target_type: "thread",
          target_id: THREAD_ID,
          details: { from_category: "ROUTINE_OPS", to_category: "ROUTINE_OPS", previous_status: "open", was_excluded: false },
        },
        response: { result: "confirmed", category: "ROUTINE_OPS", display_status: "fact_supervisor_confirmed" },
      };
    });

    expect(plan.kind).toBe("write");
    const storedThread = collections.get(COLLECTIONS.threads)?.get(THREAD_ID);
    expect(storedThread).toMatchObject({ status: "fact", label_source: "supervisor_confirmed" });

    const auditDocs = Array.from(collections.get(COLLECTIONS.auditLog)?.values() ?? []);
    expect(auditDocs).toHaveLength(1);
    expect(auditDocs[0]).toMatchObject({
      outlet_id: OUTLET_ID,
      actor_role: "supervisor",
      action: "thread.supervisor_confirm",
      target_id: THREAD_ID,
    });
  });

  it("writes nothing on every other plan kind", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.threads]: { [THREAD_ID]: makeThread({ status: "open" }) },
      [COLLECTIONS.questions]: { [QUESTION_ID]: makeQuestion({ status: "answered", answer: "yes", answered_at_ms: 1_500 }) },
    });
    const store = firestoreDayStore(OUTLET_ID, db);

    for (const result of [
      { kind: "not_found" as const },
      { kind: "not_reviewable" as const },
      { kind: "gate_blocked" as const, fired_rule: "no_evidence" as const },
      {
        kind: "unchanged" as const,
        response: { result: "unchanged" as const, category: "ROUTINE_OPS" as const, display_status: "fact_supervisor_confirmed" as const },
      },
    ]) {
      const plan = await store.transactConfirm(THREAD_ID, QUESTION_ID, () => result);
      expect(plan).toEqual(result);
    }

    const storedThread = collections.get(COLLECTIONS.threads)?.get(THREAD_ID);
    expect(storedThread).toEqual(makeThread({ status: "open" }));
    expect(collections.get(COLLECTIONS.auditLog)?.size ?? 0).toBe(0);
  });

  it("a malformed thread doc -> snapshot thread: null", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: { [THREAD_ID]: { outlet_id: OUTLET_ID } }, // missing every required field
      [COLLECTIONS.questions]: { [QUESTION_ID]: makeQuestion({ status: "answered", answer: "yes", answered_at_ms: 1_500 }) },
    });
    const store = firestoreDayStore(OUTLET_ID, db);

    let sawThread: unknown = "not-set";
    await store.transactConfirm(THREAD_ID, QUESTION_ID, (snap) => {
      sawThread = snap.thread;
      return { kind: "not_found" };
    });
    expect(sawThread).toBeNull();
  });

  it("a missing thread doc -> snapshot thread: null, question: null", async () => {
    const { db } = fakeDb({});
    const store = firestoreDayStore(OUTLET_ID, db);

    let snapSeen: { thread: unknown; question: unknown } | null = null;
    await store.transactConfirm(THREAD_ID, QUESTION_ID, (snap) => {
      snapSeen = snap;
      return { kind: "not_found" };
    });
    expect(snapSeen).toEqual({ thread: null, question: null });
  });
});
