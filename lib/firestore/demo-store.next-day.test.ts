import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { firestoreNextDayStore } from "@/lib/firestore/demo-store";
import { deviceDocId } from "@/lib/firestore/stores";
import { WRITE_BATCH_MAX } from "@/lib/demo/constants";

/**
 * R-19 PR-2: the Firestore NextDayStore. Every read is scoped to one sandbox outlet (and the judge device);
 * every write refuses anything outside it before touching Firestore. Hand-rolled fake Firestore, the same
 * technique as demo-store.test.ts (queries with equality / `in` filters, batches, transactions).
 */
type Doc = Record<string, unknown>;

function fakeDb(seed: Record<string, Record<string, Doc>> = {}) {
  const cols = new Map<string, Map<string, Doc>>();
  for (const [c, docs] of Object.entries(seed)) cols.set(c, new Map(Object.entries(docs)));
  const col = (n: string) => {
    let c = cols.get(n);
    if (!c) cols.set(n, (c = new Map()));
    return c;
  };
  const writes: { col: string; op: string; id: string }[] = [];
  const queries: { col: string; filters: [string, string, unknown][]; limit?: number }[] = [];
  const batchSizes: number[] = [];
  interface Ref { id: string; col: string; get(): Promise<{ id: string; exists: boolean; data(): Doc | undefined }>; update(p: Doc): Promise<void> }
  const ref = (c: string, id: string): Ref => ({
    id,
    col: c,
    async get() {
      const d = col(c).get(id);
      return { id, exists: d !== undefined, data: () => d };
    },
    async update(patch) {
      const d = col(c).get(id);
      if (!d) throw new Error("NOT_FOUND");
      writes.push({ col: c, op: "update", id });
      col(c).set(id, { ...d, ...patch });
    },
  });
  const matches = (d: Doc, [f, o, v]: [string, string, unknown]) => {
    const x = d[f];
    if (o === "==") return x === v;
    if (o === "in") return (v as unknown[]).includes(x);
    throw new Error(`unsupported op ${o}`);
  };
  function query(c: string, filters: [string, string, unknown][], lim?: number) {
    return {
      where: (f: string, o: string, v: unknown) => query(c, [...filters, [f, o, v]], lim),
      limit: (n: number) => query(c, filters, n),
      async get() {
        queries.push({ col: c, filters, limit: lim });
        let entries = [...col(c).entries()].filter(([, d]) => filters.every((fl) => matches(d, fl)));
        if (lim !== undefined) entries = entries.slice(0, lim);
        return { docs: entries.map(([id, d]) => ({ id, exists: true, data: () => d, ref: ref(c, id) })), size: entries.length };
      },
    };
  }
  const db = {
    collection: (c: string) => ({ where: (f: string, o: string, v: unknown) => query(c, [[f, o, v]]), limit: (n: number) => query(c, [], n), get: () => query(c, []).get(), doc: (id: string) => ref(c, id) }),
    batch() {
      const staged: (() => void)[] = [];
      return {
        set(r: Ref, d: Doc) {
          staged.push(() => {
            writes.push({ col: r.col, op: "set", id: r.id });
            col(r.col).set(r.id, d);
          });
        },
        update(r: Ref, d: Doc) {
          staged.push(() => {
            writes.push({ col: r.col, op: "update", id: r.id });
            col(r.col).set(r.id, { ...col(r.col).get(r.id), ...d });
          });
        },
        async commit() {
          batchSizes.push(staged.length);
          if (staged.length > 500) throw new Error("batch too large");
          staged.forEach((s) => s());
        },
      };
    },
    async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
      const staged: (() => void)[] = [];
      const tx = {
        get: (r: Ref) => r.get(),
        set: (r: Ref, d: Doc) => staged.push(() => { writes.push({ col: r.col, op: "set", id: r.id }); col(r.col).set(r.id, d); }),
        update: (r: Ref, d: Doc) => staged.push(() => { writes.push({ col: r.col, op: "update", id: r.id }); col(r.col).set(r.id, { ...col(r.col).get(r.id), ...d }); }),
        delete: (r: Ref) => staged.push(() => { writes.push({ col: r.col, op: "delete", id: r.id }); col(r.col).delete(r.id); }),
      };
      const out = await fn(tx);
      staged.forEach((s) => s());
      return out;
    },
  };
  return { db: db as unknown as Firestore, cols, writes, queries, batchSizes };
}

const SBX = "sbx-0123456789ab";
const JDG = "jdg-0123456789ab";
const OTHER = "sbx-ffffffffffff";
const T0 = Date.UTC(2026, 9, 14, 3, 0, 0);
const S1 = "11111111-1111-4111-8111-111111111111";
const iso = (ms: number) => new Date(ms).toISOString();
const outlet = (over: Doc = {}) => ({
  outlet_id: SBX, name: "Sandbox", project_kind: "demo", timezone: "Asia/Jakarta", opening_time: "07:00", closing_time: "21:45", created_at: iso(0),
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: T0 - 1, expires_at_ms: T0 + 7_200_000, key_sha256: "a".repeat(64), ...over },
});
const last = { business_date: "2026-10-14", end_reason: "selesai" as const, ended_at_ms: T0 - 60_000, debrief_ends_at_ms: T0 + 3_540_000 };
const device = (id = JDG, o = SBX) => ({ outlet_id: o, device_id: id, label: "Judge phone", token_hash: "h", paired_at: iso(0), revoked: false, pairing_code: null, pairing_code_expires_at: null, created_at: iso(0), expires_at_ms: T0 + 7_200_000, last_ended: last });
const session = (ended: number | null, o = SBX, d = JDG, sid = S1) => ({ outlet_id: o, device_id: d, session_id: sid, started_at_ms: T0 - 300_000, ended_at_ms: ended, end_reason: ended === null ? null : "selesai", local_date: "2026-10-14", auto_stop_at_ms: T0 + 300_000, debrief_ends_at_ms: ended === null ? null : ended + 3_600_000, received_start_at: iso(T0 - 300_000), received_end_at: ended === null ? null : iso(ended) });
const segment = (segId: string, lines: string[], o = SBX, d = JDG, sid: string | null = S1) => ({ outlet_id: o, device_id: d, seg_id: segId, received_at: iso(T0 - 100_000), device_start: iso(T0 - 115_000), device_end: iso(T0 - 100_000), model: "m", location: "global", lines: lines.map((text) => ({ text, start: 0, end: 1 })), expires_at: { toDate: () => new Date(0) }, session_id: sid });

function seedSandbox(): Record<string, Record<string, Doc>> {
  return {
    [COLLECTIONS.outlets]: { [SBX]: outlet(), [OTHER]: { ...outlet(), outlet_id: OTHER } },
    [COLLECTIONS.devices]: { [deviceDocId(SBX, JDG)]: device(), [deviceDocId(OTHER, "jdg-ffffffffffff")]: device("jdg-ffffffffffff", OTHER) },
    [COLLECTIONS.captureSessions]: { [`${JDG}:${S1}`]: session(T0 - 60_000), [`jdg-ffffffffffff:${S1}`]: session(null, OTHER, "jdg-ffffffffffff") },
    [COLLECTIONS.segments]: { a: segment("seg1", ["Roti habis.", "", "Oke."]), b: segment("seg2", ["Lain."], OTHER, "jdg-ffffffffffff") },
    [COLLECTIONS.labelUnits]: { u1: { outlet_id: SBX, device_id: JDG, unit_key: "u1", line_ids: ["seg1#0"], status: "done", attempts: 1, labelled_at_ms: T0 - 30_000 }, u2: { outlet_id: SBX, device_id: JDG, unit_key: "u2", line_ids: ["seg1#2"], status: "pending", attempts: 0, labelled_at_ms: null } },
    [COLLECTIONS.questions]: { q1: { outlet_id: SBX, device_id: JDG, question_id: "q1", thread_id: "th1", kind: "gate", status: "open", category: "CUSTOMER_SERVICE", window_start_ms: T0 - 115_000, window_end_ms: T0 - 100_000, created_at_ms: T0 - 30_000 }, q2: { outlet_id: OTHER, device_id: "jdg-ffffffffffff", status: "open" } },
    [COLLECTIONS.proposals]: { p1: { outlet_id: SBX, content: null }, p2: { outlet_id: OTHER, content: { change_title: "x" } } },
  };
}

const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => errorSpy.mockClear());

describe("firestoreNextDayStore.readGuardState (read-only, scoped to the outlet and the device)", () => {
  it("reads this device's state only: the other sandbox's open session, lines, question and proposal content are invisible", async () => {
    const f = fakeDb(seedSandbox());
    const state = await firestoreNextDayStore(f.db).readGuardState(SBX, JDG, T0);
    expect(state).toEqual({
      session_open: false,
      last_ended: last,
      pending_unlabelled_lines: 1, // seg1#2 "Oke." is only pending (not done/failed); seg1#1 is blank
      proposal_with_content: false,
      proposal_lock_live: false,
      open_questions: 1,
    });
    expect(f.writes).toEqual([]);
    for (const q of f.queries) expect(q.filters.some(([field, , v]) => field === "outlet_id" && v === SBX)).toBe(true);
  });

  it("session_open, proposal_with_content and a live proposal lock are seen; an expired lock is not", async () => {
    const seed = seedSandbox();
    seed[COLLECTIONS.captureSessions]![`${JDG}:22222222-2222-4222-8222-222222222222`] = session(null, SBX, JDG, "22222222-2222-4222-8222-222222222222");
    seed[COLLECTIONS.proposals]!.p1 = { outlet_id: SBX, content: { change_title: "y" } };
    const withLock = { ...seed, [COLLECTIONS.proposalLocks]: { [SBX]: { outlet_id: SBX, lease_token: S1, acquired_at_ms: T0 - 1, expires_at_ms: T0 + 1 } } };
    const live = await firestoreNextDayStore(fakeDb(withLock).db).readGuardState(SBX, JDG, T0);
    expect(live).toMatchObject({ session_open: true, proposal_with_content: true, proposal_lock_live: true });
    withLock[COLLECTIONS.proposalLocks]![SBX]!.expires_at_ms = T0;
    expect((await firestoreNextDayStore(fakeDb(withLock).db).readGuardState(SBX, JDG, T0)).proposal_lock_live).toBe(false);
  });

  it("pending lines count only the LATEST ended non-discarded session; a missing device reads as no last_ended", async () => {
    const seed = seedSandbox();
    seed[COLLECTIONS.segments]!.a = segment("seg1", ["Lama."], SBX, JDG, "33333333-3333-4333-8333-333333333333"); // an older session's line
    expect((await firestoreNextDayStore(fakeDb(seed).db).readGuardState(SBX, JDG, T0)).pending_unlabelled_lines).toBe(0);
    delete seed[COLLECTIONS.devices]![deviceDocId(SBX, JDG)];
    expect((await firestoreNextDayStore(fakeDb(seed).db).readGuardState(SBX, JDG, T0)).last_ended).toBeNull();
  });
});

describe("firestoreNextDayStore marker (G7) and completion", () => {
  it("takeShiftMarker sets the marker only when it is null/absent; a second take reports the existing one", async () => {
    const f = fakeDb(seedSandbox());
    const store = firestoreNextDayStore(f.db);
    expect(await store.takeShiftMarker(SBX, T0)).toEqual({ taken: true });
    expect((f.cols.get(COLLECTIONS.outlets)!.get(SBX)!.sandbox as Doc).shift_started_at_ms).toBe(T0);
    expect(await store.takeShiftMarker(SBX, T0 + 5)).toEqual({ taken: false, started_at_ms: T0 });
    await store.abortShift(SBX);
    expect((f.cols.get(COLLECTIONS.outlets)!.get(SBX)!.sandbox as Doc).shift_started_at_ms).toBeNull();
    expect(await store.takeShiftMarker(SBX, T0 + 9)).toEqual({ taken: true });
    await store.completeShift(SBX);
    expect(f.cols.get(COLLECTIONS.outlets)!.get(SBX)!.sandbox).toMatchObject({ next_day_count: 1, shift_started_at_ms: null, key_sha256: "a".repeat(64) });
    await store.takeShiftMarker(SBX, T0 + 20);
    await store.completeShift(SBX);
    expect((f.cols.get(COLLECTIONS.outlets)!.get(SBX)!.sandbox as Doc).next_day_count).toBe(2);
  });

  it("refuses a non-sandbox outlet (no marker written) and a missing outlet", async () => {
    const f = fakeDb({ [COLLECTIONS.outlets]: { [SBX]: { ...outlet(), sandbox: undefined } } });
    const store = firestoreNextDayStore(f.db);
    await expect(store.takeShiftMarker(SBX, T0)).rejects.toThrow(/not a sandbox/);
    await expect(store.takeShiftMarker("outlet-1", T0)).rejects.toThrow(/not a sandbox/);
    await expect(store.completeShift(SBX)).rejects.toThrow(/not a sandbox/);
    expect(f.writes).toEqual([]);
  });

  it("the lease is the device's pipeline lock (pipeline_locks/{outlet}:{device}); released with its own token", async () => {
    const f = fakeDb(seedSandbox());
    const store = firestoreNextDayStore(f.db);
    const token = await store.acquireLease(SBX, JDG, T0, 120_000);
    expect(token).toBe(T0);
    expect(f.cols.get(COLLECTIONS.pipelineLocks)!.get(`${SBX}:${JDG}`)).toMatchObject({ outlet_id: SBX, device_id: JDG, expires_at_ms: T0 + 120_000 });
    expect(await store.acquireLease(SBX, JDG, T0 + 1, 120_000)).toBeNull();
    await store.releaseLease(SBX, JDG, token!);
    expect(f.cols.get(COLLECTIONS.pipelineLocks)!.has(`${SBX}:${JDG}`)).toBe(false);
  });
});

describe("firestoreNextDayStore.readShiftDocs / writeShift", () => {
  it("reads the seven collections for this outlet only, raw data with ids, each bounded by the limit", async () => {
    const f = fakeDb(seedSandbox());
    const docs = await firestoreNextDayStore(f.db).readShiftDocs(SBX, 10);
    expect(docs.map((d) => `${d.collection}/${d.id}`).sort()).toEqual(["capture_sessions/jdg-0123456789ab:" + S1, "label_units/u1", "label_units/u2", "proposals/p1", "questions/q1", "segments/a"].sort());
    expect(docs.find((d) => d.collection === COLLECTIONS.segments)!.data).toBe(f.cols.get(COLLECTIONS.segments)!.get("a")); // raw, same object
    expect(f.queries.every((q) => q.limit === 10)).toBe(true);
    expect(f.queries.map((q) => q.col).sort()).toEqual(["capture_sessions", "corrections", "label_units", "proposals", "questions", "segments", "threads"]);
    expect((await firestoreNextDayStore(f.db).readShiftDocs(SBX, 1)).filter((d) => d.collection === COLLECTIONS.labelUnits)).toHaveLength(1);
  });

  it("writes with set in batches of WRITE_BATCH_MAX, same ids, then updates only the device's last_ended", async () => {
    const f = fakeDb(seedSandbox());
    const docs = Array.from({ length: WRITE_BATCH_MAX + 1 }, (_, i) => ({ collection: COLLECTIONS.labelUnits, id: `u${i}`, data: { outlet_id: SBX, device_id: JDG, unit_key: `u${i}` } }));
    const shiftedLast = { ...last, business_date: "2026-10-13", ended_at_ms: last.ended_at_ms - 86_400_000, debrief_ends_at_ms: last.debrief_ends_at_ms - 86_400_000 };
    await firestoreNextDayStore(f.db).writeShift(SBX, { docs, last_ended: { device_id: JDG, last_ended: shiftedLast } });
    expect(f.batchSizes).toEqual([WRITE_BATCH_MAX, 1]);
    expect(f.writes.filter((w) => w.op === "set")).toHaveLength(WRITE_BATCH_MAX + 1);
    const dev = f.cols.get(COLLECTIONS.devices)!.get(deviceDocId(SBX, JDG))!;
    expect(dev.last_ended).toEqual(shiftedLast);
    expect(dev.label).toBe("Judge phone");
  });

  it("refuses, before any write, a doc whose outlet_id is not this sandbox or a non-sbx outlet id", async () => {
    const f = fakeDb(seedSandbox());
    const store = firestoreNextDayStore(f.db);
    await expect(store.writeShift(SBX, { docs: [{ collection: COLLECTIONS.threads, id: "t", data: { outlet_id: OTHER } }], last_ended: null })).rejects.toThrow(/outside/);
    await expect(store.writeShift("outlet-1", { docs: [{ collection: COLLECTIONS.threads, id: "t", data: { outlet_id: "outlet-1" } }], last_ended: null })).rejects.toThrow(/sandbox/);
    expect(f.writes).toEqual([]);
  });

  it("expireOpenQuestions is the tick store's: the open question of the ended day goes unverified at the shifted debrief end", async () => {
    const f = fakeDb(seedSandbox());
    const n = await firestoreNextDayStore(f.db).expireOpenQuestions(SBX, JDG, T0 - 1, T0);
    expect(n).toBe(1);
    expect(f.cols.get(COLLECTIONS.questions)!.get("q1")).toMatchObject({ status: "unverified", expired_by_debrief_end_ms: T0 - 1 });
    expect(f.cols.get(COLLECTIONS.questions)!.get("q2")!.status).toBe("open");
  });
});
