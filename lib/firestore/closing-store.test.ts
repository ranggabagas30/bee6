import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { firestoreClosingStore } from "@/lib/firestore/closing-store";
import type { CaptureSession } from "@/lib/firestore/schema";

/**
 * R-19 PR-4a: the thin Firestore adapter behind `jumpToClosing`. A tiny in-memory model of the Admin surface it
 * uses: doc get, a three-equality segments query (the index the discard delete already uses) narrowed with
 * `select("lines")`, and a transaction that re-reads the session before the one `update`.
 */
const SID = "11111111-1111-4111-8111-111111111111";
const OUTLET = "sbx-0123456789ab";
const DEVICE = "jdg-0123456789ab";
const NOW = Date.parse("2026-10-14T05:00:00Z");

const open: CaptureSession = {
  outlet_id: OUTLET,
  device_id: DEVICE,
  session_id: SID,
  started_at_ms: NOW - 60_000,
  ended_at_ms: null,
  end_reason: null,
  local_date: "2026-10-14",
  auto_stop_at_ms: NOW + 540_000,
  debrief_ends_at_ms: null,
  received_start_at: new Date(NOW - 60_000).toISOString(),
  received_end_at: null,
};

type Doc = Record<string, unknown>;

function fakeDb(seed: { sessions?: Record<string, Doc>; segments?: Doc[] } = {}) {
  const sessions = new Map(Object.entries(seed.sessions ?? {}));
  const segments = seed.segments ?? [];
  const log: string[] = [];
  const docRef = (id: string) => ({
    id,
    async get() {
      const d = sessions.get(id);
      return { exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) };
    },
  });
  const query = (filters: [string, unknown][], fields: string[] = []) => ({
    where: (f: string, _op: string, v: unknown) => query([...filters, [f, v]], fields),
    select: (...s: string[]) => query(filters, s),
    async get() {
      log.push(`segments:${filters.map(([f, v]) => `${f}=${String(v)}`).join("&")}|select=${fields.join(",")}`);
      const docs = segments
        .filter((d) => filters.every(([f, v]) => d[f] === v))
        .map((d) => ({ data: () => Object.fromEntries(Object.entries(d).filter(([k]) => fields.length === 0 || fields.includes(k))) }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const db = {
    collection(name: string) {
      if (name === "capture_sessions") return { doc: docRef };
      if (name === "segments") return query([]);
      throw new Error(`unexpected collection ${name}`);
    },
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: Array<[string, Doc]> = [];
      const tx = {
        get: (ref: { id: string }) => docRef(ref.id).get(),
        update: (ref: { id: string }, data: Doc) => writes.push([ref.id, data]),
      };
      const out = await fn(tx);
      for (const [id, data] of writes) sessions.set(id, { ...sessions.get(id), ...data });
      log.push(`tx:${writes.length}`);
      return out;
    },
  };
  return { db: db as unknown as Firestore, sessions, log };
}

const key = { device_id: DEVICE, session_id: SID };
const docId = `${DEVICE}:${SID}`;

describe("firestoreClosingStore", () => {
  it("getSession parses the doc at {device}:{session} and returns null when missing", async () => {
    const f = fakeDb({ sessions: { [docId]: open } });
    const store = firestoreClosingStore(OUTLET, f.db);
    expect(await store.getSession(key)).toEqual(open);
    expect(await store.getSession({ ...key, session_id: "22222222-2222-4222-8222-222222222222" })).toBeNull();
  });

  it("countLines sums lines.length over the outlet+device+session segments, reading only the lines field", async () => {
    const seg = (session_id: string, n: number, extra: Doc = {}) => ({
      outlet_id: OUTLET,
      device_id: DEVICE,
      session_id,
      lines: Array.from({ length: n }, (_, i) => ({ text: `t${i}`, start: i, end: i + 1 })),
      ...extra,
    });
    const f = fakeDb({
      segments: [
        seg(SID, 2),
        seg(SID, 3),
        seg(SID, 0),
        seg("33333333-3333-4333-8333-333333333333", 9),
        seg(SID, 4, { device_id: "jdg-other" }),
        { outlet_id: OUTLET, device_id: DEVICE, session_id: SID }, // malformed: no lines → counts 0, never throws
      ],
    });
    const store = firestoreClosingStore(OUTLET, f.db);
    expect(await store.countLines({ ...key, outlet_id: OUTLET })).toBe(5);
    expect(f.log).toEqual([`segments:outlet_id=${OUTLET}&device_id=${DEVICE}&session_id=${SID}|select=lines`]);
  });

  it("markClosing sets demo_closing_at_ms on an open, unmarked session inside a transaction", async () => {
    const f = fakeDb({ sessions: { [docId]: open } });
    await firestoreClosingStore(OUTLET, f.db).markClosing(key, NOW);
    expect(f.sessions.get(docId)?.demo_closing_at_ms).toBe(NOW);
    expect(f.log).toEqual(["tx:1"]);
  });

  it("markClosing writes nothing when the session is missing, ended, or already marked", async () => {
    for (const doc of [undefined, { ...open, ended_at_ms: NOW, end_reason: "auto_stop" }, { ...open, demo_closing_at_ms: NOW - 9 }]) {
      const f = fakeDb(doc ? { sessions: { [docId]: doc } } : {});
      await firestoreClosingStore(OUTLET, f.db).markClosing(key, NOW);
      expect(f.log).toEqual(["tx:0"]);
      if (doc) expect(f.sessions.get(docId)).toEqual(doc);
    }
  });
});
