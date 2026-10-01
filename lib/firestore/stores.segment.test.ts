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
