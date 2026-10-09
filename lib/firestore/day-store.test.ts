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
}
interface FakeQuery {
  where(field: string, op: string, value: unknown): FakeQuery;
  orderBy(field: string): FakeQuery;
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

function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>> = {}) {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  for (const [colName, docs] of Object.entries(seed)) {
    collections.set(colName, new Map(Object.entries(docs)));
  }

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
    limitN: number | undefined,
    selectFields: string[] | undefined,
  ): FakeQuery {
    return {
      where(field, op, value) {
        return makeQuery(name, [...filters, [field, op, value]], orderField, limitN, selectFields);
      },
      orderBy(field) {
        return makeQuery(name, filters, field, limitN, selectFields);
      },
      limit(n) {
        return makeQuery(name, filters, orderField, n, selectFields);
      },
      select(...fields) {
        return makeQuery(name, filters, orderField, limitN, fields);
      },
      async get() {
        let entries = Array.from(col(name).entries()).filter(([, data]) =>
          filters.every(([f, o, v]) => matches(data, f, o, v)),
        );
        if (orderField) {
          entries = [...entries].sort((a, b) => {
            const av = a[1][orderField] as number;
            const bv = b[1][orderField] as number;
            return av - bv;
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

  function doc(name: string, id: string): FakeDocRef {
    return {
      id,
      async get() {
        const data = col(name).get(id);
        return { id, exists: data !== undefined, data: () => data };
      },
    };
  }

  const db = {
    collection(name: string) {
      return {
        where(field: string, op: string, value: unknown) {
          return makeQuery(name, [[field, op, value]], undefined, undefined, undefined);
        },
        orderBy(field: string) {
          return makeQuery(name, [], field, undefined, undefined);
        },
        select(...fields: string[]) {
          return makeQuery(name, [], undefined, undefined, fields);
        },
        doc(id: string) {
          return doc(name, id);
        },
      };
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

  return { db: db as unknown as Firestore, collections };
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
