import type { Segment } from "@/lib/firestore/schema";

/**
 * SegmentStore interface (R-04, slice 0). Frozen first, next to where the segment
 * service will live (the pattern from lib/capture/services.ts: interfaces here,
 * Firestore implementation in lib/firestore/stores.ts).
 *
 * Idempotency is the whole point of this store: a segment doc id is deterministic
 * (`${outlet_id}:${device_id}:${seg_id}`), and `create` uses Firestore
 * `docRef.create()` (never `.set()`) so a re-uploaded segment cannot overwrite an
 * existing one. An ALREADY_EXISTS collision is a normal, expected result — the
 * caller maps it to 200, not an error.
 */

/** The three ids that uniquely identify a segment (from claims + the URL path). */
export interface SegmentKey {
  outlet_id: string;
  device_id: string;
  seg_id: string;
}

/**
 * Deterministic Firestore doc id for a segment. Colon-joined so a re-upload of
 * the same `seg_id` always targets the same document (idempotency). The ids are
 * validated upstream (SegmentMetadataSchema / parseSegmentPath) and never contain
 * a colon that could shift the key boundaries.
 */
export function segmentDocId(key: SegmentKey): string {
  return `${key.outlet_id}:${key.device_id}:${key.seg_id}`;
}

/**
 * Outcome of `create`. `already_exists` means the deterministic doc was already
 * present (a duplicate upload) — the route returns 200 with no second model call.
 */
export type SegmentCreateResult =
  | { status: "created" }
  | { status: "already_exists" };

export interface SegmentStore {
  /** Reads a segment for the idempotency pre-check, or null if not stored. */
  get(key: SegmentKey): Promise<Segment | null>;
  /**
   * Creates a segment with `docRef.create()`. Returns `already_exists` when the
   * doc is already present (Firestore ALREADY_EXISTS), never overwriting it.
   */
  create(segment: Segment): Promise<SegmentCreateResult>;
}
