import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreCaptureSessionStore } from "@/lib/firestore/stores";
import { DISCARD_DELETE_BATCH_MAX, discardSession, endSession, startSession } from "@/lib/capture/session-service";
import { ConflictError } from "@/lib/http/errors";
import type { WeeklyHours } from "@/lib/firestore/schema";

// FieldValue.increment must be inspectable by the fake; everything else is the real SDK.
vi.mock("firebase-admin/firestore", async (orig) => {
  const actual = await orig<typeof import("firebase-admin/firestore")>();
  return {
    ...actual,
    FieldValue: { increment: (n: number) => ({ __increment: n }) },
  };
});

/**
 * Faithful in-memory model of the Firestore Admin surface the capture session store
 * uses: transactions buffer their writes and apply them atomically at commit (a thrown
 * error inside the callback discards every write), `create` fails on an existing doc
 * (ALREADY_EXISTS, code 6), `update` fails on a missing doc (NOT_FOUND, code 5), equality
 * queries honour `limit`, and WriteBatches apply atomically and count their writes.
 */
type Doc = Record<string, unknown>;

class StoreError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

class FakeFirestore {
  readonly docs = new Map<string, Doc>();
  readonly commits: number[] = []; // writes per committed batch / transaction

  key(collection: string, id: string) {
    return `${collection}/${id}`;
  }

  seed(collection: string, id: string, data: Doc) {
    this.docs.set(this.key(collection, id), structuredClone(data));
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this, name);
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const tx = new FakeTx(this);
    const out = await fn(tx);
    tx.commit();
    return out;
  }

  /** Applies buffered ops in order; throws before any write if one of them is invalid. */
  apply(ops: Op[]) {
    const staged = new Map(this.docs);
    for (const op of ops) {
      const k = this.key(op.ref.collection, op.ref.id);
      if (op.kind === "create") {
        if (staged.has(k)) throw new StoreError(6, `ALREADY_EXISTS: ${k}`);
        staged.set(k, structuredClone(op.data));
      } else if (op.kind === "set") {
        const prev = op.merge ? (staged.get(k) ?? {}) : {};
        staged.set(k, { ...prev, ...structuredClone(op.data) });
      } else if (op.kind === "update") {
        const prev = staged.get(k);
        if (!prev) throw new StoreError(5, `NOT_FOUND: ${k}`);
        const next = structuredClone(prev);
        for (const [path, value] of Object.entries(op.patch)) {
          setPath(next, path, value, prev);
        }
        staged.set(k, next);
      } else {
        if (!staged.has(k)) throw new StoreError(5, `NOT_FOUND: ${k}`);
        staged.delete(k);
      }
    }
    this.docs.clear();
    for (const [k, v] of staged) this.docs.set(k, v);
    this.commits.push(ops.length);
  }
}

function setPath(target: Doc, path: string, value: unknown, prev: Doc) {
  const parts = path.split(".");
  let cursor: Doc = target;
  for (const p of parts.slice(0, -1)) {
    if (typeof cursor[p] !== "object" || cursor[p] === null) cursor[p] = {};
    cursor = cursor[p] as Doc;
  }
  const leaf = parts[parts.length - 1]!;
  const inc = value as { __increment?: number };
  if (inc && typeof inc === "object" && typeof inc.__increment === "number") {
    const before = (getPath(prev, path) as number | undefined) ?? 0;
    cursor[leaf] = before + inc.__increment;
  } else {
    cursor[leaf] = value;
  }
}

function getPath(obj: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o as Doc | undefined)?.[p], obj);
}

type Ref = { collection: string; id: string };
type Op =
  | { kind: "create"; ref: Ref; data: Doc }
  | { kind: "set"; ref: Ref; data: Doc; merge?: boolean }
  | { kind: "update"; ref: Ref; patch: Doc }
  | { kind: "delete"; ref: Ref };

function snap(fake: FakeFirestore, ref: Ref) {
  const data = fake.docs.get(fake.key(ref.collection, ref.id));
  return { id: ref.id, ref, exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
}

class FakeTx {
  private readonly ops: Op[] = [];
  constructor(private readonly fake: FakeFirestore) {}
  doc(collection: string, id: string) {
    return { collection, id };
  }
  async get(ref: Ref) {
    return snap(this.fake, ref);
  }
  set(ref: Ref, data: Doc, opts?: { merge?: boolean }) {
    this.ops.push({ kind: "set", ref, data, merge: opts?.merge });
  }
  create(ref: Ref, data: Doc) {
    this.ops.push({ kind: "create", ref, data });
  }
  update(ref: Ref, patch: Doc) {
    this.ops.push({ kind: "update", ref, patch });
  }
  commit() {
    this.fake.apply(this.ops);
  }
}

class FakeBatch {
  private readonly ops: Op[] = [];
  constructor(private readonly fake: FakeFirestore) {}
  delete(ref: Ref) {
    this.ops.push({ kind: "delete", ref });
  }
  update(ref: Ref, patch: Doc) {
    this.ops.push({ kind: "update", ref, patch });
  }
  async commit() {
    this.fake.apply(this.ops);
  }
}

class FakeQuery {
  constructor(
    private readonly fake: FakeFirestore,
    private readonly collection: string,
    private readonly filters: [string, string, unknown][] = [],
    private readonly max?: number,
  ) {}
  where(field: string, op: "==", value: unknown) {
    return new FakeQuery(this.fake, this.collection, [...this.filters, [field, op, value]], this.max);
  }
  limit(n: number) {
    return new FakeQuery(this.fake, this.collection, this.filters, n);
  }
  async get() {
    const prefix = `${this.collection}/`;
    const matched: { id: string; ref: Ref; data: () => Doc }[] = [];
    for (const [k, v] of this.fake.docs) {
      if (!k.startsWith(prefix)) continue;
      if (!this.filters.every(([f, , val]) => v[f] === val)) continue;
      const id = k.slice(prefix.length);
      matched.push({ id, ref: { collection: this.collection, id }, data: () => structuredClone(v) });
      if (this.max !== undefined && matched.length >= this.max) break;
    }
    return { docs: matched, size: matched.length, empty: matched.length === 0 };
  }
}

class FakeCollection extends FakeQuery {
  readonly name: string;
  constructor(fake: FakeFirestore, name: string) {
    super(fake, name);
    this.name = name;
  }
  /** Like Firestore: no id means an auto-generated one. */
  doc(id?: string) {
    return { collection: this.name, id: id ?? randomUUID() };
  }
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const day = { open: "07:00", close: "21:45" };
const WEEKLY: WeeklyHours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
const CAL = { weekly: WEEKLY, tz: "Asia/Jakarta" };
const OUTLET = "outlet-1";
const DEVICE = "dev-1";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
// 2026-10-06 10:00 Asia/Jakarta (= 03:00Z), inside the Tuesday window.
const T0 = Date.parse("2026-10-06T03:00:00.000Z");

function fresh() {
  const fake = new FakeFirestore();
  // A paired device always has its doc; the store updates it, so it must exist.
  fake.seed("devices", `${OUTLET}:${DEVICE}`, { outlet_id: OUTLET, device_id: DEVICE });
  const store = firestoreCaptureSessionStore(OUTLET, fake as unknown as Firestore);
  return { fake, store };
}

function sessionDoc(fake: FakeFirestore, sid: string) {
  return fake.docs.get(fake.key("capture_sessions", `${DEVICE}:${sid}`));
}

describe("firestoreCaptureSessionStore (transaction contract)", () => {
  it("start writes the session and its audit in one transaction, keyed device_id:session_id", async () => {
    const { fake, store } = fresh();
    const out = await startSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0, started_at_ms: T0,
    });
    expect(out.created).toBe(true);
    expect(out.session.local_date).toBe("2026-10-06");
    expect(sessionDoc(fake, S1)).toMatchObject({
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, ended_at_ms: null, end_reason: null,
    });
    const audits = [...fake.docs.entries()].filter(([k]) => k.startsWith("audit_log/"));
    expect(audits).toHaveLength(1);
    expect(audits[0]![1]).toMatchObject({ outlet_id: OUTLET, actor_role: "device", action: "capture.session_start", target_id: S1 });
  });

  it("a repeat start is first-write-wins: no second write and no second audit", async () => {
    const { fake, store } = fresh();
    await startSession(store, { outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0, started_at_ms: T0 });
    const again = await startSession(store, { outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 5000, started_at_ms: T0 });
    expect(again.created).toBe(false);
    expect([...fake.docs.keys()].filter((k) => k.startsWith("audit_log/"))).toHaveLength(1);
  });

  it("end with no prior start creates the session and sets the device's last_ended via update", async () => {
    const { fake, store } = fresh();
    fake.seed("devices", `${OUTLET}:${DEVICE}`, { outlet_id: OUTLET, device_id: DEVICE });
    await endSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 60_000,
      started_at_ms: T0, ended_at_ms: T0 + 3_600_000, end_reason: "selesai",
    });
    expect(sessionDoc(fake, S1)).toMatchObject({ end_reason: "selesai", debrief_ends_at_ms: T0 + 7_200_000 });
    expect(fake.docs.get(fake.key("devices", `${OUTLET}:${DEVICE}`))?.last_ended).toMatchObject({
      business_date: "2026-10-06", end_reason: "selesai", debrief_ends_at_ms: T0 + 7_200_000,
    });
  });

  it("an older business date never overwrites a newer last_ended", async () => {
    const { fake, store } = fresh();
    fake.seed("devices", `${OUTLET}:${DEVICE}`, {
      outlet_id: OUTLET, device_id: DEVICE,
      last_ended: { business_date: "2026-10-07", end_reason: "selesai", ended_at_ms: 1, debrief_ends_at_ms: 2 },
    });
    await endSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 60_000,
      started_at_ms: T0, ended_at_ms: T0 + 60_000, end_reason: "lost",
    });
    expect(fake.docs.get(fake.key("devices", `${OUTLET}:${DEVICE}`))?.last_ended).toMatchObject({ business_date: "2026-10-07" });
  });

  it("discard writes the tombstone, its fixed-id audit (segments_deleted 0) and last_ended together", async () => {
    const { fake, store } = fresh();
    fake.seed("devices", `${OUTLET}:${DEVICE}`, { outlet_id: OUTLET, device_id: DEVICE });
    await startSession(store, { outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0, started_at_ms: T0 });
    await discardSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 9_000,
      started_at_ms: T0, discarded_at_ms: T0 + 8_000,
    });
    expect(sessionDoc(fake, S1)).toMatchObject({ end_reason: "discarded", debrief_ends_at_ms: null, cleanup_done_at_ms: null });
    const audit = fake.docs.get(fake.key("audit_log", `${DEVICE}:${S1}:capture.session_discarded`));
    expect(audit).toMatchObject({
      action: "capture.session_discarded", target_id: S1,
      details: { local_date: "2026-10-06", elapsed_ms: 8_000, segments_deleted: 0 },
    });
    expect(fake.docs.get(fake.key("devices", `${OUTLET}:${DEVICE}`))?.last_ended).toMatchObject({
      end_reason: "discarded", debrief_ends_at_ms: null,
    });
  });

  it("a repeat discard changes nothing and does not re-create the fixed audit", async () => {
    const { fake, store } = fresh();
    const input = {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 9_000,
      started_at_ms: T0, discarded_at_ms: T0 + 8_000,
    };
    await discardSession(store, input);
    const before = JSON.stringify([...fake.docs.entries()]);
    await expect(discardSession(store, input)).resolves.toEqual({ ok: true, cleanup: "pending" });
    expect(JSON.stringify([...fake.docs.entries()])).toBe(before);
  });

  it("a discard after Selesai is a 409 and writes nothing", async () => {
    const { fake, store } = fresh();
    await endSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 60_000,
      started_at_ms: T0, ended_at_ms: T0 + 3_600_000, end_reason: "selesai",
    });
    const before = JSON.stringify([...fake.docs.entries()]);
    await expect(
      discardSession(store, {
        outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 3_700_000,
        started_at_ms: T0, discarded_at_ms: T0 + 3_650_000,
      }),
    ).rejects.toThrow(ConflictError);
    expect(JSON.stringify([...fake.docs.entries()])).toBe(before);
  });

  it("create-once audit: a colliding fixed audit id fails the whole transaction (no tombstone)", async () => {
    const { fake, store } = fresh();
    fake.seed("audit_log", `${DEVICE}:${S1}:capture.session_discarded`, { outlet_id: OUTLET });
    await expect(
      discardSession(store, {
        outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 9_000,
        started_at_ms: T0, discarded_at_ms: T0 + 8_000,
      }),
    ).rejects.toThrow();
    expect(sessionDoc(fake, S1)).toBeUndefined();
  });

  it("device last_ended lookup is scoped to this outlet's device doc", async () => {
    const { fake, store } = fresh();
    fake.seed("devices", `other-outlet:${DEVICE}`, {
      outlet_id: "other-outlet", device_id: DEVICE,
      last_ended: { business_date: "2026-10-09", end_reason: "selesai", ended_at_ms: 1, debrief_ends_at_ms: 2 },
    });
    const out = await startSession(store, { outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0, started_at_ms: T0 });
    expect(out.created).toBe(true);
    const audits = [...fake.docs.entries()].filter(([k]) => k.startsWith("audit_log/")).map(([, v]) => v);
    expect(audits.map((a) => a.action)).toEqual(["capture.session_start"]);
  });
});

describe("firestoreCaptureSessionStore.deleteSegments", () => {
  function seedSegments(fake: FakeFirestore, n: number, session = S1, device = DEVICE) {
    for (let i = 0; i < n; i++) {
      fake.seed("segments", `${OUTLET}:${device}:${session}-${i}`, { outlet_id: OUTLET, device_id: device, session_id: session });
    }
  }

  it("deletes only this device session's segments in bounded batches and counts them on the audit", async () => {
    const { fake, store } = fresh();
    await discardSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 9_000,
      started_at_ms: T0, discarded_at_ms: T0 + 8_000,
    });
    const big = DISCARD_DELETE_BATCH_MAX * 2 + 5;
    seedSegments(fake, big);
    seedSegments(fake, 2, S2);
    seedSegments(fake, 1, S1, "dev-2");
    fake.commits.length = 0;

    const deleted = await store.deleteSegments({ device_id: DEVICE, session_id: S1 }, `${DEVICE}:${S1}:capture.session_discarded`);

    expect(deleted).toBe(big);
    expect([...fake.docs.keys()].filter((k) => k.startsWith("segments/")).length).toBe(3);
    expect(fake.docs.get(fake.key("audit_log", `${DEVICE}:${S1}:capture.session_discarded`))?.details).toMatchObject({
      segments_deleted: big,
    });
    // Each commit is one batch: at most 399 deletes + 1 audit update.
    expect(fake.commits.every((n) => n <= DISCARD_DELETE_BATCH_MAX + 1)).toBe(true);
  });

  it("never deletes a segment from another outlet that shares device_id and session_id", async () => {
    const { fake, store } = fresh();
    await discardSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 9_000,
      started_at_ms: T0, discarded_at_ms: T0 + 8_000,
    });
    // Device ids are unique per outlet only: same device_id and session_id, different outlet.
    fake.seed("segments", `other-outlet:${DEVICE}:${S1}-0`, { outlet_id: "other-outlet", device_id: DEVICE, session_id: S1 });
    seedSegments(fake, 2);
    const auditId = `${DEVICE}:${S1}:capture.session_discarded`;

    expect(await store.deleteSegments({ device_id: DEVICE, session_id: S1 }, auditId)).toBe(2);

    expect(fake.docs.has(fake.key("segments", `other-outlet:${DEVICE}:${S1}-0`))).toBe(true);
    expect(fake.docs.get(fake.key("audit_log", auditId))?.details).toMatchObject({ segments_deleted: 2 });
  });

  it("a retry after the work is done adds nothing and returns 0", async () => {
    const { fake, store } = fresh();
    await discardSession(store, {
      outlet_id: OUTLET, device_id: DEVICE, session_id: S1, cal: CAL, now_ms: T0 + 9_000,
      started_at_ms: T0, discarded_at_ms: T0 + 8_000,
    });
    seedSegments(fake, 4);
    const key = { device_id: DEVICE, session_id: S1 };
    const auditId = `${DEVICE}:${S1}:capture.session_discarded`;
    expect(await store.deleteSegments(key, auditId)).toBe(4);
    expect(await store.deleteSegments(key, auditId)).toBe(0);
    expect(fake.docs.get(fake.key("audit_log", auditId))?.details).toMatchObject({ segments_deleted: 4 });
  });
});
