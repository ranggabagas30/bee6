import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestoreTickStore } from "@/lib/firestore/tick-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deviceDocId } from "@/lib/firestore/stores";
import { evaluateGate } from "@/lib/pipeline/gate";
import { segmentDocId } from "@/lib/capture/segment-types";
import type { Device, Staff, Segment, LabelUnitLedger } from "@/lib/firestore/schema";
import type { ThreadWrite, QuestionWrite } from "@/lib/pipeline/tick/types";

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
  /** Collection name (lets `getAll`/`batch` resolve a ref back to its collection). */
  collectionName: string;
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

/** Applies an update patch the way Firestore does: a `FieldValue.delete()` value removes the key. */
function applyPatch(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete next[key];
    else next[key] = value;
  }
  return next;
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

  /** Size (op count) of every committed write batch. */
  const batchSizes: number[] = [];
  /** Every `.get()` of a query, so a test can assert which queries ran and with what shape. */
  const queryLog: Array<{ collection: string; filters: [string, string, unknown][]; select: string[] | null }> = [];
  /** Every patch sent to a doc `update` (a transaction's `update` included), so a test can assert its exact keys. */
  const updateLog: Array<{ collection: string; id: string; patch: Record<string, unknown> }> = [];

  function query(name: string, filters: [string, string, unknown][], limitN?: number, selectFields?: string[]) {
    return {
      where(field: string, op: string, value: unknown) {
        return query(name, [...filters, [field, op, value]], limitN, selectFields);
      },
      limit(n: number) {
        return query(name, filters, n, selectFields);
      },
      select(...fields: string[]) {
        return query(name, filters, limitN, fields);
      },
      async get() {
        queryLog.push({ collection: name, filters, select: selectFields ?? null });
        let entries = Array.from(col(name).entries()).filter(([, data]) =>
          filters.every(([f, o, v]) => matches(data, f, o, v)),
        );
        if (limitN !== undefined) entries = entries.slice(0, limitN);
        const project = (data: Record<string, unknown>) =>
          selectFields ? Object.fromEntries(selectFields.filter((f) => f in data).map((f) => [f, data[f]])) : data;
        return { docs: entries.map(([id, data]) => ({ id, data: () => project(data), exists: true, ref: doc(name, id) })), empty: entries.length === 0, size: entries.length };
      },
    };
  }

  function doc(name: string, id: string): FakeDocRef {
    return {
      id,
      collectionName: name,
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
        updateLog.push({ collection: name, id, patch });
        const existing = col(name).get(id) ?? {};
        col(name).set(id, applyPatch(existing, patch));
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
    async getAll(...args: unknown[]) {
      const refs = args.filter((a): a is FakeDocRef => typeof a === "object" && a !== null && "collectionName" in a);
      return refs.map((ref) => {
        const data = col(ref.collectionName).get(ref.id);
        return { id: ref.id, exists: data !== undefined, data: () => data, ref };
      });
    },
    batch() {
      const ops: Array<() => void> = [];
      const b = {
        delete(ref: FakeDocRef) {
          ops.push(() => col(ref.collectionName).delete(ref.id));
          return b;
        },
        set(ref: FakeDocRef, data: Record<string, unknown>) {
          ops.push(() => col(ref.collectionName).set(ref.id, data));
          return b;
        },
        update(ref: FakeDocRef, patch: Record<string, unknown>) {
          ops.push(() => {
            const existing = col(ref.collectionName).get(ref.id);
            if (!existing) throw new Error("NOT_FOUND");
            col(ref.collectionName).set(ref.id, { ...existing, ...patch });
          });
          return b;
        },
        async commit() {
          batchSizes.push(ops.length);
          for (const op of ops) op();
        },
      };
      return b;
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

  return { db: db as unknown as Firestore, collections, queryLog, batchSizes, updateLog };
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

describe("firestoreTickStore.listActiveDevices: expired demo judge devices (R-12 M6)", () => {
  const NOW = Date.UTC(2026, 9, 28, 10, 0, 0);

  it("skips a device whose expires_at_ms has passed (<= now): no labelling spend for an expired sandbox", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const { db } = fakeDb({
        [COLLECTIONS.devices]: {
          "o1:live": makeDevice({ device_id: "live", expires_at_ms: NOW + 1 }),
          "o1:edge": makeDevice({ device_id: "edge", expires_at_ms: NOW }),
          "o1:past": makeDevice({ device_id: "past", expires_at_ms: NOW - 1 }),
          "o1:shop": makeDevice({ device_id: "shop" }), // a real shop phone has no expiry
        },
      });
      const ids = (await firestoreTickStore(db).listActiveDevices()).map((d) => d.device_id).sort();
      expect(ids).toEqual(["live", "shop"]);
    } finally {
      vi.useRealTimers();
    }
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

describe("firestoreTickStore.getOutletTz (DebriefAgent: the SAME tz the read path uses)", () => {
  it("returns the outlet's timezone", async () => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: { [OUTLET]: asDoc({ timezone: "Asia/Makassar" }) } });
    expect(await firestoreTickStore(db).getOutletTz(OUTLET)).toBe("Asia/Makassar");
  });

  it.each([
    ["a missing outlet doc", {}],
    ["a malformed timezone", { [OUTLET]: asDoc({ timezone: 7 }) }],
    ["an empty timezone", { [OUTLET]: asDoc({ timezone: "" }) }],
  ])("falls back to Asia/Jakarta on %s", async (_name, docs) => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: docs });
    expect(await firestoreTickStore(db).getOutletTz(OUTLET)).toBe("Asia/Jakarta");
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
        session_id: null,
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
      label_conflict: thread.label_conflict,
      status: thread.status,
      created_at_ms: thread.created_at_ms,
    });
  });
});

describe("firestoreTickStore.acquireLease / releaseLease", () => {
  it("acquires when no lease exists (returning the acquisition's own acquired_at_ms), refuses while held and not expired, re-acquires once expired", async () => {
    const { db } = fakeDb();
    const store = firestoreTickStore(db);

    expect(await store.acquireLease(OUTLET, DEVICE, 1000, 110_000)).toBe(1000);
    // Still held, well before expiry.
    expect(await store.acquireLease(OUTLET, DEVICE, 2000, 110_000)).toBeNull();
    // Past the first lease's expires_at_ms (1000 + 110_000 = 111_000).
    expect(await store.acquireLease(OUTLET, DEVICE, 200_000, 110_000)).toBe(200_000);
  });

  it("[tech-lead re-review, finding 1] a malformed lock doc is treated as expired (logging only the error class) and gets reacquired instead of permanently blocking the device", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.pipelineLocks]: {
        [`${OUTLET}:${DEVICE}`]: { outlet_id: OUTLET, device_id: DEVICE }, // missing acquired_at_ms/expires_at_ms
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = firestoreTickStore(db);

    const token = await store.acquireLease(OUTLET, DEVICE, 1000, 110_000);
    expect(token).toBe(1000); // reacquired, not permanently blocked

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toMatch(/acquired_at_ms/i);
    errorSpy.mockRestore();

    // The overwritten lock is now well-formed and genuinely held.
    expect(await store.acquireLease(OUTLET, DEVICE, 1500, 110_000)).toBeNull();
  });

  it("releaseLease deletes the lease (given its own token) so a later acquire succeeds immediately", async () => {
    const { db } = fakeDb();
    const store = firestoreTickStore(db);
    const token = await store.acquireLease(OUTLET, DEVICE, 1000, 110_000);
    await store.releaseLease(OUTLET, DEVICE, token!);
    expect(await store.acquireLease(OUTLET, DEVICE, 1500, 110_000)).toBe(1500);
  });

  it("[tech-lead review round 2, finding 2] releaseLease only deletes the lease if it still holds the acquisition's own token — a stale release from an expired acquisition never deletes a later tick's lease", async () => {
    const { db } = fakeDb();
    const store = firestoreTickStore(db);

    const firstToken = await store.acquireLease(OUTLET, DEVICE, 1000, 100); // expires at 1100
    expect(firstToken).toBe(1000);

    // The first lease has since expired; a second tick acquires fresh.
    const secondToken = await store.acquireLease(OUTLET, DEVICE, 5000, 100); // expires at 5100
    expect(secondToken).toBe(5000);

    // The first tick's finally-release call, using its own (now-stale) token — must be a no-op.
    await store.releaseLease(OUTLET, DEVICE, firstToken!);

    // The second tick's lease is still held.
    expect(await store.acquireLease(OUTLET, DEVICE, 5050, 100)).toBeNull();

    // Releasing with the correct (second) token does free it.
    await store.releaseLease(OUTLET, DEVICE, secondToken!);
    expect(await store.acquireLease(OUTLET, DEVICE, 5060, 100)).not.toBeNull();
  });
});

describe("firestoreTickStore malformed-doc resilience (tech-lead review round 2, finding 7)", () => {
  it("listSegmentsForDevice skips a malformed segment doc (logging only the error class) and still returns the valid ones", async () => {
    const seg = makeSegment();
    const { db } = fakeDb({
      [COLLECTIONS.segments]: {
        [segmentDocId({ outlet_id: OUTLET, device_id: DEVICE, seg_id: "s1" })]: {
          ...seg,
          expires_at: Timestamp.fromDate(new Date(seg.expires_at)),
        },
        [segmentDocId({ outlet_id: OUTLET, device_id: DEVICE, seg_id: "bad" })]: {
          outlet_id: OUTLET,
          device_id: DEVICE,
          seg_id: "bad",
          // missing every other required field — fails SegmentSchema
        },
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await firestoreTickStore(db).listSegmentsForDevice(OUTLET, DEVICE);
    expect(result).toHaveLength(1);
    expect(result[0]!.seg_id).toBe("s1");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toMatch(/checked the oven/i); // never the raw doc
    errorSpy.mockRestore();
  });

  it("listLabelledLineIds skips a malformed ledger doc and still aggregates the valid ones", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.labelUnits]: {
        u1: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: ["s1#0"], status: "done", attempts: 1, labelled_at_ms: 1000 },
        bad: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "bad", status: "done" }, // missing line_ids/attempts/labelled_at_ms
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await firestoreTickStore(db).listLabelledLineIds(OUTLET, DEVICE);
    expect(result).toEqual(new Set(["s1#0"]));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("listRecentThreads skips a malformed thread doc and still returns the valid ones", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        t1: asDoc(makeThread({ thread_id: "t1", last_line_end_ms: 5000 })),
        bad: { outlet_id: OUTLET, device_id: DEVICE, last_line_end_ms: 6000 }, // missing thread_id/category/etc.
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await firestoreTickStore(db).listRecentThreads(OUTLET, DEVICE, 1000);
    expect(result).toEqual([{ thread_id: "t1", category: "ROUTINE_OPS", last_line_end_ms: 5000 }]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
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
    const question: QuestionWrite = {
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

  it("R-07 (Task 5.2): a missing question is created, exactly as before", async () => {
    const { db, collections } = fakeDb();
    const store = firestoreTickStore(db);
    const question: QuestionWrite = {
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
      threads: [],
      questions: [question],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });
    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toEqual(question);
  });

  it("R-07 (Task 5.2): an existing OPEN question is updated (category/window) but never reopened, and created_at_ms is kept", async () => {
    const existing = asDoc({
      outlet_id: OUTLET,
      device_id: DEVICE,
      question_id: "q1",
      thread_id: "t1",
      kind: "gate",
      status: "open",
      category: "ROUTINE_OPS",
      window_start_ms: 0,
      window_end_ms: 3000,
      created_at_ms: 1000, // must survive the continuation unchanged
    });
    const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: existing } });
    const store = firestoreTickStore(db);

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [],
      questions: [
        {
          outlet_id: OUTLET,
          device_id: DEVICE,
          question_id: "q1",
          thread_id: "t1",
          kind: "gate",
          status: "open",
          category: "CUSTOMER_SERVICE", // the continuation's own (possibly new) category
          window_start_ms: 0,
          window_end_ms: 9000, // the continuation extends the window
          created_at_ms: 9999, // a blind tx.set would wrongly push this forward
        },
      ],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({
      category: "CUSTOMER_SERVICE",
      window_start_ms: 0,
      window_end_ms: 9000,
      created_at_ms: 1000, // unchanged
      status: "open",
    });
  });

  describe("DebriefAgent wording on an existing OPEN question (docs/tasks/debrief-agent-18oct.md §5.2)", () => {
    const AGENT = {
      version: "debrief-q-v1" as const,
      model: "gemini-3.5-flash-lite" as const,
      category: "CUSTOMER_SERVICE" as const,
      start_hm: "14:05",
      question_en: "Around 14:05, did a customer ask about the egg tarts?",
      rounds: 1,
      generated_at_ms: 5000,
    };
    const OLD_AGENT = { ...AGENT, category: "ROUTINE_OPS" as const, question_en: "Around 14:05, was the oven checked this morning?" };
    const openDoc = (extra: Record<string, unknown> = {}) =>
      asDoc({
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
        ...extra,
      });
    const incoming = (over: Partial<QuestionWrite> = {}): QuestionWrite => ({
      outlet_id: OUTLET,
      device_id: DEVICE,
      question_id: "q1",
      thread_id: "t1",
      kind: "gate",
      status: "open",
      category: "ROUTINE_OPS",
      window_start_ms: 0,
      window_end_ms: 9000,
      created_at_ms: 9999,
      ...over,
    });
    const write = (store: ReturnType<typeof firestoreTickStore>, q: QuestionWrite) =>
      store.writeUnitResult(OUTLET, DEVICE, {
        threads: [],
        questions: [q],
        ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
        blank_line_ids: [],
      });

    it("same category and no new agent: the stored agent is left untouched", async () => {
      const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: openDoc({ agent: OLD_AGENT }) } });
      await write(firestoreTickStore(db), incoming());
      expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({ window_end_ms: 9000, agent: OLD_AGENT });
    });

    it("category changed and no new agent: the stale agent is DELETED", async () => {
      const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: openDoc({ agent: OLD_AGENT }) } });
      await write(firestoreTickStore(db), incoming({ category: "CUSTOMER_SERVICE" }));
      const doc = collections.get(COLLECTIONS.questions)?.get("q1");
      expect(doc).toMatchObject({ category: "CUSTOMER_SERVICE", created_at_ms: 1000 });
      expect("agent" in doc!).toBe(false);
    });

    it("category changed and a new agent: the new agent replaces the old one", async () => {
      const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: openDoc({ agent: OLD_AGENT }) } });
      await write(firestoreTickStore(db), incoming({ category: "CUSTOMER_SERVICE", agent: AGENT }));
      expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({ category: "CUSTOMER_SERVICE", agent: AGENT });
    });

    it("an agent on the incoming write is written even when the category did not change", async () => {
      const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: openDoc() } });
      await write(firestoreTickStore(db), incoming({ agent: { ...AGENT, category: "ROUTINE_OPS" } }));
      expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({ agent: { category: "ROUTINE_OPS" } });
    });

    it("pilot byte-identity: a category change on a question that never had an agent sends NO agent key at all", async () => {
      const { db, updateLog } = fakeDb({ [COLLECTIONS.questions]: { q1: openDoc() } });
      await write(firestoreTickStore(db), incoming({ category: "CUSTOMER_SERVICE" }));
      const questionUpdate = updateLog.find((u) => u.collection === COLLECTIONS.questions);
      expect(questionUpdate?.patch).toEqual({ category: "CUSTOMER_SERVICE", window_start_ms: 0, window_end_ms: 9000 });
    });

    it("a NEW question carries the agent object on the create", async () => {
      const { db, collections } = fakeDb();
      await write(firestoreTickStore(db), incoming({ agent: AGENT }));
      expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({ agent: AGENT });
    });

    it("an answered question is never touched, agent or not", async () => {
      const existing = openDoc({ status: "answered", answer: "yes", answered_at_ms: 5000, agent: OLD_AGENT });
      const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: existing } });
      await write(firestoreTickStore(db), incoming({ category: "CUSTOMER_SERVICE", agent: AGENT }));
      expect(collections.get(COLLECTIONS.questions)?.get("q1")).toEqual(existing);
    });
  });

  it("R-07 (Task 5.2): an ANSWERED question is never reopened by a later tick write", async () => {
    const existing = asDoc({
      outlet_id: OUTLET,
      device_id: DEVICE,
      question_id: "q1",
      thread_id: "t1",
      kind: "gate",
      status: "answered",
      answer: "yes",
      answered_at_ms: 5000,
      category: "ROUTINE_OPS",
      window_start_ms: 0,
      window_end_ms: 3000,
      created_at_ms: 1000,
    });
    const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: existing } });
    const store = firestoreTickStore(db);

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [],
      questions: [
        {
          outlet_id: OUTLET,
          device_id: DEVICE,
          question_id: "q1",
          thread_id: "t1",
          kind: "gate",
          status: "open",
          category: "CUSTOMER_SERVICE",
          window_start_ms: 0,
          window_end_ms: 9000,
          created_at_ms: 1000,
        },
      ],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toEqual(existing);
  });

  it("R-07 (Task 5.2): an UNVERIFIED question is never reopened by a later tick write", async () => {
    const existing = asDoc({
      outlet_id: OUTLET,
      device_id: DEVICE,
      question_id: "q1",
      thread_id: "t1",
      kind: "gate",
      status: "unverified",
      expired_by_debrief_end_ms: 5000,
      category: "ROUTINE_OPS",
      window_start_ms: 0,
      window_end_ms: 3000,
      created_at_ms: 1000,
    });
    const { db, collections } = fakeDb({ [COLLECTIONS.questions]: { q1: existing } });
    const store = firestoreTickStore(db);

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [],
      questions: [
        {
          outlet_id: OUTLET,
          device_id: DEVICE,
          question_id: "q1",
          thread_id: "t1",
          kind: "gate",
          status: "open",
          category: "CUSTOMER_SERVICE",
          window_start_ms: 0,
          window_end_ms: 9000,
          created_at_ms: 1000,
        },
      ],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toEqual(existing);
  });

  it("R-07 (Task 5.2): a staff_confirmed thread keeps its staff fields (and status 'fact') on a later continuation", async () => {
    const existing = asDoc({
      ...makeThread({ thread_id: "t1", status: "fact" }),
      label_source: "staff_confirmed",
      confirmed_category: "CUSTOMER_SERVICE",
    });
    const { db, collections } = fakeDb({ [COLLECTIONS.threads]: { t1: existing } });
    const store = firestoreTickStore(db);

    const continuation = makeThread({
      thread_id: "t1",
      status: "open", // the tick's own fresh gate call, re-opened by new evidence
      category: "ROUTINE_OPS", // a later unit's own label — the staff decision still stands
      confidence: 0.5,
      lines: [{ line_id: "s1#1", start_ms: 3000, end_ms: 6000, text: "more lines" }],
    });

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [continuation],
      questions: [],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    const stored = collections.get(COLLECTIONS.threads)?.get("t1");
    expect(stored).toMatchObject({
      status: "fact",
      label_source: "staff_confirmed",
      confirmed_category: "CUSTOMER_SERVICE",
      gate: existing.gate, // the staff decision's own gate, not the tick's fresh one
      // new lines still merge in:
      lines: continuation.lines,
      confidence: continuation.confidence,
    });
  });

  it("R-06 (Task 10.3): a supervisor_confirmed thread keeps its supervisor fields (and status 'fact') on a later continuation", async () => {
    const existing = asDoc({
      ...makeThread({ thread_id: "t1", status: "fact" }),
      label_source: "supervisor_confirmed",
      confirmed_category: "COMPLAINT",
      excluded_from_evidence: false,
    });
    const { db, collections } = fakeDb({ [COLLECTIONS.threads]: { t1: existing } });
    const store = firestoreTickStore(db);

    const continuation = makeThread({
      thread_id: "t1",
      status: "open", // the tick's own fresh gate call, re-opened by new evidence
      category: "ROUTINE_OPS", // a later unit's own label — the supervisor decision still stands
      confidence: 0.5,
      lines: [{ line_id: "s1#1", start_ms: 3000, end_ms: 6000, text: "more lines" }],
    });

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [continuation],
      questions: [],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    const stored = collections.get(COLLECTIONS.threads)?.get("t1");
    expect(stored).toMatchObject({
      status: "fact",
      label_source: "supervisor_confirmed",
      confirmed_category: "COMPLAINT",
      excluded_from_evidence: false,
      gate: existing.gate, // the supervisor decision's own gate, not the tick's fresh one
      // new lines still merge in:
      lines: continuation.lines,
      confidence: continuation.confidence,
    });
  });

  it("R-06 (Task 15.2): a supervisor_rejected thread keeps status 'open' and the flag on a later continuation, even against a fresh v1 fact", async () => {
    const existing = asDoc({
      ...makeThread({ thread_id: "t1", status: "open" }),
      label_source: "supervisor_rejected",
      excluded_from_evidence: true,
    });
    const { db, collections } = fakeDb({ [COLLECTIONS.threads]: { t1: existing } });
    const store = firestoreTickStore(db);

    const continuation = makeThread({
      thread_id: "t1",
      status: "fact", // the tick's own fresh gate call: a v1 fact
      confidence: 0.99,
      lines: [{ line_id: "s1#1", start_ms: 3000, end_ms: 6000, text: "more lines" }],
    });

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [continuation],
      questions: [],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    const stored = collections.get(COLLECTIONS.threads)?.get("t1");
    expect(stored).toMatchObject({
      status: "open", // carried over, never promoted to fact
      label_source: "supervisor_rejected",
      excluded_from_evidence: true,
      gate: existing.gate,
      lines: continuation.lines,
      confidence: continuation.confidence,
    });
  });

  it("R-07 (Task 5.2): a NO-rejected (excluded_from_evidence) thread keeps that flag on a later continuation", async () => {
    const existing = asDoc({
      ...makeThread({ thread_id: "t1", status: "open" }),
      label_source: "model",
      excluded_from_evidence: true,
    });
    const { db, collections } = fakeDb({ [COLLECTIONS.threads]: { t1: existing } });
    const store = firestoreTickStore(db);

    const continuation = makeThread({ thread_id: "t1", status: "fact", confidence: 0.99 });

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [continuation],
      questions: [],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    const stored = collections.get(COLLECTIONS.threads)?.get("t1");
    expect(stored).toMatchObject({
      status: "open", // carried over, never promoted to fact under a staff NO
      excluded_from_evidence: true,
      label_source: "model",
    });
  });

  it("R-07 (Task 5.2): an ordinary (model, not excluded) thread is written plainly, as before", async () => {
    const existing = asDoc(makeThread({ thread_id: "t1", status: "open" }));
    const { db, collections } = fakeDb({ [COLLECTIONS.threads]: { t1: existing } });
    const store = firestoreTickStore(db);

    const continuation = makeThread({ thread_id: "t1", status: "fact", confidence: 0.99 });

    await store.writeUnitResult(OUTLET, DEVICE, {
      threads: [continuation],
      questions: [],
      ledger: { outlet_id: OUTLET, device_id: DEVICE, unit_key: "u1", line_ids: [], status: "done", attempts: 1, labelled_at_ms: 2000 },
      blank_line_ids: [],
    });

    expect(collections.get(COLLECTIONS.threads)?.get("t1")).toEqual(continuation);
  });
});

describe("firestoreTickStore.getLastEnded (R-07)", () => {
  it("returns the device's last_ended", async () => {
    const lastEnded = {
      business_date: "2026-10-07",
      end_reason: "selesai" as const,
      ended_at_ms: 1000,
      debrief_ends_at_ms: 5000,
    };
    const { db } = fakeDb({ [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: asDoc(makeDevice({ last_ended: lastEnded })) } });
    expect(await firestoreTickStore(db).getLastEnded(OUTLET, DEVICE)).toEqual(lastEnded);
  });

  it("returns null when the device has no last_ended", async () => {
    const { db } = fakeDb({ [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: asDoc(makeDevice()) } });
    expect(await firestoreTickStore(db).getLastEnded(OUTLET, DEVICE)).toBeNull();
  });

  it("returns null when the device doc does not exist", async () => {
    const { db } = fakeDb();
    expect(await firestoreTickStore(db).getLastEnded(OUTLET, DEVICE)).toBeNull();
  });
});

describe("firestoreTickStore.expireOpenQuestions (R-07)", () => {
  function makeOpenQuestion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      outlet_id: OUTLET,
      device_id: DEVICE,
      question_id: "q1",
      thread_id: null,
      kind: "unlabelled_unit",
      status: "open",
      category: null,
      window_start_ms: 0,
      window_end_ms: 1000,
      created_at_ms: 1000,
      ...overrides,
    };
  }

  const E = 5000;

  it("expires an open question created before E, and returns the count", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: { q1: asDoc(makeOpenQuestion({ created_at_ms: 1000 })) },
    });
    const count = await firestoreTickStore(db).expireOpenQuestions(OUTLET, DEVICE, E, E + 1000);
    expect(count).toBe(1);
    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({
      status: "unverified",
      expired_by_debrief_end_ms: E,
    });
  });

  it("leaves a question created after E untouched", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: { q1: asDoc(makeOpenQuestion({ created_at_ms: E + 1 })) },
    });
    const count = await firestoreTickStore(db).expireOpenQuestions(OUTLET, DEVICE, E, E + 1000);
    expect(count).toBe(0);
    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({ status: "open" });
  });

  it("never touches a question already answered or unverified (the query itself scopes to status==open)", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: {
        q1: asDoc(makeOpenQuestion({ question_id: "q1", status: "answered", answer: "yes", answered_at_ms: 1 })),
        q2: asDoc(makeOpenQuestion({ question_id: "q2", status: "unverified", expired_by_debrief_end_ms: 1 })),
      },
    });
    const count = await firestoreTickStore(db).expireOpenQuestions(OUTLET, DEVICE, E, E + 1000);
    expect(count).toBe(0);
    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({ status: "answered" });
    expect(collections.get(COLLECTIONS.questions)?.get("q2")).toMatchObject({ status: "unverified" });
  });

  it("also sets a gate question's still-open thread to unverified", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: {
        q1: asDoc(makeOpenQuestion({ question_id: "q1", kind: "gate", thread_id: "t1", category: "ROUTINE_OPS" })),
      },
      [COLLECTIONS.threads]: { t1: asDoc(makeThread({ thread_id: "t1", status: "open" })) },
    });
    await firestoreTickStore(db).expireOpenQuestions(OUTLET, DEVICE, E, E + 1000);
    expect(collections.get(COLLECTIONS.threads)?.get("t1")).toMatchObject({ status: "unverified" });
  });

  it("never un-excludes a thread already excluded_from_evidence (a staff NO stands)", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: {
        q1: asDoc(makeOpenQuestion({ question_id: "q1", kind: "gate", thread_id: "t1", category: "ROUTINE_OPS" })),
      },
      [COLLECTIONS.threads]: {
        t1: asDoc({ ...makeThread({ thread_id: "t1", status: "open" }), excluded_from_evidence: true }),
      },
    });
    await firestoreTickStore(db).expireOpenQuestions(OUTLET, DEVICE, E, E + 1000);
    // status stays "open" -- expiry only ever applies to a QUESTION the debrief missed,
    // never un-excludes or otherwise touches an already-excluded thread.
    expect(collections.get(COLLECTIONS.threads)?.get("t1")).toMatchObject({ status: "open", excluded_from_evidence: true });
  });

  it("R-06 (Task 15.2): a supervisor_rejected thread's debrief-end expiry pass leaves it 'open', never 'unverified'", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: {
        q1: asDoc(makeOpenQuestion({ question_id: "q1", kind: "gate", thread_id: "t1", category: "ROUTINE_OPS" })),
      },
      [COLLECTIONS.threads]: {
        t1: asDoc({
          ...makeThread({ thread_id: "t1", status: "open" }),
          label_source: "supervisor_rejected",
          excluded_from_evidence: true,
        }),
      },
    });
    await firestoreTickStore(db).expireOpenQuestions(OUTLET, DEVICE, E, E + 1000);
    expect(collections.get(COLLECTIONS.threads)?.get("t1")).toMatchObject({
      status: "open",
      label_source: "supervisor_rejected",
      excluded_from_evidence: true,
    });
  });
});

// ── R-20 (Cancel-B): discard tombstones, ghost candidates, cleanup ───────────

const S_DISCARDED = "11111111-1111-4111-8111-111111111111";
const S_OTHER = "22222222-2222-4222-8222-222222222222";

function makeCaptureSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const sessionId = (overrides.session_id as string | undefined) ?? S_DISCARDED;
  return {
    outlet_id: OUTLET,
    device_id: DEVICE,
    session_id: sessionId,
    started_at_ms: 1_000_000,
    ended_at_ms: 2_000_000,
    end_reason: "discarded",
    local_date: "2026-10-15",
    auto_stop_at_ms: 9_000_000,
    debrief_ends_at_ms: null,
    received_start_at: "2026-10-15T10:00:00.000Z",
    received_end_at: "2026-10-15T10:10:00.000Z",
    cleanup_done_at_ms: null,
    ...overrides,
  };
}

function sessionKey(sessionId: string, deviceId = DEVICE): string {
  return `${deviceId}:${sessionId}`;
}

function makeQuestionDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outlet_id: OUTLET,
    device_id: DEVICE,
    question_id: "q1",
    thread_id: null,
    kind: "unlabelled_unit",
    status: "open",
    category: null,
    window_start_ms: 1_500_000,
    window_end_ms: 1_600_000,
    created_at_ms: 1_700_000,
    ...overrides,
  };
}

describe("firestoreTickStore.listSegmentsForDevice: session_id (R-20)", () => {
  it("carries the segment's session_id, and null for a pre-P1 segment without one", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.segments]: {
        a: asDoc({ ...makeSegment({ seg_id: "a" }), session_id: S_DISCARDED }),
        b: asDoc(makeSegment({ seg_id: "b" })),
      },
    });
    const result = await firestoreTickStore(db).listSegmentsForDevice(OUTLET, DEVICE);
    expect(result.find((s) => s.seg_id === "a")!.session_id).toBe(S_DISCARDED);
    expect(result.find((s) => s.seg_id === "b")!.session_id).toBeNull();
  });
});

describe("firestoreTickStore.listDiscardedSessions (R-20)", () => {
  it("returns only this device's discarded tombstones (equality-only query), with cleanup_pending from cleanup_done_at_ms", async () => {
    const { db, queryLog } = fakeDb({
      [COLLECTIONS.captureSessions]: {
        [sessionKey(S_DISCARDED)]: asDoc(makeCaptureSession()),
        [sessionKey(S_OTHER)]: asDoc(makeCaptureSession({ session_id: S_OTHER, started_at_ms: 1_500_000, cleanup_done_at_ms: 5_000_000 })),
        // not discarded, another device, another outlet: never returned
        "dev-1:33333333-3333-4333-8333-333333333333": asDoc(
          makeCaptureSession({ session_id: "33333333-3333-4333-8333-333333333333", end_reason: "selesai" }),
        ),
        "dev-2:44444444-4444-4444-8444-444444444444": asDoc(
          makeCaptureSession({ session_id: "44444444-4444-4444-8444-444444444444", device_id: "dev-2" }),
        ),
        "dev-1:55555555-5555-4555-8555-555555555555": asDoc(
          makeCaptureSession({ session_id: "55555555-5555-4555-8555-555555555555", outlet_id: "outlet-2" }),
        ),
      },
    });
    const result = await firestoreTickStore(db).listDiscardedSessions(OUTLET, DEVICE);
    // newest-first by started_at_ms
    expect(result.map((t) => [t.session_id, t.cleanup_pending])).toEqual([
      [S_OTHER, false],
      [S_DISCARDED, true],
    ]);
    // Equality-only filters: no composite index needed.
    const q = queryLog.find((l) => l.collection === COLLECTIONS.captureSessions)!;
    expect(q.filters.every(([, op]) => op === "==")).toBe(true);
  });

  it("treats an absent cleanup_done_at_ms (a pre-Cancel-B tombstone) as pending", async () => {
    const doc = makeCaptureSession();
    delete doc.cleanup_done_at_ms;
    const { db } = fakeDb({ [COLLECTIONS.captureSessions]: { [sessionKey(S_DISCARDED)]: asDoc(doc) } });
    const [t] = await firestoreTickStore(db).listDiscardedSessions(OUTLET, DEVICE);
    expect(t!.cleanup_pending).toBe(true);
  });

  it("uses the attribution interval: end is min(ended_at_ms, auto_stop_at_ms)", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.captureSessions]: {
        [sessionKey(S_DISCARDED)]: asDoc(makeCaptureSession({ ended_at_ms: 9_500_000, auto_stop_at_ms: 3_000_000 })),
      },
    });
    const [t] = await firestoreTickStore(db).listDiscardedSessions(OUTLET, DEVICE);
    expect(t).toMatchObject({ started_at_ms: 1_000_000, ended_at_ms: 3_000_000 });
  });

  it("skips a malformed tombstone (logging only doc id and error class) and still returns the valid ones", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.captureSessions]: {
        [sessionKey(S_DISCARDED)]: asDoc(makeCaptureSession()),
        bad: asDoc({ outlet_id: OUTLET, device_id: DEVICE, end_reason: "discarded" }),
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await firestoreTickStore(db).listDiscardedSessions(OUTLET, DEVICE);
    expect(result.map((t) => t.session_id)).toEqual([S_DISCARDED]);
    expect(errorSpy).toHaveBeenCalledWith("[tick-store] skipping malformed capture_session doc", {
      doc_id: "bad",
      error_class: "ZodError",
    });
    errorSpy.mockRestore();
  });

  it("returns the 50 newest tombstones first when the device has more", async () => {
    const docs: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 55; i++) {
      const sid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      docs[sessionKey(sid)] = asDoc(makeCaptureSession({ session_id: sid, started_at_ms: 1000 + i, ended_at_ms: 2000 + i }));
    }
    const { db } = fakeDb({ [COLLECTIONS.captureSessions]: docs });
    const result = await firestoreTickStore(db).listDiscardedSessions(OUTLET, DEVICE);
    expect(result).toHaveLength(50);
    expect(result[0]!.started_at_ms).toBe(1054);
    expect(result[49]!.started_at_ms).toBe(1005);
  });
});

describe("firestoreTickStore.listGhostCandidates (R-20)", () => {
  it("returns ids and timestamps only (field-masked), this device's threads at or after sinceMs and all of its questions", async () => {
    const { db, queryLog } = fakeDb({
      [COLLECTIONS.threads]: {
        t_in: asDoc(makeThread({ thread_id: "t_in", first_line_start_ms: 1_100_000, last_line_end_ms: 1_200_000 })),
        t_old: asDoc(makeThread({ thread_id: "t_old", first_line_start_ms: 10, last_line_end_ms: 20 })),
        t_other_dev: asDoc(makeThread({ thread_id: "t_other_dev", device_id: "dev-2", last_line_end_ms: 1_200_000 })),
        t_other_outlet: asDoc(makeThread({ thread_id: "t_other_outlet", outlet_id: "outlet-2", last_line_end_ms: 1_200_000 })),
      },
      [COLLECTIONS.questions]: {
        q1: asDoc(makeQuestionDoc({ question_id: "q1" })),
        q2: asDoc(
          makeQuestionDoc({ question_id: "q2", status: "answered", answer: "yes", answered_at_ms: 1_800_000 }),
        ),
        q_other_dev: asDoc(makeQuestionDoc({ question_id: "q_other_dev", device_id: "dev-2" })),
        q_other_outlet: asDoc(makeQuestionDoc({ question_id: "q_other_outlet", outlet_id: "outlet-2" })),
      },
    });

    const result = await firestoreTickStore(db).listGhostCandidates(OUTLET, DEVICE, 1_000_000);

    expect(result.threads).toEqual([{ thread_id: "t_in", first_line_start_ms: 1_100_000 }]);
    expect(result.questions.map((q) => q.question_id).sort()).toEqual(["q1", "q2"]);
    expect(result.questions[0]).toEqual({
      question_id: expect.any(String),
      thread_id: null,
      kind: "unlabelled_unit",
      window_start_ms: 1_500_000,
    });

    // Never reads text: both queries are field-masked, none of lines/summary/reason_text.
    for (const l of queryLog.filter((x) => x.collection === COLLECTIONS.threads || x.collection === COLLECTIONS.questions)) {
      expect(l.select).not.toBeNull();
      expect(l.select).not.toContain("lines");
      expect(l.select).not.toContain("summary");
    }
    // Question query is equality-only (no composite index).
    const qq = queryLog.find((l) => l.collection === COLLECTIONS.questions)!;
    expect(qq.filters.every(([, op]) => op === "==")).toBe(true);
    // Thread query has exactly the listRecentThreads shape (existing composite index).
    const tq = queryLog.find((l) => l.collection === COLLECTIONS.threads)!;
    expect(tq.filters).toEqual([
      ["outlet_id", "==", OUTLET],
      ["device_id", "==", DEVICE],
      ["last_line_end_ms", ">=", 1_000_000],
    ]);
  });

  it("skips a malformed thread or question doc and still returns the valid ones", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.threads]: {
        t_ok: asDoc(makeThread({ thread_id: "t_ok", last_line_end_ms: 1_200_000 })),
        t_bad: asDoc({ outlet_id: OUTLET, device_id: DEVICE, last_line_end_ms: 1_200_000 }),
      },
      [COLLECTIONS.questions]: {
        q_ok: asDoc(makeQuestionDoc({ question_id: "q_ok" })),
        q_bad: asDoc({ outlet_id: OUTLET, device_id: DEVICE }),
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await firestoreTickStore(db).listGhostCandidates(OUTLET, DEVICE, 0);
    expect(result.threads.map((t) => t.thread_id)).toEqual(["t_ok"]);
    expect(result.questions.map((q) => q.question_id)).toEqual(["q_ok"]);
    errorSpy.mockRestore();
  });
});

describe("firestoreTickStore.applyDiscardCleanup (R-20)", () => {
  const NOW = 5_000_000;
  const AUDIT_ID = `${DEVICE}:${S_DISCARDED}:capture.session_cleanup`;

  function plan(overrides: Partial<{ thread_ids: string[]; question_ids: string[]; correction_ids: string[] }> = {}) {
    const question_ids = overrides.question_ids ?? ["q_thread_t1", "q_unit_1"];
    return {
      session_id: S_DISCARDED,
      thread_ids: ["t1"],
      question_ids,
      correction_ids: [...question_ids],
      ...overrides,
    };
  }

  function seeded() {
    return fakeDb({
      [COLLECTIONS.captureSessions]: {
        [sessionKey(S_DISCARDED)]: asDoc(makeCaptureSession()),
        [sessionKey(S_OTHER)]: asDoc(makeCaptureSession({ session_id: S_OTHER })),
      },
      [COLLECTIONS.threads]: { t1: asDoc(makeThread({ thread_id: "t1" })), t_keep: asDoc(makeThread({ thread_id: "t_keep" })) },
      [COLLECTIONS.questions]: {
        q_thread_t1: asDoc(makeQuestionDoc({ question_id: "q_thread_t1", kind: "gate", thread_id: "t1" })),
        q_unit_1: asDoc(makeQuestionDoc({ question_id: "q_unit_1" })),
        q_keep: asDoc(makeQuestionDoc({ question_id: "q_keep" })),
      },
      [COLLECTIONS.corrections]: {
        q_thread_t1: asDoc({ outlet_id: OUTLET, question_id: "q_thread_t1", reason_text: "ghost answer" }),
        q_keep: asDoc({ outlet_id: OUTLET, question_id: "q_keep", reason_text: "real answer" }),
      },
      [COLLECTIONS.segments]: {
        left1: asDoc({ ...makeSegment({ seg_id: "left1" }), session_id: S_DISCARDED }),
        left2: asDoc({ ...makeSegment({ seg_id: "left2" }), session_id: S_DISCARDED }),
        keep: asDoc({ ...makeSegment({ seg_id: "keep" }), session_id: S_OTHER }),
        legacy: asDoc(makeSegment({ seg_id: "legacy" })),
      },
    });
  }

  it("deletes the plan's threads, questions and corrections by id, leaving everything else", async () => {
    const { db, collections } = seeded();
    await firestoreTickStore(db).applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW);

    expect([...collections.get(COLLECTIONS.threads)!.keys()]).toEqual(["t_keep"]);
    expect([...collections.get(COLLECTIONS.questions)!.keys()]).toEqual(["q_keep"]);
    expect([...collections.get(COLLECTIONS.corrections)!.keys()]).toEqual(["q_keep"]);
  });

  it("deletes leftover segments of that session only (other sessions and legacy segments stay)", async () => {
    const { db, collections } = seeded();
    await firestoreTickStore(db).applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW);
    expect([...collections.get(COLLECTIONS.segments)!.keys()].sort()).toEqual(["keep", "legacy"]);
  });

  it("sets cleanup_done_at_ms on the tombstone and writes one counts-only capture.session_cleanup audit under a fixed id", async () => {
    const { db, collections } = seeded();
    await firestoreTickStore(db).applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW);

    expect(collections.get(COLLECTIONS.captureSessions)!.get(sessionKey(S_DISCARDED))).toMatchObject({
      cleanup_done_at_ms: NOW,
    });
    // Another session's tombstone is untouched.
    expect(collections.get(COLLECTIONS.captureSessions)!.get(sessionKey(S_OTHER))).toMatchObject({ cleanup_done_at_ms: null });

    const audits = collections.get(COLLECTIONS.auditLog)!;
    expect([...audits.keys()]).toEqual([AUDIT_ID]);
    expect(audits.get(AUDIT_ID)).toEqual({
      outlet_id: OUTLET,
      ts: new Date(NOW).toISOString(),
      actor_role: "system",
      action: "capture.session_cleanup",
      target_type: "capture_session",
      target_id: S_DISCARDED,
      details: { threads_deleted: 1, questions_deleted: 2, corrections_deleted: 1, segments_deleted: 2 },
    });
  });

  it("counts only docs that actually existed: a missing doc is a no-op", async () => {
    const { db, collections } = seeded();
    await firestoreTickStore(db).applyDiscardCleanup(
      OUTLET,
      DEVICE,
      plan({ thread_ids: ["gone"], question_ids: ["q_missing"] }),
      NOW,
    );
    expect(collections.get(COLLECTIONS.auditLog)!.get(AUDIT_ID)).toMatchObject({
      details: { threads_deleted: 0, questions_deleted: 0, corrections_deleted: 0, segments_deleted: 2 },
    });
    // Nothing else was deleted by accident.
    expect(collections.get(COLLECTIONS.threads)!.size).toBe(2);
  });

  it("never deletes a doc of another outlet that happens to share an id", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.captureSessions]: { [sessionKey(S_DISCARDED)]: asDoc(makeCaptureSession()) },
      [COLLECTIONS.threads]: { t1: asDoc(makeThread({ thread_id: "t1", outlet_id: "outlet-2" })) },
      [COLLECTIONS.questions]: { q_thread_t1: asDoc(makeQuestionDoc({ question_id: "q_thread_t1", outlet_id: "outlet-2" })) },
      [COLLECTIONS.corrections]: { q_thread_t1: asDoc({ outlet_id: "outlet-2", question_id: "q_thread_t1" }) },
    });
    await firestoreTickStore(db).applyDiscardCleanup(OUTLET, DEVICE, plan({ question_ids: ["q_thread_t1"] }), NOW);
    expect(collections.get(COLLECTIONS.threads)!.has("t1")).toBe(true);
    expect(collections.get(COLLECTIONS.questions)!.has("q_thread_t1")).toBe(true);
    expect(collections.get(COLLECTIONS.corrections)!.has("q_thread_t1")).toBe(true);
  });

  it("is idempotent: a second run is safe, keeps one audit doc (overwritten), and still marks the tombstone done", async () => {
    const { db, collections } = seeded();
    const store = firestoreTickStore(db);
    await store.applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW);
    await store.applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW + 1000);

    expect(collections.get(COLLECTIONS.auditLog)!.size).toBe(1);
    expect(collections.get(COLLECTIONS.auditLog)!.get(AUDIT_ID)).toMatchObject({
      details: { threads_deleted: 0, questions_deleted: 0, corrections_deleted: 0, segments_deleted: 0 },
    });
    expect(collections.get(COLLECTIONS.captureSessions)!.get(sessionKey(S_DISCARDED))).toMatchObject({
      cleanup_done_at_ms: NOW + 1000,
    });
  });

  it("writes in batches of at most 400 operations", async () => {
    const threadDocs: Record<string, Record<string, unknown>> = {};
    const ids: string[] = [];
    for (let i = 0; i < 450; i++) {
      ids.push(`t${i}`);
      threadDocs[`t${i}`] = asDoc(makeThread({ thread_id: `t${i}` }));
    }
    const { db, collections, batchSizes } = fakeDb({
      [COLLECTIONS.captureSessions]: { [sessionKey(S_DISCARDED)]: asDoc(makeCaptureSession()) },
      [COLLECTIONS.threads]: threadDocs,
    });
    await firestoreTickStore(db).applyDiscardCleanup(
      OUTLET,
      DEVICE,
      { session_id: S_DISCARDED, thread_ids: ids, question_ids: [], correction_ids: [] },
      NOW,
    );
    expect(collections.get(COLLECTIONS.threads)!.size).toBe(0);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(400);
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(450);
  });

  it("does not mark the tombstone done when a delete step fails (the next tick retries the whole plan)", async () => {
    const { db, collections } = seeded();
    (db as unknown as { getAll: () => Promise<never> }).getAll = () => Promise.reject(new Error("unavailable"));
    await expect(firestoreTickStore(db).applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW)).rejects.toThrow("unavailable");
    expect(collections.get(COLLECTIONS.captureSessions)!.get(sessionKey(S_DISCARDED))).toMatchObject({
      cleanup_done_at_ms: null,
    });
    expect(collections.get(COLLECTIONS.auditLog)?.size ?? 0).toBe(0);
  });

  it("does nothing when the tombstone is missing, not a discard, or another outlet's", async () => {
    for (const session of [
      undefined,
      makeCaptureSession({ end_reason: "selesai" }),
      makeCaptureSession({ outlet_id: "outlet-2" }),
    ]) {
      const { db, collections } = fakeDb({
        [COLLECTIONS.captureSessions]: session ? { [sessionKey(S_DISCARDED)]: asDoc(session) } : {},
        [COLLECTIONS.threads]: { t1: asDoc(makeThread({ thread_id: "t1" })) },
      });
      await firestoreTickStore(db).applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW);
      expect(collections.get(COLLECTIONS.threads)!.has("t1")).toBe(true);
      expect(collections.get(COLLECTIONS.auditLog)?.size ?? 0).toBe(0);
    }
  });

  it("never puts text, a name or an id other than the session id into the audit", async () => {
    const { db, collections } = seeded();
    await firestoreTickStore(db).applyDiscardCleanup(OUTLET, DEVICE, plan(), NOW);
    const audit = JSON.stringify(collections.get(COLLECTIONS.auditLog)!.get(AUDIT_ID));
    expect(audit).not.toContain("ghost answer");
    expect(audit).not.toContain("t1");
    expect(audit).not.toContain("q_thread");
  });
});
