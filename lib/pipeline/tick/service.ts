import type { Category, WorkCategory } from "@/lib/pipeline/categories";
import { loadCategoriesConfig, type CategoriesConfig } from "@/lib/pipeline/label/config";
import { buildLabelPrompt } from "@/lib/pipeline/label/prompt";
import { buildLabelWireSchema, generateResponseJsonSchema } from "@/lib/pipeline/label/wire-schema";
import { callLabelModel, type LabelClientDeps } from "@/lib/pipeline/label/client";
import type { LabelWireOutput } from "@/lib/pipeline/label/wire-schema";
import { mapToUnitOutcome, buildFailedUnitQuestion } from "@/lib/pipeline/label/failure";
import { filterUnlabelledLines } from "@/lib/pipeline/label/ledger";
import { scrubUnitLines } from "@/lib/pipeline/label/scrub";
import { sanitizeLabelOutput, type SanitizeDeps } from "@/lib/pipeline/label/sanitize";
import { deriveAsOfMs } from "@/lib/pipeline/label/clock";
import { buildWindows, planLabelUnits, earliestLineStartMs, type LabelUnit, type SegmentForWindowing } from "@/lib/pipeline/windowing";
import { buildThreads, openThreadsAt, type BuiltThread, type OpenThread, type LabelOutput } from "@/lib/pipeline/threads";
import { evaluateGate, applyGateDecision } from "@/lib/pipeline/gate";
import { remapOpenThreadAliases } from "@/lib/pipeline/tick/alias";
import type {
  LedgerWrite,
  QuestionWrite,
  RecentThreadSummary,
  StoredThread,
  ThreadWrite,
  TickStore,
} from "@/lib/pipeline/tick/types";

/**
 * Pipeline tick orchestration (R-05b, Task 6). Pure(ish) — all I/O goes
 * through the injected `TickStore` and label client deps, so this module
 * is unit-tested end to end with in-memory fakes. The Next.js route
 * (`app/api/internal/pipeline/tick/route.ts`) is a thin wrapper: OIDC
 * check, then `runTick` with real Firestore-backed deps.
 *
 * Per device, in order: acquire lease -> load segments -> derive as_of_ms
 * (newest-segment-only, Decision 7) -> build windows/units (R-05a,
 * unchanged) -> filter already-labelled lines (Task 5's ledger) -> up to
 * 20 units, oldest-first: scrub staff names on the INPUT unit (Decision 8)
 * -> label call (bounded retry) -> sanitize -> buildThreads/evaluateGate
 * (R-05a, unchanged) -> merge into any continued open thread
 * (Decision 4) -> persist thread + question + ledger + non-work blanking
 * in one store call -> release lease (always, via `finally`).
 */

export const DEFAULT_MAX_UNITS_PER_DEVICE = 20;
/**
 * Tech-lead review round 2, finding 2(b): the old 110s TTL (picked to sit
 * just under the 2-min Scheduler cadence) could expire mid-tick — up to
 * `DEFAULT_MAX_UNITS_PER_DEVICE` (20) units, each up to ~90s worst case
 * (bounded label-call retries + network), is ~1800s (30 min) worst case
 * for one tick. Set to that worst case, with no extra margin beyond it.
 *
 * RANGGA/DEV-OPS ACTION ITEM (flagged, not done here — gcloud/console is
 * out of scope for this task): Cloud Run's own request timeout AND the
 * Cloud Scheduler job's `attemptDeadline` must each be configured to at
 * least this value too, or a tick can still be killed mid-run before this
 * lease would ever expire on its own. Cloud Scheduler's `attemptDeadline`
 * hard cap is itself 30 min — if the real per-unit worst case is ever
 * found (via production data) to exceed ~90s, `DEFAULT_MAX_UNITS_PER_DEVICE`
 * needs lowering together with this, not just this TTL raised further.
 */
export const DEFAULT_LEASE_TTL_MS = 1_800_000; // 30 min — see comment above
export const DEFAULT_LABEL_MAX_ATTEMPTS = 3;
/** Covers every category's GRACE_MS (max 600s, TRAINING) with margin. */
export const DEFAULT_RECENT_THREAD_LOOKBACK_MS = 900_000;

export interface RunTickDeps {
  store: TickStore;
  now_ms: number;
  config?: CategoriesConfig;
  labelClientDeps?: LabelClientDeps;
  sanitizeDeps?: SanitizeDeps;
  maxUnitsPerDevice?: number;
  leaseTtlMs?: number;
  recentThreadLookbackMs?: number;
  /** Test seam only: replaces the whitelisted skew log line. */
  logSkew?: (entry: { device_id: string; skew_newest_ms: number; skew_min_ms: number; n_segments: number }) => void;
}

export interface DeviceTickResult {
  outlet_id: string;
  device_id: string;
  /**
   * Tech-lead re-review, finding 1: `"error"` covers anything that throws
   * in `processOneDevice` OUTSIDE `processOneUnit`'s own try/catch (lease
   * acquire on a malformed lock doc, the store reads before the per-unit
   * loop, or `releaseLease`'s `finally`) — caught in `runTick` so one
   * device's failure never aborts the whole tick for every later device.
   */
  skipped_reason: "lease_held" | "no_segments" | "error" | null;
  units_processed: number;
  threads_written: number;
  questions_written: number;
  failed_units: number;
}

export interface RunTickResult {
  devices: DeviceTickResult[];
}

function defaultLogSkew(entry: {
  device_id: string;
  skew_newest_ms: number;
  skew_min_ms: number;
  n_segments: number;
}): void {
  console.log("[pipeline-tick] skew", entry);
}

function toSegmentsForWindowing(segments: readonly { seg_id: string; device_start: string; device_end: string; lines: { text: string; start: number; end: number }[] }[]): SegmentForWindowing[] {
  return segments.map((s) => ({
    seg_id: s.seg_id,
    device_start: s.device_start,
    device_end: s.device_end,
    lines: s.lines,
  }));
}

/**
 * Replicates `buildThreads`' own non-work detection (explicit
 * `non_work_lines` plus any line whose thread hint resolves to a
 * NON_WORK-category thread) without changing R-05a's frozen code —
 * `buildThreads` reports only a count, never the line ids, so the tick
 * needs its own pass to know WHICH lines to blank in the source segment.
 */
function computeNonWorkLineIds(unit: LabelUnit, label: LabelOutput): string[] {
  const numLines = unit.lines.length;
  const nonWorkIdx = new Set<number>();
  for (const idx of label.non_work_lines) {
    if (idx >= 0 && idx < numLines) nonWorkIdx.add(idx);
  }
  const nonWorkThreadIds = new Set(label.threads.filter((t) => t.category === "NON_WORK").map((t) => t.id));
  for (const line of label.lines) {
    if (line.i >= 0 && line.i < numLines && nonWorkThreadIds.has(line.thread)) {
      nonWorkIdx.add(line.i);
    }
  }
  const ids: string[] = [];
  for (const idx of nonWorkIdx) {
    const lineId = unit.lines[idx]?.line_id;
    if (lineId) ids.push(lineId);
  }
  return ids;
}

function dedupeConcat(a: readonly string[], b: readonly string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

type MergedLine = { line_id: string; start_ms: number; end_ms: number; text: string };

/**
 * Tech-lead review round 2, finding 2(c): dedupe by `line_id` as defense
 * in depth — `line_ids`/`evidence_line_ids` are already deduped, but the
 * `lines` array itself was a blind concat, so a line_id that somehow
 * reaches both the stored thread and a new unit's build would be stored
 * twice.
 */
function dedupeLinesConcat(a: readonly MergedLine[], b: readonly MergedLine[]): MergedLine[] {
  const seen = new Set<string>();
  const result: MergedLine[] = [];
  for (const line of [...a, ...b]) {
    if (seen.has(line.line_id)) continue;
    seen.add(line.line_id);
    result.push(line);
  }
  return result;
}

export interface MergedThread {
  category: WorkCategory;
  confidence: number;
  line_ids: string[];
  evidence_line_ids: string[];
  lines: MergedLine[];
  first_line_start_ms: number;
  last_line_end_ms: number;
  summary: string;
  fields?: Record<string, unknown>;
  runner_up?: { category: Category; why_not: string };
  /** Tech-lead review round 2, finding 4: OR'd forward, never dropped on a later clean merge. */
  label_conflict: boolean;
  created_at_ms: number | null; // null => caller stamps now_ms (brand new thread)
}

/** Decision 4: confidence = min(stored, new); lines/evidence accumulate; category is unchanged by construction (buildThreads only continues a thread whose category already matches). */
export function mergeThread(stored: StoredThread | null, built: BuiltThread): MergedThread {
  if (!stored) {
    return {
      category: built.category,
      confidence: built.confidence,
      line_ids: built.line_ids,
      evidence_line_ids: built.evidence_line_ids,
      lines: built.lines,
      first_line_start_ms: built.first_line_start_ms,
      last_line_end_ms: built.last_line_end_ms,
      summary: built.summary,
      fields: built.fields,
      runner_up: built.runner_up,
      label_conflict: built.label_conflict,
      created_at_ms: null,
    };
  }
  return {
    category: built.category,
    confidence: Math.min(stored.confidence, built.confidence),
    line_ids: dedupeConcat(stored.line_ids, built.line_ids),
    evidence_line_ids: dedupeConcat(stored.evidence_line_ids, built.evidence_line_ids),
    lines: dedupeLinesConcat(stored.lines, built.lines),
    first_line_start_ms: Math.min(stored.first_line_start_ms, built.first_line_start_ms),
    last_line_end_ms: Math.max(stored.last_line_end_ms, built.last_line_end_ms),
    summary: stored.summary || built.summary,
    fields: built.fields ?? stored.fields,
    runner_up: built.runner_up ?? stored.runner_up,
    label_conflict: stored.label_conflict || built.label_conflict,
    created_at_ms: stored.created_at_ms,
  };
}

/** Logs only {unit_id, error_class} — never a raw error message (same discipline as the label client, TSD L-T7). */
function classifyUnexpectedError(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return "unknown";
}

async function processOneUnit(input: {
  unit: LabelUnit;
  outlet_id: string;
  device_id: string;
  config: CategoriesConfig;
  staffNames: readonly string[];
  openThreadPool: RecentThreadSummary[];
  now_ms: number;
  store: TickStore;
  labelClientDeps: LabelClientDeps | undefined;
  sanitizeDeps: SanitizeDeps | undefined;
}): Promise<{ threadsWritten: number; questionsWritten: number; failed: boolean }> {
  const { unit, outlet_id, device_id, config, staffNames, openThreadPool, now_ms, store } = input;

  // Tech-lead review round 2, finding 3: `attempts` is lifted out of the
  // `try` block so the catch-path fallback below can report the REAL
  // attempt count reached, instead of a hard-coded 1.
  let attempts = 0;

  try {
    const scrubbedUnit = scrubUnitLines(unit, staffNames);

    // Tech-lead review round 2, finding 3: the gap check that decides
    // whether a stored open thread can still accept this unit must be
    // anchored to THIS UNIT's own start time, not the tick's as_of_ms —
    // as_of_ms is inflated by however long this unit waited to close
    // (silence/cadence), which has nothing to do with the actual gap to a
    // candidate thread. Pool entries whose last_line_end_ms falls AFTER
    // this unit's start are dropped first so the model is never even
    // offered a thread buildThreads' own gap>=0 check would reject anyway
    // (openThreadsAt only bounds the gap from above, not below).
    const unitStartMs = earliestLineStartMs(scrubbedUnit);
    const eligiblePool = openThreadPool.filter((t) => t.last_line_end_ms <= unitStartMs);
    const openThreads: OpenThread[] = openThreadsAt(eligiblePool, unitStartMs);

    const prompt = buildLabelPrompt({ config, unit: scrubbedUnit, open_threads: openThreads });
    const newAliasCount = Math.max(1, Math.min(scrubbedUnit.lines.length, 20));
    const wireSchema = buildLabelWireSchema({ new_alias_count: newAliasCount, open_alias_count: openThreads.length });
    const responseSchema = generateResponseJsonSchema({
      config,
      new_alias_count: newAliasCount,
      open_alias_count: openThreads.length,
    });

    let wire: LabelWireOutput | null = null;
    let failureReason: string | null = null;

    for (let attempt = 1; attempt <= DEFAULT_LABEL_MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      const result = await callLabelModel(
        { unit: scrubbedUnit, prompt, schema: responseSchema, wireSchema },
        input.labelClientDeps,
      );
      const outcome = mapToUnitOutcome({ result, attempt, maxAttempts: DEFAULT_LABEL_MAX_ATTEMPTS });
      if (outcome.kind === "ok") {
        wire = outcome.wire;
        break;
      }
      if (outcome.kind === "failed") {
        failureReason = outcome.reason;
        break;
      }
      // retry: loop again
    }

    if (!wire) {
      const q = buildFailedUnitQuestion(unit);
      const ledger: LedgerWrite = {
        outlet_id,
        device_id,
        unit_key: unit.unit_id,
        line_ids: unit.lines.map((l) => l.line_id),
        status: "failed",
        attempts,
        labelled_at_ms: null,
      };
      const question: QuestionWrite = {
        outlet_id,
        device_id,
        question_id: q.question_id,
        thread_id: null,
        kind: q.kind,
        status: q.status,
        category: null,
        window_start_ms: q.window_start_ms,
        window_end_ms: q.window_end_ms,
        created_at_ms: now_ms,
      };
      await store.writeUnitResult(outlet_id, device_id, {
        threads: [],
        questions: [question],
        ledger,
        blank_line_ids: [],
      });
      void failureReason; // reason is logged by the label client itself; never re-logged here with raw detail
      return { threadsWritten: 0, questionsWritten: 1, failed: true };
    }

    const sanitized = await sanitizeLabelOutput({ wire, config, staffNames }, input.sanitizeDeps);
    // Map echoed O# aliases back to the real stored thread_id BEFORE
    // buildThreads runs — the sanitizer passes O# through unchanged on
    // purpose (PR1 tech-lead review; see lib/pipeline/tick/alias.ts).
    const remapped = remapOpenThreadAliases(sanitized, openThreads);
    const built = buildThreads({ unit: scrubbedUnit, label: remapped, open_threads: openThreads });
    const nonWorkLineIds = computeNonWorkLineIds(scrubbedUnit, remapped);

    const threadWrites: ThreadWrite[] = [];
    const questionWrites: QuestionWrite[] = [];

    for (const builtThread of built.threads) {
      const stored = builtThread.continued_from_open
        ? await store.getStoredThread(outlet_id, builtThread.thread_id)
        : null;
      const merged = mergeThread(stored, builtThread);

      const gate = evaluateGate({
        category: merged.category,
        confidence: merged.confidence,
        evidence_line_ids: merged.evidence_line_ids,
        // Tech-lead review round 2, finding 4: use the MERGED conflict flag
        // (stored || built), never the newly-built unit's own flag alone —
        // otherwise a thread held open by a past conflict could be
        // silently promoted to fact by a later clean continuation.
        label_conflict: merged.label_conflict,
      });

      const existingStatus = stored ? stored.status : null;
      let newStatus = applyGateDecision(existingStatus, gate);
      // Tech-lead review round 2, finding 5 (decision default, lower risk,
      // no new plumbing): a stored thread already `open` stays `open` on
      // a merge — promotion to `fact` only happens via a fresh (non-merge)
      // evaluation, never implicitly through a later unit merging in. This
      // also keeps that thread's existing `q_thread_${id}` question valid
      // instead of going stale (finding's note: the question doc is never
      // closed on this path, so letting status flip to fact under it would
      // leave a "fact" thread with a dangling open question).
      if (existingStatus === "open") {
        newStatus = "open";
      }

      const threadWrite: ThreadWrite = {
        outlet_id,
        device_id,
        thread_id: builtThread.thread_id,
        category: merged.category,
        confidence: merged.confidence,
        line_ids: merged.line_ids,
        evidence_line_ids: merged.evidence_line_ids,
        lines: merged.lines,
        first_line_start_ms: merged.first_line_start_ms,
        last_line_end_ms: merged.last_line_end_ms,
        summary: merged.summary,
        label_conflict: merged.label_conflict,
        status: newStatus,
        gate,
        created_at_ms: merged.created_at_ms ?? now_ms,
        updated_at_ms: now_ms,
      };
      if (merged.fields) threadWrite.fields = merged.fields;
      if (merged.runner_up) threadWrite.runner_up = merged.runner_up;
      threadWrites.push(threadWrite);

      // Keep this tick's own in-memory pool current so a LATER unit in the
      // same device/tick can still continue a thread just written/updated
      // this tick (the store won't necessarily reflect it yet).
      const poolIdx = openThreadPool.findIndex((t) => t.thread_id === builtThread.thread_id);
      const poolEntry: RecentThreadSummary = {
        thread_id: builtThread.thread_id,
        category: merged.category,
        last_line_end_ms: merged.last_line_end_ms,
      };
      if (poolIdx >= 0) openThreadPool[poolIdx] = poolEntry;
      else openThreadPool.push(poolEntry);

      if (newStatus === "open") {
        questionWrites.push({
          outlet_id,
          device_id,
          question_id: `q_thread_${builtThread.thread_id}`,
          thread_id: builtThread.thread_id,
          kind: "gate",
          status: "open",
          category: merged.category,
          window_start_ms: merged.first_line_start_ms,
          window_end_ms: merged.last_line_end_ms,
          created_at_ms: now_ms,
        });
      }
    }

    const ledger: LedgerWrite = {
      outlet_id,
      device_id,
      unit_key: unit.unit_id,
      line_ids: unit.lines.map((l) => l.line_id),
      status: "done",
      attempts,
      labelled_at_ms: now_ms,
    };

    await store.writeUnitResult(outlet_id, device_id, {
      threads: threadWrites,
      questions: questionWrites,
      ledger,
      blank_line_ids: nonWorkLineIds,
    });

    return { threadsWritten: threadWrites.length, questionsWritten: questionWrites.length, failed: false };
  } catch (error) {
    // PR1 tech-lead review: an unexpected throw (e.g. getModelLocation()
    // missing a regions.yaml entry) must become a failed unit, never crash
    // the whole tick. Logged by class only — never the raw message (hard
    // rule-friendly logging, same discipline as the label client).
    console.error("[pipeline-tick] unit failed unexpectedly", {
      device_id,
      unit_id: unit.unit_id,
      error_class: classifyUnexpectedError(error),
    });
    const q = buildFailedUnitQuestion(unit);
    const ledger: LedgerWrite = {
      outlet_id,
      device_id,
      unit_key: unit.unit_id,
      line_ids: unit.lines.map((l) => l.line_id),
      status: "failed",
      // Tech-lead review round 2, finding 3: the REAL attempt count reached
      // before this unexpected throw, never a hard-coded 1 (e.g. a throw
      // during sanitize/buildThreads after a successful label call still
      // reflects however many label-call attempts that took).
      attempts,
      labelled_at_ms: null,
    };
    // Tech-lead review round 2, finding 6: if even this FALLBACK write
    // itself throws, it must never escape and take down the rest of the
    // tick (every remaining device would otherwise be skipped, a 500) —
    // log only the error class, leave the unit un-ledgered (retried next
    // tick), and let the device loop continue.
    let persisted = true;
    try {
      await store.writeUnitResult(outlet_id, device_id, {
        threads: [],
        questions: [
          {
            outlet_id,
            device_id,
            question_id: q.question_id,
            thread_id: null,
            kind: q.kind,
            status: q.status,
            category: null,
            window_start_ms: q.window_start_ms,
            window_end_ms: q.window_end_ms,
            created_at_ms: now_ms,
          },
        ],
        ledger,
        blank_line_ids: [],
      });
    } catch (writeError) {
      persisted = false;
      console.error("[pipeline-tick] failed to persist failed-unit fallback", {
        device_id,
        unit_id: unit.unit_id,
        error_class: classifyUnexpectedError(writeError),
      });
    }
    return { threadsWritten: 0, questionsWritten: persisted ? 1 : 0, failed: true };
  }
}

async function processOneDevice(
  device: { outlet_id: string; device_id: string },
  deps: Required<Pick<RunTickDeps, "store" | "now_ms" | "config" | "maxUnitsPerDevice" | "leaseTtlMs" | "recentThreadLookbackMs" | "logSkew">> &
    Pick<RunTickDeps, "labelClientDeps" | "sanitizeDeps">,
): Promise<DeviceTickResult> {
  const { store, now_ms, config, maxUnitsPerDevice, leaseTtlMs, recentThreadLookbackMs, logSkew } = deps;
  const { outlet_id, device_id } = device;

  // Tech-lead review round 2, finding 2: the lease token returned here
  // (this acquisition's own `acquired_at_ms`) is the ONLY thing that may
  // release it — passed to `releaseLease` in the `finally` below, never a
  // bare "release my device's lease" that could delete a later tick's.
  const leaseToken = await store.acquireLease(outlet_id, device_id, now_ms, leaseTtlMs);
  if (leaseToken === null) {
    return {
      outlet_id,
      device_id,
      skipped_reason: "lease_held",
      units_processed: 0,
      threads_written: 0,
      questions_written: 0,
      failed_units: 0,
    };
  }

  try {
    const segments = await store.listSegmentsForDevice(outlet_id, device_id);
    if (segments.length === 0) {
      return {
        outlet_id,
        device_id,
        skipped_reason: "no_segments",
        units_processed: 0,
        threads_written: 0,
        questions_written: 0,
        failed_units: 0,
      };
    }

    const asOf = deriveAsOfMs({ segments, server_now_ms: now_ms });
    if (!asOf) {
      return {
        outlet_id,
        device_id,
        skipped_reason: "no_segments",
        units_processed: 0,
        threads_written: 0,
        questions_written: 0,
        failed_units: 0,
      };
    }

    logSkew({
      device_id,
      skew_newest_ms: asOf.skew_newest_ms,
      skew_min_ms: asOf.skew_min_ms,
      n_segments: segments.length,
    });

    const windows = buildWindows({
      device_id,
      segments: toSegmentsForWindowing(segments),
      as_of_ms: asOf.as_of_ms,
    });
    const units = planLabelUnits(windows, asOf.as_of_ms);

    const labelledLineIds = await store.listLabelledLineIds(outlet_id, device_id);
    const staffNames = await store.listStaffScrubNames(outlet_id);

    // Tech-lead re-review, finding 3: filter BEFORE computing the anchor,
    // not after — `filterUnlabelledLines` is pure/deterministic, so this is
    // the exact same set the loop below would otherwise re-derive one unit
    // at a time, just computed once, up front.
    const survivingUnits = units
      .map((u) => filterUnlabelledLines(u, labelledLineIds))
      .filter((u): u is LabelUnit => u !== null);

    // Tech-lead review round 2, finding 3 (re-review, finding 3 again):
    // anchor the lookback on the OLDEST STILL-UNLABELLED unit's own start
    // time, not every unit `planLabelUnits` returned (most of which are
    // already-labelled in steady state) and not the tick's as_of_ms — on a
    // Monday->Tuesday catch-up (or any tick running long after the units
    // it's about to process actually happened), as_of_ms can sit far later
    // than the units themselves, which would push this window too far
    // forward and miss a still-open thread those units should continue.
    // Falls back to as_of_ms only when nothing survived filtering (nothing
    // left to continue a thread for this tick anyway).
    const oldestUnitStartMs =
      survivingUnits.length > 0 ? Math.min(...survivingUnits.map((u) => earliestLineStartMs(u))) : asOf.as_of_ms;
    const openThreadPool = await store.listRecentThreads(
      outlet_id,
      device_id,
      oldestUnitStartMs - recentThreadLookbackMs,
    );

    let unitsProcessed = 0;
    let threadsWritten = 0;
    let questionsWritten = 0;
    let failedUnits = 0;

    for (const filtered of survivingUnits) {
      if (unitsProcessed >= maxUnitsPerDevice) break;

      const result = await processOneUnit({
        unit: filtered,
        outlet_id,
        device_id,
        config,
        staffNames,
        openThreadPool,
        now_ms,
        store,
        labelClientDeps: deps.labelClientDeps,
        sanitizeDeps: deps.sanitizeDeps,
      });

      unitsProcessed += 1;
      threadsWritten += result.threadsWritten;
      questionsWritten += result.questionsWritten;
      if (result.failed) failedUnits += 1;
    }

    return {
      outlet_id,
      device_id,
      skipped_reason: null,
      units_processed: unitsProcessed,
      threads_written: threadsWritten,
      questions_written: questionsWritten,
      failed_units: failedUnits,
    };
  } finally {
    await store.releaseLease(outlet_id, device_id, leaseToken);
  }
}

/** Runs one tick: every active device, one at a time, oldest-units-first, under a per-device lease. */
export async function runTick(deps: RunTickDeps): Promise<RunTickResult> {
  const config = deps.config ?? loadCategoriesConfig();
  const maxUnitsPerDevice = deps.maxUnitsPerDevice ?? DEFAULT_MAX_UNITS_PER_DEVICE;
  const leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const recentThreadLookbackMs = deps.recentThreadLookbackMs ?? DEFAULT_RECENT_THREAD_LOOKBACK_MS;
  const logSkew = deps.logSkew ?? defaultLogSkew;

  const devices = await deps.store.listActiveDevices();
  const results: DeviceTickResult[] = [];

  for (const device of devices) {
    // Fix (tech-lead re-review, finding 1): a per-device try/catch — a
    // throw anywhere in `processOneDevice` OUTSIDE `processOneUnit`'s own
    // handling (e.g. `acquireLease`'s lock-doc parse, the segment/ledger/
    // staff/thread reads, or the `finally`-block `releaseLease`) must never
    // propagate out of `runTick` and abort every remaining device. Logged
    // by class only, same discipline as `classifyUnexpectedError`'s other
    // callers.
    try {
      const result = await processOneDevice(device, {
        store: deps.store,
        now_ms: deps.now_ms,
        config,
        maxUnitsPerDevice,
        leaseTtlMs,
        recentThreadLookbackMs,
        logSkew,
        labelClientDeps: deps.labelClientDeps,
        sanitizeDeps: deps.sanitizeDeps,
      });
      results.push(result);
    } catch (error) {
      console.error("[pipeline-tick] device failed unexpectedly", {
        device_id: device.device_id,
        error_class: classifyUnexpectedError(error),
      });
      results.push({
        outlet_id: device.outlet_id,
        device_id: device.device_id,
        skipped_reason: "error",
        units_processed: 0,
        threads_written: 0,
        questions_written: 0,
        failed_units: 0,
      });
    }
  }

  return { devices: results };
}
