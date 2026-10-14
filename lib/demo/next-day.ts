import { addDays, businessDateOf } from "@/lib/capture/calendar";
import { COLLECTIONS, type CollectionName } from "@/lib/firestore/collections";
import type { LastEnded, Outlet } from "@/lib/firestore/schema";
import { CLONE_DATE_KEYS, CLONE_UNTOUCHED_KEYS, shiftDeep } from "@/lib/demo/clone";
import { NEXT_DAY_MAX, PREPARING_MAX_MS, TEMPLATE_DOC_MAX } from "@/lib/demo/constants";
import { demoDayOf, demoDaysDone, type DemoDay } from "@/lib/capture/contract";
import { DemoNextDayResponseSchema, type DemoNextDayBody, type DemoNextDayResponse, type DemoNextDayStatus, type NextDayRefusal } from "@/lib/demo/contract";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";

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
 */

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
  /** G6: `proposal_locks/{outlet}` exists with `expires_at_ms > now`. */
  proposal_lock_live: boolean;
}

/** Section 6.2: "Preparing your questions" while unlabelled lines remain, for at most PREPARING_MAX_MS after the end. */
export function isPreparing(input: { pending: number; ended_at_ms: number; now_ms: number }): boolean {
  return input.pending > 0 && input.now_ms < input.ended_at_ms + PREPARING_MAX_MS;
}

const refused = (reason: NextDayRefusal): DemoNextDayStatus => ({ allowed: false, reason });

/** G3-G6 in order, no writes. Also what the capture config reports as `demo_session.next_day`. */
export function nextDayEligibility(input: NextDayGuardInput): DemoNextDayStatus {
  if (input.session_open) return refused("session_open"); // G3
  const last = input.last_ended; // G4
  if (!last || last.end_reason === "discarded" || last.business_date !== businessDateOf(input.now_ms, input.tz)) {
    return refused("day_not_ended");
  }
  if (isPreparing({ pending: input.pending_unlabelled_lines, ended_at_ms: last.ended_at_ms, now_ms: input.now_ms })) {
    return refused("preparing");
  }
  if (input.next_day_count >= NEXT_DAY_MAX) return refused("max_days"); // G5
  if (input.proposal_with_content) return refused("proposal_exists"); // G6
  if (input.proposal_lock_live) return refused("busy");
  return { allowed: true, reason: null };
}

export interface NextDayRequestInput extends NextDayGuardInput {
  expected_day: 1 | 2;
  confirm_unanswered: boolean;
  /** The device's `open` questions (count only). */
  open_questions: number;
}

export type NextDayDecision =
  /** The phone is behind the server (a double tap after a finished shift): answer with the current day. */
  | { kind: "stale"; day: 2 | 3 }
  /** The phone is ahead of the server: a client bug, never a shift. */
  | { kind: "ahead"; day: DemoDay }
  | { kind: "refuse"; reason: NextDayRefusal; unanswered?: number }
  | { kind: "proceed" };

/**
 * The full decision the route takes before G7 writes anything. Two checks run BEFORE G3-G6:
 * - `max_days` (G5's first half): on day 3 no `expected_day` the contract allows (1 | 2) can match, so without
 *   this a day-3 tap would read as "stale" and answer 200 instead of the plan's 409 `max_days`;
 * - the stale check: after a finished shift `last_ended` sits on yesterday, so G4 would otherwise refuse the
 *   second tap of a double tap with `day_not_ended` instead of the idempotent 200 the plan asks for.
 */
export function nextDayDecision(input: NextDayRequestInput): NextDayDecision {
  if (input.next_day_count >= NEXT_DAY_MAX) return { kind: "refuse", reason: "max_days" };
  const day = demoDayOf(input.next_day_count);
  if (input.expected_day < day) return { kind: "stale", day: day as 2 | 3 };
  if (input.expected_day > day) return { kind: "ahead", day };
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
export const NEXT_DAY_DATE_KEYS: ReadonlySet<string> = new Set([...CLONE_DATE_KEYS, "debrief_business_date", "from_date", "to_date"]);
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

/** A marker older than this belongs to a crashed shift (G7): later calls get `shift_incomplete`; newer ones `busy`. */
export const SHIFT_MARKER_STALE_MS = 120_000;
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

export interface NextDayGuardState {
  session_open: boolean;
  last_ended: LastEnded | null;
  pending_unlabelled_lines: number;
  proposal_with_content: boolean;
  proposal_lock_live: boolean;
  open_questions: number;
}

/** The store seam; Firestore implementation `firestoreNextDayStore` in lib/firestore/demo-store.ts. Every method is scoped to one outlet. */
export interface NextDayStore {
  /** Plain outlet read (null when missing or malformed). */
  getOutlet(outletId: string): Promise<Outlet | null>;
  /** Read-only inputs of G3-G6 and the unanswered check, for this outlet and device only. */
  readGuardState(outletId: string, deviceId: string, nowMs: number): Promise<NextDayGuardState>;
  /** G7 transaction: sets `sandbox.shift_started_at_ms = nowMs` only if it is null/absent; else reports the existing marker. */
  takeShiftMarker(outletId: string, nowMs: number): Promise<{ taken: true } | { taken: false; started_at_ms: number }>;
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
  /** Transaction: `next_day_count + 1`, `shift_started_at_ms = null`. */
  completeShift(outletId: string): Promise<void>;
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
  shift_incomplete: "The demo could not move to the next day",
  busy: "The demo is busy, try again shortly",
};

const refuse = (reason: NextDayRefusal, details?: { unanswered: number }) => new ConflictError(REFUSAL_MESSAGES[reason], reason, details);
const defaultLog = (event: string, fields: Record<string, unknown>) => console.info(`[demo] ${event}`, fields);

/**
 * `POST /api/v1/demo/next-day`. Order: G1 (404 before any other read) -> guard reads -> decision (stale 200,
 * ahead 422, refusals 409, unanswered 409) -> G7 marker -> G7 lease -> bounded read -> shift -> write ->
 * expire the ended day's open questions at the shifted debrief end -> count + 1 and marker null -> lease
 * released in `finally`. A failure before the first write clears the marker; a crash after it leaves the
 * marker set (later calls: `shift_incomplete`; the recovery is the owner reset).
 */
export async function runNextDay(store: NextDayStore, input: NextDayInput): Promise<DemoNextDayResponse> {
  const log = input.log ?? defaultLog;
  if (!input.demoMode) throw new NotFoundError("route", "route");
  const outlet = await store.getOutlet(input.outlet_id);
  if (!outlet || outlet.project_kind !== "demo" || !outlet.sandbox) throw new NotFoundError("route", "route");

  const guard = await store.readGuardState(input.outlet_id, input.device_id, input.now_ms);
  const nextDayCount = outlet.sandbox.next_day_count ?? 0;
  const decision = nextDayDecision({
    ...guard,
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
  const marker = await store.takeShiftMarker(input.outlet_id, input.now_ms);
  if (!marker.taken) throw refuse(input.now_ms - marker.started_at_ms > SHIFT_MARKER_STALE_MS ? "shift_incomplete" : "busy");
  const lease = await store.acquireLease(input.outlet_id, input.device_id, input.now_ms, SHIFT_LEASE_MS);
  if (lease === null) {
    await store.abortShift(input.outlet_id);
    throw refuse("busy");
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
    await store.completeShift(input.outlet_id);
    const day = demoDayOf(nextDayCount + 1);
    log("next_day", { sandbox: input.outlet_id, day, docs: shifted.length, expired });
    return DemoNextDayResponseSchema.parse({ day });
  } catch (error) {
    if (!written) await store.abortShift(input.outlet_id);
    throw error;
  } finally {
    await store.releaseLease(input.outlet_id, input.device_id, lease);
  }
}
