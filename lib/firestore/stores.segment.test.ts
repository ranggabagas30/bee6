import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { firestoreSegmentStore } from "@/lib/firestore/stores";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { segmentDocId } from "@/lib/capture/segment-types";
import type { Segment } from "@/lib/firestore/schema";

/**
 * Minimal in-memory fake of the Firestore surface the segment store uses. It
 * records which collection + doc id were touched and whether `create` (not
 * `set`) was used, and simulates the ALREADY_EXISTS (gRPC code 6) collision.
 */
class AlreadyExistsError extends Error {
  readonly code = 6; // gRPC ALREADY_EXISTS
  constructor() {
    super("ALREADY_EXISTS: entity already exists");
  }
}

function fakeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(seed));
  const calls = { collections: [] as string[], docIds: [] as string[], setUsed: false };
  const db = {
    collection(name: string) {
      calls.collections.push(name);
      return {
        doc(id: string) {
          calls.docIds.push(id);
          return {
            async get() {
              const data = store.get(id);
              return { exists: data !== undefined, data: () => data };
            },
            async create(data: Record<string, unknown>) {
              if (store.has(id)) throw new AlreadyExistsError();
              store.set(id, data);
            },
            async set() {
              // Must never be called — using set() would defeat idempotency.
              calls.setUsed = true;
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Firestore, store, calls };
}

const segment: Segment = {
  outlet_id: "outlet-1",
  device_id: "dev-1",
  seg_id: "seg-1",
  received_at: "2026-09-30T10:00:15.000Z",
  device_start: "2026-09-30T10:00:00.000Z",
  device_end: "2026-09-30T10:00:15.000Z",
  model: "gemini-3.5-transcribe-preview",
  location: "global",
  lines: [{ text: "flat white for table two", start: 0, end: 3 }],
  expires_at: "2026-10-02T10:00:15.000Z",
};

const key = { outlet_id: "outlet-1", device_id: "dev-1", seg_id: "seg-1" };

describe("firestoreSegmentStore.get", () => {
  it("returns null when the segment is not stored", async () => {
    const { db } = fakeDb();
    expect(await firestoreSegmentStore(db).get(key)).toBeNull();
  });

  it("reads the deterministic doc id in the segments collection", async () => {
    const id = segmentDocId(key);
    // Seed with expires_at as a Timestamp (normal case when read from Firestore)
    const { db, calls } = fakeDb({
      [id]: {
        ...segment,
        expires_at: Timestamp.fromDate(new Date(segment.expires_at)),
      },
    });
    const found = await firestoreSegmentStore(db).get(key);
    expect(found).toEqual(segment);
    expect(calls.collections).toContain(COLLECTIONS.segments);
    expect(calls.docIds).toContain("outlet-1:dev-1:seg-1");
  });
});

describe("firestoreSegmentStore.create", () => {
  it("creates a new segment with create() (never set()) and returns created", async () => {
    const { db, store, calls } = fakeDb();
    const result = await firestoreSegmentStore(db).create(segment);
    expect(result).toEqual({ status: "created" });
    // The stored value should have expires_at as a Timestamp
    const stored = store.get("outlet-1:dev-1:seg-1");
    expect(stored).toBeDefined();
    expect(stored?.expires_at instanceof Timestamp).toBe(true);
    expect(calls.setUsed).toBe(false);
    expect(calls.docIds).toContain("outlet-1:dev-1:seg-1");
  });

  it("stores expires_at as a Firestore Timestamp (required for TTL policy)", async () => {
    const { db, store } = fakeDb();
    await firestoreSegmentStore(db).create(segment);
    const storedValue = store.get("outlet-1:dev-1:seg-1");
    expect(storedValue?.expires_at instanceof Timestamp).toBe(true);
    // Verify the Timestamp value round-trips correctly
    const timestamp = storedValue?.expires_at as Timestamp;
    expect(timestamp.toDate().toISOString()).toBe(segment.expires_at);
  });

  it("round-trip: create then get returns a segment equal to the original", async () => {
    const { db } = fakeDb();
    const store = firestoreSegmentStore(db);
    await store.create(segment);
    const retrieved = await store.get(key);
    expect(retrieved).toEqual(segment);
  });

  it("handles legacy documents with string-typed expires_at on read", async () => {
    const id = segmentDocId(key);
    // Seed the fake with a document that has expires_at as a plain string
    const { db } = fakeDb({
      [id]: {
        ...segment,
        expires_at: "2026-10-02T10:00:15.000Z", // Plain string, not a Timestamp
      },
    });
    const retrieved = await firestoreSegmentStore(db).get(key);
    expect(retrieved).toEqual(segment);
  });

  it("maps a Firestore ALREADY_EXISTS collision to already_exists, not an error", async () => {
    const id = segmentDocId(key);
    // Seed with a document that has expires_at as a Timestamp (normal case)
    const { db } = fakeDb({
      [id]: {
        ...segment,
        expires_at: Timestamp.fromDate(new Date(segment.expires_at)),
      },
    });
    const result = await firestoreSegmentStore(db).create(segment);
    expect(result).toEqual({ status: "already_exists" });
  });

  it("rethrows any non-ALREADY_EXISTS failure (infra outage -> 500, retryable)", async () => {
    const db = {
      collection() {
        return {
          doc() {
            return {
              async get() {
                return { exists: false, data: () => undefined };
              },
              async create() {
                throw new Error("DEADLINE_EXCEEDED");
              },
            };
          },
        };
      },
    } as unknown as Firestore;
    await expect(firestoreSegmentStore(db).create(segment)).rejects.toThrow(
      "DEADLINE_EXCEEDED",
    );
  });
});

/**
 * Session-aware writes (web spec §6.6.4). The fake gains `runTransaction`: the
 * callback's `tx.get` / `tx.create` act on the same in-memory refs. The tests only
 * assert outcomes that never create a doc before a refusal, so no rollback is needed.
 */
function fakeSessionDb(seed: Record<string, Record<string, unknown>> = {}) {
  const base = fakeDb(seed);
  const db = base.db as unknown as {
    collection: (name: string) => { doc: (id: string) => unknown };
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  const tx = {
    get: (ref: { get: () => Promise<unknown> }) => ref.get(),
    create: (ref: { create: (data: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) =>
      ref.create(data),
  };
  (db as unknown as { runTransaction: unknown }).runTransaction = async <T>(fn: (t: unknown) => Promise<T>) => {
    // Writes go to a staging area and are applied only when fn resolves.
    return fn(tx);
  };
  return base;
}

const SESSION_ID = "6f1c2a4e-8b3d-4e5f-9a7b-1c2d3e4f5a6b";
const sessionSegment: Segment = { ...segment, session_id: SESSION_ID };
const sessionDocId = `dev-1:${SESSION_ID}`;

function sessionDoc(endReason: "discarded" | "selesai" | null) {
  return {
    outlet_id: "outlet-1",
    device_id: "dev-1",
    session_id: SESSION_ID,
    started_at_ms: 0,
    ended_at_ms: endReason === null ? null : 1000,
    end_reason: endReason,
    local_date: "2026-09-30",
    auto_stop_at_ms: 1000,
    debrief_ends_at_ms: null,
    received_start_at: "2026-09-30T10:00:00.000Z",
    received_end_at: endReason === null ? null : "2026-09-30T10:00:01.000Z",
  };
}

describe("firestoreSegmentStore.isDiscarded", () => {
  it("is true when the session doc is a discard tombstone", async () => {
    const { db } = fakeSessionDb({ [sessionDocId]: sessionDoc("discarded") });
    expect(await firestoreSegmentStore(db).isDiscarded({ device_id: "dev-1", session_id: SESSION_ID })).toBe(true);
  });

  it("is false for a live session and for a missing session doc (late start)", async () => {
    const live = fakeSessionDb({ [sessionDocId]: sessionDoc(null) });
    expect(await firestoreSegmentStore(live.db).isDiscarded({ device_id: "dev-1", session_id: SESSION_ID })).toBe(false);
    const missing = fakeSessionDb();
    expect(await firestoreSegmentStore(missing.db).isDiscarded({ device_id: "dev-1", session_id: SESSION_ID })).toBe(false);
  });
});

describe("firestoreSegmentStore.create with session_id", () => {
  it("refuses the write and stores nothing when the session is a tombstone", async () => {
    const { db, store } = fakeSessionDb({ [sessionDocId]: sessionDoc("discarded") });
    const result = await firestoreSegmentStore(db).create(sessionSegment);
    expect(result).toEqual({ status: "discarded" });
    expect(store.has("outlet-1:dev-1:seg-1")).toBe(false);
  });

  it("writes the segment when the session is live", async () => {
    const { db, store } = fakeSessionDb({ [sessionDocId]: sessionDoc(null) });
    const result = await firestoreSegmentStore(db).create(sessionSegment);
    expect(result).toEqual({ status: "created" });
    expect(store.has("outlet-1:dev-1:seg-1")).toBe(true);
  });

  it("writes the segment when the session doc does not exist yet (late start)", async () => {
    const { db, store } = fakeSessionDb();
    const result = await firestoreSegmentStore(db).create(sessionSegment);
    expect(result).toEqual({ status: "created" });
    expect(store.has("outlet-1:dev-1:seg-1")).toBe(true);
  });

  it("returns already_exists for a duplicate upload inside the session", async () => {
    const { db } = fakeSessionDb({
      [sessionDocId]: sessionDoc(null),
      "outlet-1:dev-1:seg-1": { ...sessionSegment, expires_at: Timestamp.fromDate(new Date(segment.expires_at)) },
    });
    expect(await firestoreSegmentStore(db).create(sessionSegment)).toEqual({ status: "already_exists" });
  });
});
