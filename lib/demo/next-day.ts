import { addDays, businessDateOf } from "@/lib/capture/calendar";
import { COLLECTIONS, type CollectionName } from "@/lib/firestore/collections";
import type { LastEnded, Outlet } from "@/lib/firestore/schema";
import { CLONE_DATE_KEYS, CLONE_UNTOUCHED_KEYS, shiftDeep } from "@/lib/demo/clone";
import { AFTER_DAYS_FROM_COUNT, NEXT_DAY_MAX, TEMPLATE_DOC_MAX } from "@/lib/demo/constants";
import { isPreparing } from "@/lib/debrief/preparing";
import { demoDayOf, demoDaysDone, type DemoDay } from "@/lib/capture/contract";
import { DemoNextDayResponseSchema, type DemoNextDayBody, type DemoNextDayResponse, type DemoNextDayStatus, type DemoOpenSession, type NextDayRefusal } from "@/lib/demo/contract";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { enforceDemoCaps } from "@/lib/demo/caps";
import { runCheck } from "@/lib/demo/redact-cap";
import type { DemoStore } from "@/lib/demo/store-types";

/**
 * "Jump to tomorrow" (R-19 PR-2, docs/tasks/R-19-demo-v2.md section 4). Demo project, sandbox outlets only.
 *
 * There is no time travel: the sandbox runs on the real clock, so the jump is a DATA SHIFT. Every time-bearing
 * field of the sandbox moves back exactly one day; the real "today" then becomes a fresh business day and the
 * existing Start rule (`today > last.business_date`) offers Start again.
 *
 * Everything in this file is plain code and pure (no I/O, no clock reads): the 7 guards, the per-collection
 * shift table, and the day counters of the capture config. The orchestration against a store lives in
 * `runNextDay` below (injected `NextDayStore`, Firestore implementation in lib/firestore/demo-store.ts).
 * The shift moves time only: no label, summary, line text, category, confidence, gate decision or fact status
 * changes (hard rule #10); no audio is touched (#2); no name is read (#7).
 *
 * Review-agent plan Part 1 (18 Oct, docs/tasks/review-agent-18oct.md): the journey has two optional "after" days
 * (days 4 and 5, jumps with `next_day_count >= AFTER_DAYS_FROM_COUNT`).
 *  - D2: the shift also moves `sop_versions` (and the date key `review_date`), so the shipped change and its review
 *    date keep their place relative to the shifted sessions. A side effect, demo only: the SOP page shows the
 *    version's dates one day earlier per jump; the approval's audit entry keeps the original date. `reviews`,
 *    `outcomes` and `audit_log` are never shifted (a jump is refused once a review exists, D4).
 *  - D3: the first two jumps keep G6 exactly (`proposal_exists`). An after jump is unlocked by the owner's approval
 *    instead: it needs a shipped change and no proposal still open (`approve_first`), see `proposalGuard`.
 */

/** A marker older than this belongs to a crashed shift (G7): later calls get `shift_incomplete`; newer ones `busy`. */
export const SHIFT_MARKER_STALE_MS = 120_000;

// ── guards G3-G6 (G1 = demo mode + sandbox outlet, G2 = device auth: both happen in the route) ────────────────

export interface NextDayGuardInput {
  now_ms: number;
  /** The outlet's timezone (business dates are computed in it). */
  tz: string;
  /** `outlet.sandbox.next_day_count ?? 0`. */
  next_day_count: number;
  /** G3: the device has a capture session with `ended_at_ms === null`. */
  session_open: boolean;
  /** G4: the device's own `last_ended`. */
  last_ended: LastEnded | null;
  /** G4 (section 6.2): lines with text of today's ended session that no done/failed ledger row covers. */
  pending_unlabelled_lines: number;
  /** G6: any proposal of the outlet with `content !== null`, whatever its status. */
  proposal_with_content: boolean;
  /** D3: `sop_versions` of the outlet with `source === "proposal"` (a change the owner approved and shipped). */
  shipped_change_count: number;
  /** D3: any proposal with `content !== null` whose status is `awaiting_supervisor` or `awaiting_owner`. */
  open_proposal_with_content: boolean;
  /** D4: `reviews` docs of the outlet (0 or 1 is enough for the guard). */
  review_count: number;
  /** G6: `proposal_locks/{outlet}` exists with `expires_at_ms > now`. */
  proposal_lock_live: boolean;
  /** `outlet.sandbox.shift_started_at_ms ?? null`: the G7 marker. Judged before G3-G6 (a half-done shift has moved `last_ended`). */
  shift_started_at_ms: number | null;
}

const refused = (reason: NextDayRefusal): DemoNextDayStatus => ({ allowed: false, reason });

/**
 * D3/D4, pure. The first two jumps (`next_day_count < AFTER_DAYS_FROM_COUNT`) keep G6 byte for byte: any proposal with
 * content refuses. The after jumps need an approved change and no open proposal, and end for good once a review exists.
 */
export function proposalGuard(
  input: Pick<NextDayGuardInput, "next_day_count" | "proposal_with_content" | "shipped_change_count" | "open_proposal_with_content" | "review_count">,
): NextDayRefusal | null {
  if (input.next_day_count < AFTER_DAYS_FROM_COUNT) return input.proposal_with_content ? "proposal_exists" : null;
  if (input.review_count > 0) return "review_exists";
  if (input.shipped_change_count === 0 || input.open_proposal_with_content) return "approve_first";
  return null;
}

/**
 * The G7 marker as a refusal: a fresh marker is a shift in flight (`busy`), one older than SHIFT_MARKER_STALE_MS is a
 * crashed shift (`shift_incomplete`: only the owner reset recovers it). null when no marker is set.
 */
function markerRefusal(shift_started_at_ms: number | null, now_ms: number): NextDayRefusal | null {
  if (shift_started_at_ms === null) return null;
  return now_ms - shift_started_at_ms > SHIFT_MARKER_STALE_MS ? "shift_incomplete" : "busy";
}

/**
 * The marker first, then G3-G6 in order, no writes. Also what the capture config reports as `demo_session.next_day`.
 * The marker comes first because a shift that failed after `writeShift` has already moved `last_ended` to yesterday:
 * G4 would then say `day_not_ended` and hide that the demo is mid-shift (or needs the owner reset).
 */
export function nextDayEligibility(input: NextDayGuardInput): DemoNextDayStatus {
  const marker = markerRefusal(input.shift_started_at_ms, input.now_ms);
  if (marker !== null) return refused(marker);
  if (input.session_open) return refused("session_open"); // G3
  const last = input.last_ended; // G4
  if (!last || last.end_reason === "discarded" || last.business_date !== businessDateOf(input.now_ms, input.tz)) {
    return refused("day_not_ended");
  }
  if (isPreparing({ pending: input.pending_unlabelled_lines, ended_at_ms: last.ended_at_ms, now_ms: input.now_ms })) {
    return refused("preparing");
  }
  if (input.next_day_count >= NEXT_DAY_MAX) return refused("max_days"); // G5
  const pg = proposalGuard(input); // G6 (jumps 1-2); approve_first / review_exists (after jumps)
  if (pg !== null) return refused(pg);
  if (input.proposal_lock_live) return refused("busy");
  return { allowed: true, reason: null };
}

export interface NextDayRequestInput extends NextDayGuardInput {
  expected_day: 1 | 2 | 3 | 4;
  confirm_unanswered: boolean;
  /** The device's `open` questions (count only). */
  open_questions: number;
}

export type NextDayDecision =
  /** The phone is behind the server (a double tap after a finished shift): answer with the current day. */
  | { kind: "stale"; day: 2 | 3 | 4 | 5 }
  /** The phone is ahead of the server: a client bug, never a shift. */
  | { kind: "ahead"; day: DemoDay }
  | { kind: "refuse"; reason: NextDayRefusal; unanswered?: number }
  | { kind: "proceed" };

/**
 * The full decision the route takes before G7 writes anything. The stale and ahead checks run BEFORE G3-G6:
 * after a finished shift `last_ended` sits on yesterday, so G4 would otherwise refuse the second tap of a
 * double tap with `day_not_ended` instead of the idempotent 200 the plan asks for. Stale also comes BEFORE
 * `max_days`: on day 5 every `expected_day` the contract allows (1 to 4) is stale, so a lost 200 on the last
 * jump, retried with `expected_day` 4, gets `{day:5}` and the phone shows day 5 instead of "all done".
 * `max_days` is only a defence for a count/expected_day pair the contract cannot produce.
 */
export function nextDayDecision(input: NextDayRequestInput): NextDayDecision {
  const day = demoDayOf(input.next_day_count);
  if (input.expected_day < day) return { kind: "stale", day: day as 2 | 3 | 4 | 5 };
  if (input.expected_day > day) return { kind: "ahead", day };
  // PR-5 note: `max_days` is UNREACHABLE through the route's `expected_day: 1 | 2 | 3 | 4` body contract: on day 5 every
  // allowed value is stale (answered above with 200 {day:5}). This line is a defence for a pair the contract cannot
  // produce. The phone must therefore read `demo_session.next_day.reason === "max_days"` from the capture config and
  // never call the route in that state.
  if (input.next_day_count >= NEXT_DAY_MAX) return { kind: "refuse", reason: "max_days" };
  const eligibility = nextDayEligibility(input);
  if (!eligibility.allowed) return { kind: "refuse", reason: eligibility.reason as NextDayRefusal };
  const last = input.last_ended;
  const debriefRunning = last !== null && last.debrief_ends_at_ms !== null && input.now_ms < last.debrief_ends_at_ms;
  if (input.open_questions > 0 && debriefRunning && input.confirm_unanswered !== true) {
    return { kind: "refuse", reason: "unanswered_questions", unanswered: input.open_questions };
  }
  return { kind: "proceed" };
}

// ── capture config counters (section 4.3): defined in lib/capture/contract.ts (browser-safe), re-exported here ──
export { demoDayOf, demoDaysDone, type DemoDay };

// ── the shift (section 4.2): time only, one day back ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export const NEXT_DAY_DELTA_MS = -DAY_MS;
export const NEXT_DAY_DAYS = -1;

/** The clone's date keys plus the three `YYYY-MM-DD` fields the clone never meets. */
export const NEXT_DAY_DATE_KEYS: ReadonlySet<string> = new Set([...CLONE_DATE_KEYS, "debrief_business_date", "from_date", "to_date", "review_date"]);
/**
 * The clone's untouched keys plus every TTL and record-of-real-time field: `expires_at` (a native Timestamp on
 * segments and corrections; the TTL must not move), `expires_at_ms`, the whole `sandbox` object, `ts`,
 * `pairing_code_expires_at`, `paired_at`, `created_at`.
 */
export const NEXT_DAY_UNTOUCHED: ReadonlySet<string> = new Set([
  ...CLONE_UNTOUCHED_KEYS,
  "expires_at",
  "expires_at_ms",
  "sandbox",
  "ts",
  "pairing_code_expires_at",
  "paired_at",
  "created_at",
]);

/** The collections whose sandbox docs are moved whole (`set`, same ids). `devices` moves only `last_ended` (shiftLastEnded). */
export const NEXT_DAY_SHIFT_COLLECTIONS: readonly CollectionName[] = [
  COLLECTIONS.captureSessions,
  COLLECTIONS.segments,
  COLLECTIONS.threads,
  COLLECTIONS.questions,
  COLLECTIONS.corrections,
  COLLECTIONS.labelUnits,
  COLLECTIONS.proposals,
  COLLECTIONS.sopVersions,
];

const isoOf = (ms: number) => new Date(ms).toISOString();
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const shiftIso = (v: unknown): unknown => (typeof v === "string" && ISO_DATETIME.test(v) ? isoOf(Date.parse(v) + NEXT_DAY_DELTA_MS) : v);

/**
 * One sandbox doc, moved one day back. Never mutates the input; untouched subtrees keep their reference (so a
 * Firestore Timestamp under `expires_at` is written back as the same Timestamp).
 */
export function shiftDocForNextDay<T extends Record<string, unknown>>(collection: CollectionName, data: T): T {
  if (!NEXT_DAY_SHIFT_COLLECTIONS.includes(collection)) {
    throw new Error(`shiftDocForNextDay: collection "${collection}" is not in the next-day table`);
  }
  const out = shiftDeep(data, NEXT_DAY_DELTA_MS, NEXT_DAY_DAYS, "", { dateKeys: NEXT_DAY_DATE_KEYS, untouchedKeys: NEXT_DAY_UNTOUCHED });
  if (collection === COLLECTIONS.segments) {
    // ISO device times without the `_at` suffix: named explicitly in the table.
    return { ...out, device_start: shiftIso(out.device_start), device_end: shiftIso(out.device_end) };
  }
  return out;
}

/** `devices`: only the device's own `last_ended` moves. */
export function shiftLastEnded(last: LastEnded): LastEnded {
  return {
    business_date: addDays(last.business_date, NEXT_DAY_DAYS),
    end_reason: last.end_reason,
    ended_at_ms: last.ended_at_ms + NEXT_DAY_DELTA_MS,
    debrief_ends_at_ms: last.debrief_ends_at_ms === null ? null : last.debrief_ends_at_ms + NEXT_DAY_DELTA_MS,
  };
}

// ── orchestration: G1, G7 and the write order (section 4.2), over an injected store ───────────────────────────

/** The device's pipeline lease held for the shift (the tick skips the device meanwhile). */
export const SHIFT_LEASE_MS = 120_000;
/** The read is bounded: more docs than this in one collection of a sandbox is refused (503 `template_too_large`). */
export const SHIFT_DOC_MAX = TEMPLATE_DOC_MAX * 3;

export interface ShiftDoc {
  collection: CollectionName;
  id: string;
  /** The raw stored doc (a Firestore Timestamp under `expires_at` passes through untouched). */
  data: Record<string, unknown>;
}

export type JumpBlockers = Pick<NextDayGuardInput, "proposal_with_content" | "shipped_change_count" | "open_proposal_with_content" | "review_count">;

export interface NextDayGuardState {
  session_open: boolean;
  last_ended: LastEnded | null;
  pending_unlabelled_lines: number;
  proposal_with_content: boolean;
  shipped_change_count: number;
  open_proposal_with_content: boolean;
  review_count: number;
  proposal_lock_live: boolean;
  open_questions: number;
  /**
   * R-19 PR-4b (plan 5.7a): this device's newest still-open session (null when none), from the SAME sessions
   * read as `session_open`. The capture config projects it as `demo_session.open_session`; the guards ignore it.
   */
  open_session: DemoOpenSession | null;
}

/** The store seam; Firestore implementation `firestoreNextDayStore` in lib/firestore/demo-store.ts. Every method is scoped to one outlet. */
export interface NextDayStore {
  /** Plain outlet read (null when missing or malformed). */
  getOutlet(outletId: string): Promise<Outlet | null>;
  /** The demo counters (`demo_counters`), same contract as `DemoStore`: the per-sandbox call cap of this route. */
  bumpCounter: DemoStore["bumpCounter"];
  readCounter: DemoStore["readCounter"];
  /** Read-only inputs of G3-G6 and the unanswered check, for this outlet and device only. */
  readGuardState(outletId: string, deviceId: string, nowMs: number): Promise<NextDayGuardState>;
  /**
   * The four facts of `proposalGuard` (G6 and the after-day rules), for this outlet only. Re-read after the marker is
   * taken; `readGuardState` carries the same facts for the first decision.
   */
  readJumpBlockers(outletId: string): Promise<JumpBlockers>;
  /**
   * G7 transaction: sets `sandbox.shift_started_at_ms = nowMs` only if `next_day_count` is still `expectedCount` (the
   * count the caller's decision was made under) AND the marker is null/absent. A moved count means another request
   * finished the shift meanwhile: nothing is written and the new count is reported (`moved_to_count`). Otherwise the
   * existing marker is reported (`started_at_ms`).
   */
  takeShiftMarker(
    outletId: string,
    nowMs: number,
    expectedCount: number,
  ): Promise<{ taken: true } | { taken: false; started_at_ms: number } | { taken: false; moved_to_count: number }>;
  /** Clears OUR marker after a failure before the first write (count unchanged). */
  abortShift(outletId: string): Promise<void>;
  /** The device's pipeline lease (tick store); null when held. */
  acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<number | null>;
  releaseLease(outletId: string, deviceId: string, token: number): Promise<void>;
  /** Every doc of NEXT_DAY_SHIFT_COLLECTIONS with `outlet_id == outletId`, at most `limitPerCollection` each. */
  readShiftDocs(outletId: string, limitPerCollection: number): Promise<ShiftDoc[]>;
  /** `set` of every shifted doc (same ids) in batches, then the device's `last_ended` update. */
  writeShift(outletId: string, write: { docs: ShiftDoc[]; last_ended: { device_id: string; last_ended: LastEnded } | null }): Promise<void>;
  /** The tick store's `expireOpenQuestions` (gate questions' threads go unverified too). */
  expireOpenQuestions(outletId: string, deviceId: string, debriefEndsAtMs: number, nowMs: number): Promise<number>;
  /**
   * Transaction: `next_day_count + 1`, `shift_started_at_ms = null`, only when `next_day_count` is still `expectedCount`
   * (the value our marker was taken under). Throws without writing when the count moved (cannot happen while we hold the marker).
   */
  completeShift(outletId: string, expectedCount: number): Promise<void>;
}

export interface NextDayInput {
  /** From the device claims only. */
  outlet_id: string;
  device_id: string;
  now_ms: number;
  /** The route's `DEMO_MODE === "true"`. */
  demoMode: boolean;
  body: DemoNextDayBody;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

const REFUSAL_MESSAGES: Record<NextDayRefusal, string> = {
  session_open: "End today's session first",
  day_not_ended: "Run today first",
  preparing: "Today's questions are still being prepared",
  unanswered_questions: "Open questions need an answer or a confirmation",
  max_days: "All demo days are done",
  proposal_exists: "A proposal already exists for these days",
  approve_first: "Approve a proposal first",
  review_exists: "A review already exists",
  shift_incomplete: "The demo could not move to the next day",
  busy: "The demo is busy, try again shortly",
};

const refuse = (reason: NextDayRefusal, details?: { unanswered: number }) => new ConflictError(REFUSAL_MESSAGES[reason], reason, details);
const defaultLog = (event: string, fields: Record<string, unknown>) => console.info(`[demo] ${event}`, fields);

/**
 * `POST /api/v1/demo/next-day`. Order: G1 (404 before any other read) -> per-sandbox call cap (429, counts every
 * call that reached a sandbox, stale ones too) -> cheap stale short-circuit (outlet doc only) -> guard reads ->
 * decision (stale 200, ahead 422, refusals 409, unanswered 409) -> G7 marker -> G7 lease -> bounded read -> shift -> write ->
 * expire the ended day's open questions at the shifted debrief end -> count + 1 and marker null -> lease
 * released in `finally`. A failure before the first write clears the marker; a crash after it leaves the
 * marker set (later calls: `shift_incomplete`; the recovery is the owner reset).
 */
export async function runNextDay(store: NextDayStore, input: NextDayInput): Promise<DemoNextDayResponse> {
  const log = input.log ?? defaultLog;
  if (!input.demoMode) throw new NotFoundError("route", "route");
  const outlet = await store.getOutlet(input.outlet_id);
  if (!outlet || outlet.project_kind !== "demo" || !outlet.sandbox) throw new NotFoundError("route", "route");

  // The call cap comes before the guard reads: a client looping with a stale expected_day costs one counter
  // transaction per call, never the guard queries. Fail closed (503 demo_cap_unavailable) like every other cap.
  await runCheck(() => enforceDemoCaps(store, { outlet, now_ms: input.now_ms, key: "next_day" }));

  // Cheap stale short-circuit: the phone is behind the server (a double tap after a finished shift). The
  // outlet doc already holds the answer, so skip the guard reads (the same rule `nextDayDecision` applies).
  const nextDayCount = outlet.sandbox.next_day_count ?? 0;
  const currentDay = demoDayOf(nextDayCount);
  if (input.body.expected_day < currentDay) return DemoNextDayResponseSchema.parse({ day: currentDay });

  const guard = await store.readGuardState(input.outlet_id, input.device_id, input.now_ms);
  const decision = nextDayDecision({
    ...guard,
    shift_started_at_ms: outlet.sandbox.shift_started_at_ms ?? null,
    now_ms: input.now_ms,
    tz: outlet.timezone,
    next_day_count: nextDayCount,
    expected_day: input.body.expected_day,
    confirm_unanswered: input.body.confirm_unanswered,
  });
  if (decision.kind === "stale") return DemoNextDayResponseSchema.parse({ day: decision.day });
  if (decision.kind === "ahead") {
    throw new ValidationError("invalid_body", [{ field: "expected_day", message: `the sandbox is on day ${decision.day}` }]);
  }
  if (decision.kind === "refuse") {
    throw refuse(decision.reason, decision.unanswered === undefined ? undefined : { unanswered: decision.unanswered });
  }

  // G7: single flight. The marker first (a crashed shift must never be repeated on top of half-moved data).
  // The marker transaction also checks the count the decision above was made under: a request that stalled between
  // its guard read and here, while another finished the whole shift, gets the stale 200 and never shifts twice.
  const marker = await store.takeShiftMarker(input.outlet_id, input.now_ms, nextDayCount);
  if (!marker.taken) {
    if ("moved_to_count" in marker) return DemoNextDayResponseSchema.parse({ day: demoDayOf(marker.moved_to_count) });
    throw refuse(markerRefusal(marker.started_at_ms, input.now_ms) ?? "busy");
  }

  // With our marker held: the proposal guard once more (a proposal, an approval or a review can appear between the guard
  // read and the marker), then the lease.
  // Any throw here, or a refusal, clears OUR marker first (count unchanged).
  let lease: number | null = null;
  let blocked: NextDayRefusal | null = null;
  try {
    blocked = proposalGuard({ ...(await store.readJumpBlockers(input.outlet_id)), next_day_count: nextDayCount });
    if (blocked === null) {
      lease = await store.acquireLease(input.outlet_id, input.device_id, input.now_ms, SHIFT_LEASE_MS);
      if (lease === null) blocked = "busy";
    }
  } catch (error) {
    await abortQuietly(store, input.outlet_id, log);
    throw error;
  }
  if (blocked !== null || lease === null) {
    await store.abortShift(input.outlet_id);
    throw refuse(blocked ?? "busy");
  }

  let written = false;
  try {
    const docs = await store.readShiftDocs(input.outlet_id, SHIFT_DOC_MAX + 1);
    const perCollection = new Map<CollectionName, number>();
    for (const d of docs) perCollection.set(d.collection, (perCollection.get(d.collection) ?? 0) + 1);
    if ([...perCollection.values()].some((n) => n > SHIFT_DOC_MAX)) {
      throw new AppError("The demo is not ready", "template_too_large", 503);
    }
    const shifted = docs.map((d) => ({ ...d, data: shiftDocForNextDay(d.collection, d.data) }));
    const last = guard.last_ended ? shiftLastEnded(guard.last_ended) : null;

    written = true;
    await store.writeShift(input.outlet_id, { docs: shifted, last_ended: last ? { device_id: input.device_id, last_ended: last } : null });
    let expired = 0;
    if (last && last.debrief_ends_at_ms !== null) {
      expired = await store.expireOpenQuestions(input.outlet_id, input.device_id, last.debrief_ends_at_ms, input.now_ms);
    }
    await store.completeShift(input.outlet_id, nextDayCount);
    const day = demoDayOf(nextDayCount + 1);
    log("next_day", { sandbox: input.outlet_id, day, docs: shifted.length, expired });
    return DemoNextDayResponseSchema.parse({ day });
  } catch (error) {
    if (!written) await store.abortShift(input.outlet_id);
    throw error;
  } finally {
    // Never rethrow from here: the lease is a TTL lock and must not mask the shift's result or its own error.
    try {
      await store.releaseLease(input.outlet_id, input.device_id, lease);
    } catch (error) {
      log("next_day_release_failed", { error_class: errorClass(error) });
    }
  }
}

const errorClass = (error: unknown): string => (error instanceof Error ? error.constructor.name : typeof error);

/** Clears our marker while another error is already on its way out: a failing clear is logged, never masks the original. */
async function abortQuietly(store: NextDayStore, outletId: string, log: (event: string, fields: Record<string, unknown>) => void): Promise<void> {
  try {
    await store.abortShift(outletId);
  } catch (error) {
    log("next_day_abort_failed", { error_class: errorClass(error) });
  }
}
