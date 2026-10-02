import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { evaluateGate } from "@/lib/pipeline/gate";
import { segmentDocId } from "@/lib/capture/segment-types";
import type { Device, Staff, Segment, Question, LabelUnitLedger } from "@/lib/firestore/schema";
import type { ThreadWrite } from "@/lib/pipeline/tick/types";

const SAMPLE_GATE = evaluateGate({
  category: "ROUTINE_OPS",
  confidence: 0.95,
  evidence_line_ids: ["s1#0"],
  label_conflict: false,
});

/**
 * Hand-rolled fake Firestore — same technique as
 * `lib/firestore/stores.segment.test.ts`, extended with `.where()` query
 * filtering and `.runTransaction()` (neither exists in that file's fake),
 * since `firestoreTickStore` is the first store to need either. This is
 * NOT the Firestore emulator — no part of R-05b has been verified against
 * a live or emulated Firestore; this fake only checks that the store calls
 * the Admin SDK surface correctly, matching the rest of this codebase's
 * existing testing convention for this layer.
 */
interface FakeDocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface FakeTx {
  get(ref: FakeDocRef): Promise<FakeDocSnap>;
  set(ref: FakeDocRef, data: Record<string, unknown>): void;
  update(ref: FakeDocRef, patch: Record<string, unknown>): void;
  delete(ref: FakeDocRef): void;
}
interface FakeDocRef {
  id: string;
  get(): Promise<FakeDocSnap>;
  create(data: Record<string, unknown>): Promise<void>;
  set(data: Record<string, unknown>): Promise<void>;
  update(patch: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
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
  if (op === ">=") return (v as number) >= (value as number);
  if (op === "in") return Array.isArray(value) && (value as unknown[]).includes(v);
  throw new Error(`fake firestore: unsupported op ${op}`);
}

/** Loosens a concrete fixture type to the plain-object shape the fake store keeps internally. */
function asDoc(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
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

  function query(name: string, filters: [string, string, unknown][]) {
    return {
      where(field: string, op: string, value: unknown) {
        return query(name, [...filters, [field, op, value]]);
      },
      async get() {
        const entries = Array.from(col(name).entries()).filter(([, data]) =>
          filters.every(([f, o, v]) => matches(data, f, o, v)),
        );
        return { docs: entries.map(([id, data]) => ({ id, data: () => data, exists: true })) };
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
      async create(data) {
        if (col(name).has(id)) throw new AlreadyExistsError();
        col(name).set(id, data);
      },
      async set(data) {
        col(name).set(id, data);
      },
      async update(patch) {
        const existing = col(name).get(id) ?? {};
        col(name).set(id, { ...existing, ...patch });
      },
      async delete() {
        col(name).delete(id);
      },
    };
  }

  const db = {
    collection(name: string) {
      return {
        where(field: string, op: string, value: unknown) {
          return query(name, [[field, op, value]]);
        },
        doc(id: string) {
          return doc(name, id);
        },
        async get() {
          return query(name, []).get();
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
        delete: (ref) => {
          void ref.delete();
        },
      };
      return fn(tx);
    },
  };

  return { db: db as unknown as Firestore, collections };
}

const OUTLET = "outlet-1";
const DEVICE = "dev-1";

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    outlet_id: OUTLET,
    device_id: DEVICE,
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

function makeStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    outlet_id: OUTLET,
    staff_id: "staff-1",
    name: "Dina Putri",
    name_key: "dina putri",
    role: "staff",
    pin_hash: "hash",
    failed_attempts: 0,
    locked_until: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    outlet_id: OUTLET,
    device_id: DEVICE,
    seg_id: "s1",
    received_at: "2026-09-30T10:00:15.000Z",
    device_start: "2026-09-30T10:00:00.000Z",
    device_end: "2026-09-30T10:00:15.000Z",
    model: "gemini-3.5-transcribe-preview",
    location: "global",
    lines: [
      { text: "Checked the oven", start: 0, end: 3 },
      { text: "Dina, tolong ambil egg tart", start: 3, end: 6 },
    ],
    expires_at: "2026-10-02T10:00:15.000Z",
    ...overrides,
  };
}

function makeThread(overrides: Partial<ThreadWrite> = {}): ThreadWrite {
  return {
    outlet_id: OUTLET,
    device_id: DEVICE,
    thread_id: "t1",
    category: "ROUTINE_OPS",
    confidence: 0.95,
    line_ids: ["s1#0"],
    evidence_line_ids: ["s1#0"],
    lines: [{ line_id: "s1#0", start_ms: 0, end_ms: 3000, text: "Checked the oven" }],
    first_line_start_ms: 0,
    last_line_end_ms: 3000,
    summary: "Checked the oven",
    label_conflict: false,
    status: "fact",
    gate: SAMPLE_GATE,
    created_at_ms: 1000,
    updated_at_ms: 1000,
    ...overrides,
  };
}

describe("firestoreTickStore.listActiveDevices", () => {
  it("includes only paired, non-revoked devices", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.devices]: {
        "o1:d1": makeDevice(),
        "o1:d2": makeDevice({ device_id: "d2", revoked: true }),
        "o1:d3": makeDevice({ device_id: "d3", paired_at: null }),
      },
    });
    const result = await firestoreTickStore(db).listActiveDevices();
    expect(result).toEqual([{ outlet_id: OUTLET, device_id: DEVICE }]);
  });
});

describe("firestoreTickStore.listStaffScrubNames", () => {
  it("returns the full name AND its first token, deduplicated", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.staff]: {
        s1: makeStaff({ name: "Dina Putri" }),
        s2: makeStaff({ staff_id: "staff-2", name: "Dina" }), // first token already covered
      },
    });
    const result = await firestoreTickStore(db).listStaffScrubNames(OUTLET);
    expect(new Set(result)).toEqual(new Set(["Dina Putri", "Dina"]));
  });

  it("scopes to the given outlet only", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.staff]: {
        s1: makeStaff({ outlet_id: "other-outlet", name: "Budi" }),
      },
    });
    const result = await firestoreTickStore(db).listStaffScrubNames(OUTLET);
    expect(result).toEqual([]);
  });
});

describe("firestoreTickStore.listSegmentsForDevice", () => {
  it("converts a Timestamp expires_at back to ISO and scopes by outlet+device", async () => {
    const seg = makeSegment();
    const { db } = fakeDb({
      [COLLECTIONS.segments]: {
        [segmentDocId({ outlet_id: OUTLET, device_id: DEVICE, seg_id: "s1" })]: {
          ...seg,
          expires_at: Timestamp.fromDate(new Date(seg.expires_at)),
        },
        [segmentDocId({ outlet_id: OUTLET, device_id: "d2", seg_id: "s2" })]: {
          ...makeSegment({ device_id: "d2", seg_id: "s2" }),
          expires_at: Timestamp.fromDate(new Date()),
        },
      },
    });
    const result = await firestoreTickStore(db).listSegmentsForDevice(OUTLET, DEVICE);
    expect(result).toEqual([
      {
        seg_id: "s1",
        device_start: seg.device_start,
        device_end: seg.device_end,
        received_at: seg.received_at,
        lines: seg.lines,
      },
    ]);
  });
});

describe("firestoreTickStore.listLabelledLineIds", () => {
  it("aggregates line_ids from done AND failed ledger rows, ignoring pending", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.labelUnits]: {
        u1: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: ["s1#0"], status: "done", attempts: 1, labelled_at_ms: 1000 },
        u2: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u2", line_ids: ["s2#0"], status: "failed", attempts: 3, labelled_at_ms: null },
        u3: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u3", line_ids: ["s3#0"], status: "pending", attempts: 0, labelled_at_ms: null },
      } satisfies Record<string, LabelUnitLedger>,
    });
    const result = await firestoreTickStore(db).listLabelledLineIds(OUTLET, DEVICE);
    expect(result).toEqual(new Set(["s1#0", "s2#0"]));
  });
});

describe("firestoreTickStore.listRecentThreads / getStoredThread", () => {
  it("listRecentThreads filters by last_line_end_ms >= sinceMs", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        t1: asDoc(makeThread({ thread_id: "t1", last_line_end_ms: 5000 })),
        t2: asDoc(makeThread({ thread_id: "t2", last_line_end_ms: 500 })),
      },
    });
    const result = await firestoreTickStore(db).listRecentThreads(OUTLET, DEVICE, 1000);
    expect(result).toEqual([{ thread_id: "t1", category: "ROUTINE_OPS", last_line_end_ms: 5000 }]);
  });

  it("getStoredThread returns null for a missing doc or an outlet mismatch", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        t1: asDoc(makeThread({ thread_id: "t1", outlet_id: "other-outlet" })),
      },
    });
    const store = firestoreTickStore(db);
    expect(await store.getStoredThread(OUTLET, "missing")).toBeNull();
    expect(await store.getStoredThread(OUTLET, "t1")).toBeNull(); // outlet mismatch
  });

  it("getStoredThread returns the full thread when found and outlet matches", async () => {
    const thread = makeThread({ thread_id: "t1" });
    const { db } = fakeDb({ [COLLECTIONS.threads]: { t1: asDoc(thread) } });
    const result = await firestoreTickStore(db).getStoredThread(OUTLET, "t1");
    expect(result).toEqual({
      thread_id: thread.thread_id,
      category: thread.category,
      confidence: thread.confidence,
      line_ids: thread.line_ids,
      evidence_line_ids: thread.evidence_line_ids,
      lines: thread.lines,
      first_line_start_ms: thread.first_line_start_ms,
      last_line_end_ms: thread.last_line_end_ms,
      summary: thread.summary,
      fields: thread.fields,
      runner_up: thread.runner_up,
      status: thread.status,
      created_at_ms: thread.created_at_ms,
    });
  });
});

describe("firestoreTickStore.acquireLease / releaseLease", () => {
  it("acquires when no lease exists, refuses while held and not expired, re-acquires once expired", async () => {
    const { db } = fakeDb();
    const store = firestoreTickStore(db);

    expect(await store.acquireLease(OUTLET, DEVICE, 1000, 110_000)).toBe(true);
    // Still held, well before expiry.
    expect(await store.acquireLease(OUTLET, DEVICE, 2000, 110_000)).toBe(false);
    // Past the first lease's expires_at_ms (1000 + 110_000 = 111_000).
    expect(await store.acquireLease(OUTLET, DEVICE, 200_000, 110_000)).toBe(true);
  });

  it("releaseLease deletes the lease so a later acquire succeeds immediately", async () => {
    const { db } = fakeDb();
    const store = firestoreTickStore(db);
    await store.acquireLease(OUTLET, DEVICE, 1000, 110_000);
    await store.releaseLease(OUTLET, DEVICE);
    expect(await store.acquireLease(OUTLET, DEVICE, 1500, 110_000)).toBe(true);
  });
});

describe("firestoreTickStore.writeUnitResult", () => {
  it("writes thread + question + ledger docs and blanks only the targeted line in its source segment", async () => {
    const seg = makeSegment();
    const segDocId = segmentDocId({ outlet_id: OUTLET, device_id: DEVICE, seg_id: "s1" });
    const { db, collections } = fakeDb({
      [COLLECTIONS.segments]: {
        [segDocId]: { ...seg, expires_at: Timestamp.fromDate(new Date(seg.expires_at)) },
      },
    });
    const store = firestoreTickStore(db);

    const thread: ThreadWrite = makeThread({ thread_id: "t1" });
    const question: Question = {
      outlet_id: OUTLET,
      device_id: DEVICE,
      question_id: "q1",
      thread_id: "t1",
      kind: "gate",
      status: "open",
      category: "ROUTINE_OPS",
      window_start_ms: 0,
      window_end_ms: 3000,
      created_at_ms: 1000,
    };

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [thread],
      questions: [question],
      ledger: {
        outlet_id: OUTLET,
        device_id: DEVICE,
        unit_key: "unit_dev-1_w_s1",
        line_ids: ["s1#1"],
        status: "done",
        attempts: 1,
        labelled_at_ms: 2000,
      },
      blank_line_ids: ["s1#1"], // the "Dina, tolong ambil egg tart" line — non-work/private
    });

    expect(collections.get(COLLECTIONS.threads)?.get("t1")).toEqual(thread);
    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toEqual(question);
    expect(collections.get(COLLECTIONS.labelUnits)?.get("unit_dev-1_w_s1")).toMatchObject({ status: "done" });

    const storedSegment = collections.get(COLLECTIONS.segments)?.get(segDocId);
    const lines = storedSegment?.lines as { text: string; start: number; end: number }[];
    expect(lines[0]).toEqual({ text: "Checked the oven", start: 0, end: 3 }); // untouched
    expect(lines[1]).toEqual({ text: "", start: 3, end: 6 }); // blanked, timing kept (count-only)
  });

  it("silently skips blanking when the source segment is already gone (TTL-expired mid-flight)", async () => {
    const { db, collections } = fakeDb(); // no segments seeded at all
    const store = firestoreTickStore(db);

    await expect(
      store.writeUnitResult(OUTLET, DEVICE, {
        threads: [],
        questions: [],
        ledger: {
          outlet_id: OUTLET,
          device_id: DEVICE,
          unit_key: "unit_x",
          line_ids: ["s1#0"],
          status: "done",
          attempts: 1,
          labelled_at_ms: 2000,
        },
        blank_line_ids: ["s1#0"],
      }),
    ).resolves.toBeUndefined();

    expect(collections.get(COLLECTIONS.labelUnits)?.get("unit_x")).toMatchObject({ status: "done" });
  });

  it("writes nothing when any document fails zod validation (fails closed, before the transaction opens)", async () => {
    const { db, collections } = fakeDb();
    const store = firestoreTickStore(db);

    await expect(
      store.writeUnitResult(OUTLET, DEVICE, {
        threads: [makeThread({ confidence: Number.NaN })], // invalid — NaN is not a valid confidence
        questions: [],
        ledger: {
          outlet_id: OUTLET,
          device_id: DEVICE,
          unit_key: "unit_bad",
          line_ids: [],
          status: "done",
          attempts: 1,
          labelled_at_ms: 2000,
        },
        blank_line_ids: [],
      }),
    ).rejects.toBeTruthy();

    expect(collections.get(COLLECTIONS.labelUnits)?.get("unit_bad")).toBeUndefined();
  });
});
