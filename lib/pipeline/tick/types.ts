import type { Category, WorkCategory } from "@/lib/pipeline/categories";
import type { GateDecision } from "@/lib/pipeline/gate";
import type { LastEnded } from "@/lib/firestore/schema";

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
  /**
   * Tech-lead review round 2, finding 4: carried forward so a thread held
   * `open` by a label conflict can't lose that flag on a later clean
   * merge — `toStoredThread`/`mergeThread` read and write this back.
   */
  label_conflict: boolean;
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
  /**
   * Transactional single-flight lease acquire (overwrites an expired or
   * malformed lock doc; see `PipelineLockSchema`). Returns the lease's own
   * `acquired_at_ms` (this acquisition's release token) when acquired, or
   * `null` when already held (and not expired).
   *
   * Tech-lead review round 2, finding 2: the caller must pass this exact
   * token back to `releaseLease` — a bare "release my device's lease"
   * would let a tick whose TTL already expired delete a LATER tick's
   * lease out from under it.
   */
  acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<number | null>;
  /**
   * Releases the lease only if it still holds the given `acquiredAtMs`
   * token (a transaction) — never deletes a lease a later acquisition
   * already holds.
   */
  releaseLease(outletId: string, deviceId: string, acquiredAtMs: number): Promise<void>;
  /** Persists one unit's full result (threads, questions, ledger, non-work blanking) together. */
  writeUnitResult(outletId: string, deviceId: string, batch: UnitWriteBatch): Promise<void>;
  /** This device's own `devices/{id}.last_ended` (R-07 debrief-end expiry). */
  getLastEnded(outletId: string, deviceId: string): Promise<LastEnded | null>;
  /**
   * Expires every `open` question of this device created at or before
   * `debriefEndsAtMs`, to `unverified` (R-07, `expireAtDebriefEnd`); a
   * `kind: "gate"` question's still-`open`, not-yet-excluded thread is set
   * `unverified` too. Returns the number of questions expired.
   */
  expireOpenQuestions(
    outletId: string,
    deviceId: string,
    debriefEndsAtMs: number,
    nowMs: number,
  ): Promise<number>;
}
