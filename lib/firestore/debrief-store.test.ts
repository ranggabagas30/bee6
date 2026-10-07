import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreDebriefStore } from "@/lib/firestore/debrief-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { deviceDocId } from "@/lib/firestore/stores";
import type { CaptureSession, Device, Outlet, Question, Staff, Thread } from "@/lib/firestore/schema";

/**
 * Hand-rolled fake Firestore — same technique as `lib/firestore/tick-store.test.ts`,
 * extended with `tx.create` (neither of that file's fakes needs it; this store
 * creates the correction + audit docs).
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
  create(ref: FakeDocRef, data: Record<string, unknown>): void;
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
  if (op === "in") return Array.isArray(value) && (value as unknown[]).includes(v);
  throw new Error(`fake firestore: unsupported op ${op}`);
}

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
        doc(id?: string) {
          return doc(name, id ?? `auto-${col(name).size}-${Math.random()}`);
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
        create: (ref, data) => {
          void ref.create(data);
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

function makeOutlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET,
    name: "Proofed",
    project_kind: "pilot",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    outlet_id: OUTLET,
    staff_id: "s1",
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

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    outlet_id: OUTLET,
    question_id: "q1",
    device_id: DEVICE,
    thread_id: "t1",
    kind: "gate",
    status: "open",
    category: "ROUTINE_OPS",
    window_start_ms: 0,
    window_end_ms: 1000,
    created_at_ms: 0,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    outlet_id: OUTLET,
    thread_id: "t1",
    device_id: DEVICE,
    category: "ROUTINE_OPS",
    confidence: 0.95,
    line_ids: ["s1#0"],
    evidence_line_ids: ["s1#0"],
    lines: [{ line_id: "s1#0", start_ms: 0, end_ms: 1000, text: "checked the oven" }],
    first_line_start_ms: 0,
    last_line_end_ms: 1000,
    summary: "checked the oven",
    label_conflict: false,
    status: "open",
    gate: {
      verdict: "fact",
      fired_rule: "passed",
      checks: [],
      category: "ROUTINE_OPS",
      confidence: 0.95,
      threshold: 0.9,
      evidence_count: 1,
      gate_version: "1",
    },
    created_at_ms: 0,
    updated_at_ms: 0,
    ...overrides,
  };
}

function makeCaptureSession(overrides: Partial<CaptureSession> = {}): CaptureSession {
  return {
    outlet_id: OUTLET,
    device_id: DEVICE,
    session_id: "11111111-1111-4111-8111-111111111111",
    started_at_ms: 0,
    ended_at_ms: 1000,
    end_reason: "selesai",
    local_date: "2026-10-07",
    auto_stop_at_ms: 2000,
    debrief_ends_at_ms: 1_700_010_000_000,
    received_start_at: "2026-10-07T00:00:00.000Z",
    received_end_at: "2026-10-07T01:00:00.000Z",
    ...overrides,
  };
}

describe("firestoreDebriefStore.getLastEnded", () => {
  it("returns the device's last_ended", async () => {
    const lastEnded = {
      business_date: "2026-10-07",
      end_reason: "selesai" as const,
      ended_at_ms: 1000,
      debrief_ends_at_ms: 5000,
    };
    const { db } = fakeDb({
      [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: asDoc(makeDevice({ last_ended: lastEnded })) },
    });
    const result = await firestoreDebriefStore(OUTLET, db).getLastEnded(DEVICE);
    expect(result).toEqual(lastEnded);
  });

  it("returns null when the device has no last_ended", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: asDoc(makeDevice()) },
    });
    expect(await firestoreDebriefStore(OUTLET, db).getLastEnded(DEVICE)).toBeNull();
  });

  it("returns null when the device doc does not exist", async () => {
    const { db } = fakeDb();
    expect(await firestoreDebriefStore(OUTLET, db).getLastEnded(DEVICE)).toBeNull();
  });
});

describe("firestoreDebriefStore.getOutletCalendar", () => {
  it("returns the outlet's timezone and retention_days", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.outlets]: { [OUTLET]: asDoc(makeOutlet({ retention_days: 30 })) },
    });
    expect(await firestoreDebriefStore(OUTLET, db).getOutletCalendar()).toEqual({
      tz: "Asia/Jakarta",
      retention_days: 30,
    });
  });

  it("defaults retention_days to 14 when the outlet doc doesn't have it", async () => {
    const { db } = fakeDb({ [COLLECTIONS.outlets]: { [OUTLET]: asDoc(makeOutlet()) } });
    expect(await firestoreDebriefStore(OUTLET, db).getOutletCalendar()).toEqual({
      tz: "Asia/Jakarta",
      retention_days: 14,
    });
  });
});

describe("firestoreDebriefStore.listOpenQuestions / getQuestion", () => {
  it("lists only this device's open questions, skipping a malformed doc", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.questions]: {
        q1: asDoc(makeQuestion({ question_id: "q1" })),
        q2: asDoc(makeQuestion({ question_id: "q2", status: "answered", answer: "yes", answered_at_ms: 1 })),
        q3: asDoc(makeQuestion({ question_id: "q3", device_id: "other-device" })),
        bad: { outlet_id: OUTLET, device_id: DEVICE, status: "open" }, // missing required fields
      },
    });
    const result = await firestoreDebriefStore(OUTLET, db).listOpenQuestions(DEVICE);
    expect(result.map((q) => q.question_id)).toEqual(["q1"]);
  });

  it("getQuestion reads by id regardless of outlet (the service checks scope)", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.questions]: { q1: asDoc(makeQuestion({ outlet_id: "other-outlet" })) },
    });
    const result = await firestoreDebriefStore(OUTLET, db).getQuestion("q1");
    expect(result?.outlet_id).toBe("other-outlet");
  });

  it("getQuestion returns null for a missing id", async () => {
    const { db } = fakeDb();
    expect(await firestoreDebriefStore(OUTLET, db).getQuestion("missing")).toBeNull();
  });
});

describe("firestoreDebriefStore.listStaffNames", () => {
  it("returns raw staff names for the outlet", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.staff]: {
        s1: asDoc(makeStaff({ name: "Dina Putri" })),
        s2: asDoc(makeStaff({ staff_id: "s2", name: "Budi", name_key: "budi" })),
      },
    });
    const result = await firestoreDebriefStore(OUTLET, db).listStaffNames();
    expect(result.sort()).toEqual(["Budi", "Dina Putri"]);
  });
});

describe("firestoreDebriefStore.findEndedDebrief", () => {
  it("fast path: uses devices/{outlet}:{device}.last_ended when its business_date matches", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.devices]: {
        [deviceDocId(OUTLET, DEVICE)]: asDoc(
          makeDevice({
            last_ended: { business_date: "2026-10-07", end_reason: "selesai", ended_at_ms: 1, debrief_ends_at_ms: 5000 },
          }),
        ),
      },
    });
    const result = await firestoreDebriefStore(OUTLET, db).findEndedDebrief(DEVICE, "2026-10-07");
    expect(result).toEqual({ business_date: "2026-10-07", debrief_ends_at_ms: 5000 });
  });

  it("falls back to capture_sessions and picks the LATEST debrief_ends_at_ms among several", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: asDoc(makeDevice()) }, // no last_ended for this date
      [COLLECTIONS.captureSessions]: {
        a: asDoc(
          makeCaptureSession({
            session_id: "11111111-1111-4111-8111-111111111111",
            debrief_ends_at_ms: 4000,
          }),
        ),
        b: asDoc(
          makeCaptureSession({
            session_id: "22222222-2222-4222-8222-222222222222",
            debrief_ends_at_ms: 6000,
          }),
        ),
      },
    });
    const result = await firestoreDebriefStore(OUTLET, db).findEndedDebrief(DEVICE, "2026-10-07");
    expect(result).toEqual({ business_date: "2026-10-07", debrief_ends_at_ms: 6000 });
  });

  it("returns null when no ended debrief matches the date", async () => {
    const { db } = fakeDb({ [COLLECTIONS.devices]: { [deviceDocId(OUTLET, DEVICE)]: asDoc(makeDevice()) } });
    expect(await firestoreDebriefStore(OUTLET, db).findEndedDebrief(DEVICE, "2026-10-07")).toBeNull();
  });
});

describe("firestoreDebriefStore.transactAnswer", () => {
  it("reads question + thread + correction-exists, then writes the patches, correction and audit", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: { q1: asDoc(makeQuestion()) },
      [COLLECTIONS.threads]: { t1: asDoc(makeThread()) },
    });
    const store = firestoreDebriefStore(OUTLET, db);

    const result = await store.transactAnswer("q1", (snap) => {
      expect(snap.question?.question_id).toBe("q1");
      expect(snap.thread?.thread_id).toBe("t1");
      expect(snap.correction_exists).toBe(false);
      return {
        result: "answered",
        question_patch: { status: "answered", answer: "yes", answered_at_ms: 123, expired_by_debrief_end_ms: null },
        thread_patch: { status: "fact", label_source: "staff_confirmed", confirmed_category: "ROUTINE_OPS" },
        correction: {
          outlet_id: OUTLET,
          correction_id: "q1",
          question_id: "q1",
          thread_id: "t1",
          answer: "yes",
          reason_text: "[STAFF] ok",
          answered_device_id: DEVICE,
          debrief_business_date: "2026-10-07",
          answered_at_ms: 123,
          received_at_ms: 456,
          needs_supervisor_confirm: false,
          expires_at: "2026-10-21T00:00:00.000Z",
          created_at: "2026-10-07T00:00:00.000Z",
        },
        audit: {
          action: "debrief.answer_uploaded",
          target_type: "question",
          target_id: "q1",
          details: { device_id: DEVICE },
        },
      };
    });

    expect(result).toBe("answered");
    expect(collections.get(COLLECTIONS.questions)?.get("q1")).toMatchObject({ status: "answered", answer: "yes" });
    expect(collections.get(COLLECTIONS.threads)?.get("t1")).toMatchObject({ status: "fact" });
    const correctionDoc = collections.get(COLLECTIONS.corrections)?.get("q1");
    expect(correctionDoc).toMatchObject({ reason_text: "[STAFF] ok" });
    expect(correctionDoc?.expires_at).toBeInstanceOf(Timestamp);
    const auditDocs = Array.from(collections.get(COLLECTIONS.auditLog)?.values() ?? []);
    expect(auditDocs).toHaveLength(1);
    expect(auditDocs[0]).toMatchObject({ action: "debrief.answer_uploaded", actor_role: "device", target_id: "q1" });
  });

  it("writes nothing when the plan returns already_answered", async () => {
    const { db, collections } = fakeDb({
      [COLLECTIONS.questions]: { q1: asDoc(makeQuestion({ status: "answered", answer: "yes", answered_at_ms: 1 })) },
    });
    const store = firestoreDebriefStore(OUTLET, db);
    const result = await store.transactAnswer("q1", () => ({ result: "already_answered" }));
    expect(result).toBe("already_answered");
    expect(collections.get(COLLECTIONS.corrections)?.size ?? 0).toBe(0);
  });

  it("passes correction_exists: true when a correction doc already exists (racing phones)", async () => {
    const { db } = fakeDb({
      [COLLECTIONS.questions]: { q1: asDoc(makeQuestion()) },
      [COLLECTIONS.corrections]: { q1: { outlet_id: OUTLET, correction_id: "q1" } },
    });
    const store = firestoreDebriefStore(OUTLET, db);
    let seen = false;
    await store.transactAnswer("q1", (snap) => {
      seen = snap.correction_exists;
      return { result: "already_answered" };
    });
    expect(seen).toBe(true);
  });
});
