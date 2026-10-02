import type { Category, WorkCategory } from "@/lib/pipeline/categories";
import type { GateDecision } from "@/lib/pipeline/gate";

/**
 * Store interfaces for the pipeline tick (R-05b, Task 6). Pure interfaces
 * here, Firestore implementation in `lib/firestore/tick-store.ts` — same
 * split as `lib/capture/segment-types.ts` / `lib/firestore/stores.ts`, so
 * `lib/pipeline/tick/service.ts`'s orchestration logic is unit-testable
 * with an in-memory fake, never a real Firestore call.
 */

export interface ActiveDevice {
  outlet_id: string;
  device_id: string;
}

/** The subset of a `Segment` doc the tick needs to rebuild windows/units. */
export interface SegmentForTick {
  seg_id: string;
  device_start: string;
  device_end: string;
  received_at: string;
  lines: { text: string; start: number; end: number }[];
}

/** A previously-stored thread, read back for the Decision-4 merge rule. */
export interface StoredThread {
  thread_id: string;
  category: WorkCategory;
  confidence: number;
  line_ids: string[];
  evidence_line_ids: string[];
  lines: Array<{ line_id: string; start_ms: number; end_ms: number; text: string }>;
  first_line_start_ms: number;
  last_line_end_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
  runner_up?: { category: Category; why_not: string };
  status: "fact" | "open" | "unverified";
  created_at_ms: number;
}

/** Just enough of a stored thread to feed `openThreadsAt` for this tick. */
export interface RecentThreadSummary {
  thread_id: string;
  category: WorkCategory;
  last_line_end_ms: number;
}

export interface ThreadWrite {
  outlet_id: string;
  device_id: string;
  thread_id: string;
  category: WorkCategory;
  confidence: number;
  line_ids: string[];
  evidence_line_ids: string[];
  lines: Array<{ line_id: string; start_ms: number; end_ms: number; text: string }>;
  first_line_start_ms: number;
  last_line_end_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
  runner_up?: { category: Category; why_not: string };
  label_conflict: boolean;
  status: "fact" | "open" | "unverified";
  gate: GateDecision;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface QuestionWrite {
  outlet_id: string;
  device_id: string;
  question_id: string;
  thread_id: string | null;
  kind: "gate" | "unlabelled_unit";
  status: "open" | "unverified";
  category: Category | null;
  window_start_ms: number;
  window_end_ms: number;
  created_at_ms: number;
}

export interface LedgerWrite {
  outlet_id: string;
  device_id: string;
  unit_key: string;
  line_ids: string[];
  status: "done" | "failed";
  attempts: number;
  labelled_at_ms: number | null;
}

/** Everything one unit's processing produces, persisted together. */
export interface UnitWriteBatch {
  threads: ThreadWrite[];
  questions: QuestionWrite[];
  ledger: LedgerWrite;
  /** line_ids whose text should be blanked (count-only) in their source segment. */
  blank_line_ids: string[];
}

export interface TickStore {
  /** Devices eligible for a tick this round (paired, not revoked). */
  listActiveDevices(): Promise<ActiveDevice[]>;
  /**
   * Scrub names for an outlet's staff — includes BOTH the full stored
   * `name` and its first token (nickname), per PR1 tech-lead review: a
   * transcript saying just "Budi" must still match staff named
   * "Budi Santoso".
   */
  listStaffScrubNames(outletId: string): Promise<string[]>;
  /** Every non-expired segment for a device (windowing recomputes from these each tick). */
  listSegmentsForDevice(outletId: string, deviceId: string): Promise<SegmentForTick[]>;
  /** Every line_id already labelled (ledger status "done" OR "failed" — both terminal). */
  listLabelledLineIds(outletId: string, deviceId: string): Promise<Set<string>>;
  /** Stored threads for this device whose last_line_end_ms is at or after `sinceMs`. */
  listRecentThreads(outletId: string, deviceId: string, sinceMs: number): Promise<RecentThreadSummary[]>;
  /** The full stored thread, for the Decision-4 merge when continuing it. */
  getStoredThread(outletId: string, threadId: string): Promise<StoredThread | null>;
  /** `create()`-semantics lease acquire. Returns false when already held (and not expired). */
  acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<boolean>;
  releaseLease(outletId: string, deviceId: string): Promise<void>;
  /** Persists one unit's full result (threads, questions, ledger, non-work blanking) together. */
  writeUnitResult(outletId: string, deviceId: string, batch: UnitWriteBatch): Promise<void>;
}
