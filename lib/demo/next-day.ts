import { businessDateOf } from "@/lib/capture/calendar";
import type { LastEnded } from "@/lib/firestore/schema";
import { DEMO_DAYS_TOTAL, NEXT_DAY_MAX, PREPARING_MAX_MS } from "@/lib/demo/constants";
import type { DemoNextDayStatus, NextDayRefusal } from "@/lib/demo/contract";

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

export type DemoDay = 1 | 2 | 3;

export type NextDayDecision =
  /** The phone is behind the server (a double tap after a finished shift): answer with the current day. */
  | { kind: "stale"; day: 2 | 3 }
  /** The phone is ahead of the server: a client bug, never a shift. */
  | { kind: "ahead"; day: DemoDay }
  | { kind: "refuse"; reason: NextDayRefusal; unanswered?: number }
  | { kind: "proceed" };

/**
 * The full decision the route takes before G7 writes anything. The stale check runs FIRST: after a finished
 * shift `last_ended` sits on yesterday, so G4 would otherwise refuse the second tap of a double tap with
 * `day_not_ended` instead of the idempotent 200 the plan asks for.
 */
export function nextDayDecision(input: NextDayRequestInput): NextDayDecision {
  const day = demoDayOf(input.next_day_count);
  if (input.expected_day < day) return { kind: "stale", day: day as 2 | 3 };
  if (input.expected_day > day) return { kind: "ahead", day };
  const eligibility = nextDayEligibility(input);
  if (!eligibility.allowed) return { kind: "refuse", reason: eligibility.reason as NextDayRefusal };
  const last = input.last_ended;
  const debriefRunning = last?.debrief_ends_at_ms !== null && last !== null && input.now_ms < last.debrief_ends_at_ms;
  if (input.open_questions > 0 && debriefRunning && input.confirm_unanswered !== true) {
    return { kind: "refuse", reason: "unanswered_questions", unanswered: input.open_questions };
  }
  return { kind: "proceed" };
}

// ── capture config counters (section 4.3) ─────────────────────────────────────────────────────────────────────

export function demoDayOf(nextDayCount: number | undefined): DemoDay {
  return Math.min(DEMO_DAYS_TOTAL, (nextDayCount ?? 0) + 1) as DemoDay;
}

export function demoDaysDone(input: { next_day_count: number | undefined; last_ended: LastEnded | null; today: string }): number {
  const last = input.last_ended;
  const todayDone = last !== null && last.end_reason !== "discarded" && last.business_date === input.today ? 1 : 0;
  return Math.min(DEMO_DAYS_TOTAL, (input.next_day_count ?? 0) + todayDone);
}
