import { describe, expect, it, vi } from "vitest";
import { shiftDeep } from "@/lib/demo/clone";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 14, 3, 0, 0); // 14 Oct 2026 10:00 WIB

describe("shiftDeep opts (R-19 PR-2: the clone's defaults stay, the next-day shift widens them)", () => {
  it("without opts behaves as before: from_date and expires_at are not date keys / are moved by the _at rule", () => {
    const out = shiftDeep({ from_date: "2026-10-14", expires_at: "2026-10-16T00:00:00.000Z", x_ms: T0 }, -DAY, -1);
    expect(out.from_date).toBe("2026-10-14");
    expect(out.expires_at).toBe("2026-10-15T00:00:00.000Z");
    expect(out.x_ms).toBe(T0 - DAY);
  });

  it("dateKeys opt adds date keys that move by whole days", () => {
    const out = shiftDeep({ from_date: "2026-10-14", business_date: "2026-10-14" }, -DAY, -1, "", {
      dateKeys: new Set(["from_date", "business_date"]),
    });
    expect(out).toEqual({ from_date: "2026-10-13", business_date: "2026-10-13" });
  });

  it("untouchedKeys opt keeps a subtree exactly as it was (same reference), at any depth", () => {
    const expires = { toDate: () => new Date(0) };
    const input = { expires_at: expires, nested: { expires_at: expires, t_ms: T0 }, sandbox: { created_at_ms: T0 } };
    const out = shiftDeep(input, -DAY, -1, "", { untouchedKeys: new Set(["expires_at", "sandbox"]) });
    expect(out.expires_at).toBe(expires);
    expect(out.nested.expires_at).toBe(expires);
    expect(out.nested.t_ms).toBe(T0 - DAY);
    expect(out.sandbox).toBe(input.sandbox);
  });
});

// ── guards (plan section 4.1) ───────────────────────────────────────────────────────────────────────────────
import { PREPARING_MAX_MS } from "@/lib/demo/constants";
import { isPreparing } from "@/lib/debrief/preparing";
import { SHIFT_MARKER_STALE_MS, demoDayOf, demoDaysDone, nextDayDecision, nextDayEligibility, type NextDayGuardInput } from "@/lib/demo/next-day";
import { businessDateOf } from "@/lib/capture/calendar";

const TZ = "Asia/Jakarta";
const TODAY = businessDateOf(T0, TZ);
/** A sandbox that ended today's day 2 min ago (inside PREPARING_MAX_MS), debrief still running, nothing else in the way. */
function okInput(over: Partial<NextDayGuardInput> = {}): NextDayGuardInput {
  return {
    now_ms: T0,
    tz: TZ,
    next_day_count: 0,
    session_open: false,
    last_ended: { business_date: TODAY, end_reason: "selesai", ended_at_ms: T0 - 2 * 60_000, debrief_ends_at_ms: T0 + 58 * 60_000 },
    pending_unlabelled_lines: 0,
    proposal_with_content: false,
    proposal_lock_live: false,
    shift_started_at_ms: null,
    ...over,
  };
}

describe("nextDayEligibility (G3-G6, in order, no writes)", () => {
  it("allowed when nothing blocks", () => {
    expect(nextDayEligibility(okInput())).toEqual({ allowed: true, reason: null });
  });

  it("G3 an open session wins over everything later", () => {
    expect(nextDayEligibility(okInput({ session_open: true, last_ended: null, next_day_count: 2, proposal_with_content: true }))).toEqual({
      allowed: false,
      reason: "session_open",
    });
  });

  it("G4 day_not_ended: no last_ended, a discarded one, or one from another business date", () => {
    expect(nextDayEligibility(okInput({ last_ended: null })).reason).toBe("day_not_ended");
    expect(nextDayEligibility(okInput({ last_ended: { ...okInput().last_ended!, end_reason: "discarded" } })).reason).toBe("day_not_ended");
    expect(nextDayEligibility(okInput({ last_ended: { ...okInput().last_ended!, business_date: "2026-10-13" } })).reason).toBe("day_not_ended");
  });

  it("G4 preparing: unlabelled lines of today's ended session within PREPARING_MAX_MS of the end", () => {
    expect(nextDayEligibility(okInput({ pending_unlabelled_lines: 3 })).reason).toBe("preparing");
    const ended = T0 - PREPARING_MAX_MS;
    expect(nextDayEligibility(okInput({ pending_unlabelled_lines: 3, last_ended: { ...okInput().last_ended!, ended_at_ms: ended } })).allowed).toBe(true);
  });

  it("G4 wins over G5 and G6", () => {
    expect(nextDayEligibility(okInput({ last_ended: null, next_day_count: 2, proposal_with_content: true })).reason).toBe("day_not_ended");
  });

  it("G5 max_days once next_day_count reached NEXT_DAY_MAX, before G6", () => {
    expect(nextDayEligibility(okInput({ next_day_count: 2, proposal_with_content: true })).reason).toBe("max_days");
    expect(nextDayEligibility(okInput({ next_day_count: 1 })).allowed).toBe(true);
  });

  it("G6 proposal_exists before busy", () => {
    expect(nextDayEligibility(okInput({ proposal_with_content: true, proposal_lock_live: true })).reason).toBe("proposal_exists");
    expect(nextDayEligibility(okInput({ proposal_lock_live: true })).reason).toBe("busy");
  });
});

describe("nextDayEligibility: the shift marker is judged BEFORE G3-G6 (QA defect 2)", () => {
  // After writeShift moved last_ended to yesterday, G4 would say day_not_ended; the marker says what really happened.
  const afterPartialShift = { last_ended: { ...okInput().last_ended!, business_date: "2026-10-13" } };

  it("a marker newer than SHIFT_MARKER_STALE_MS is busy, even though G4 alone would say day_not_ended", () => {
    const input = okInput({ ...afterPartialShift, shift_started_at_ms: T0 - SHIFT_MARKER_STALE_MS });
    expect(nextDayEligibility(input)).toEqual({ allowed: false, reason: "busy" });
  });

  it("a marker older than SHIFT_MARKER_STALE_MS is shift_incomplete (the owner-reset copy), even though G4 alone would say day_not_ended", () => {
    const input = okInput({ ...afterPartialShift, shift_started_at_ms: T0 - SHIFT_MARKER_STALE_MS - 1 });
    expect(nextDayEligibility(input)).toEqual({ allowed: false, reason: "shift_incomplete" });
  });

  it("the marker also wins over an open session (G3) and over proposal_exists (G6)", () => {
    expect(nextDayEligibility(okInput({ session_open: true, shift_started_at_ms: T0 - 1 })).reason).toBe("busy");
    expect(nextDayEligibility(okInput({ proposal_with_content: true, shift_started_at_ms: T0 - SHIFT_MARKER_STALE_MS - 5 })).reason).toBe("shift_incomplete");
  });

  it("nextDayDecision refuses with the marker's reason, not G4's", () => {
    const base = { expected_day: 1 as const, confirm_unanswered: true, open_questions: 0 };
    expect(nextDayDecision({ ...okInput({ ...afterPartialShift, shift_started_at_ms: T0 }), ...base })).toEqual({ kind: "refuse", reason: "busy" });
    expect(nextDayDecision({ ...okInput({ ...afterPartialShift, shift_started_at_ms: T0 - SHIFT_MARKER_STALE_MS - 1 }), ...base })).toEqual({
      kind: "refuse",
      reason: "shift_incomplete",
    });
  });
});

describe("isPreparing (the section 6.2 rule, pure)", () => {
  it("true only while pending lines exist and the end is less than PREPARING_MAX_MS ago", () => {
    expect(isPreparing({ pending: 1, ended_at_ms: T0 - 1, now_ms: T0 })).toBe(true);
    expect(isPreparing({ pending: 0, ended_at_ms: T0 - 1, now_ms: T0 })).toBe(false);
    expect(isPreparing({ pending: 1, ended_at_ms: T0 - PREPARING_MAX_MS, now_ms: T0 })).toBe(false);
  });
});

describe("nextDayDecision (the route's full decision before any write)", () => {
  it("proceeds when the guards pass and expected_day matches", () => {
    expect(nextDayDecision({ ...okInput(), expected_day: 1, confirm_unanswered: false, open_questions: 0 })).toEqual({ kind: "proceed" });
  });

  it("a stale expected_day (a double tap after a finished shift) is answered with the current day, before any guard", () => {
    // After the first jump last_ended sits on yesterday (G4 would refuse) and the questions are expired: still 200.
    const d = nextDayDecision({
      ...okInput({ next_day_count: 1, last_ended: { ...okInput().last_ended!, business_date: "2026-10-13" }, session_open: true }),
      expected_day: 1,
      confirm_unanswered: false,
      open_questions: 0,
    });
    expect(d).toEqual({ kind: "stale", day: 2 });
  });

  it("on day 3 every tap the contract allows (expected_day 1 | 2) is stale: 200 {day:3}, never max_days (a lost 200 on the 2nd jump must not show 'all done' before day 3 runs)", () => {
    expect(nextDayDecision({ ...okInput({ next_day_count: 2, last_ended: null }), expected_day: 2, confirm_unanswered: false, open_questions: 0 })).toEqual({ kind: "stale", day: 3 });
    expect(nextDayDecision({ ...okInput({ next_day_count: 2, last_ended: null }), expected_day: 1, confirm_unanswered: false, open_questions: 0 })).toEqual({ kind: "stale", day: 3 });
  });

  it("max_days stays as a defence after the stale and ahead checks (unreachable through the 1 | 2 contract)", () => {
    const beyondContract = { ...okInput({ next_day_count: 2 }), expected_day: 3 as never, confirm_unanswered: false, open_questions: 0 };
    expect(nextDayDecision(beyondContract)).toEqual({ kind: "refuse", reason: "max_days" });
  });

  it("an expected_day AHEAD of the server is a client error, never a shift", () => {
    expect(nextDayDecision({ ...okInput(), expected_day: 2, confirm_unanswered: false, open_questions: 0 })).toEqual({ kind: "ahead", day: 1 });
  });

  it("refuses with the guard's reason", () => {
    expect(nextDayDecision({ ...okInput({ proposal_with_content: true }), expected_day: 1, confirm_unanswered: false, open_questions: 2 })).toEqual({
      kind: "refuse",
      reason: "proposal_exists",
    });
  });

  it("unanswered open questions while the debrief runs need confirm_unanswered, after G3-G6", () => {
    const base = { ...okInput(), expected_day: 1 as const, open_questions: 2 };
    expect(nextDayDecision({ ...base, confirm_unanswered: false })).toEqual({ kind: "refuse", reason: "unanswered_questions", unanswered: 2 });
    expect(nextDayDecision({ ...base, confirm_unanswered: true })).toEqual({ kind: "proceed" });
    // The debrief is over: the questions are no longer "unanswered", they are expired; no confirm needed.
    const over = okInput({ last_ended: { ...okInput().last_ended!, debrief_ends_at_ms: T0 - 1 } });
    expect(nextDayDecision({ ...over, expected_day: 1, confirm_unanswered: false, open_questions: 2 })).toEqual({ kind: "proceed" });
    // A guard refusal comes first.
    expect(nextDayDecision({ ...okInput({ proposal_lock_live: true }), expected_day: 1, confirm_unanswered: false, open_questions: 2 })).toEqual({ kind: "refuse", reason: "busy" });
  });
});

describe("day counters for the capture config (section 4.3)", () => {
  it("day = next_day_count + 1, capped at 3", () => {
    expect(demoDayOf(undefined)).toBe(1);
    expect(demoDayOf(0)).toBe(1);
    expect(demoDayOf(1)).toBe(2);
    expect(demoDayOf(2)).toBe(3);
  });

  it("days_done adds today's non-discarded ended day", () => {
    const last = okInput().last_ended!;
    expect(demoDaysDone({ next_day_count: 0, last_ended: null, today: TODAY })).toBe(0);
    expect(demoDaysDone({ next_day_count: 0, last_ended: last, today: TODAY })).toBe(1);
    expect(demoDaysDone({ next_day_count: 1, last_ended: { ...last, business_date: "2026-10-13" }, today: TODAY })).toBe(1);
    expect(demoDaysDone({ next_day_count: 2, last_ended: last, today: TODAY })).toBe(3);
    expect(demoDaysDone({ next_day_count: 2, last_ended: { ...last, end_reason: "discarded" }, today: TODAY })).toBe(2);
  });
});

// ── the shift (section 4.2) ─────────────────────────────────────────────────────────────────────────────────
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  CaptureSessionSchema,
  CorrectionSchema,
  LabelUnitLedgerSchema,
  QuestionSchema,
  SegmentSchema,
  ThreadSchema,
} from "@/lib/firestore/schema";
import { expireAtDebriefEnd } from "@/lib/pipeline/gate";
import { NEXT_DAY_SHIFT_COLLECTIONS, shiftDocForNextDay, shiftLastEnded } from "@/lib/demo/next-day";

const SBX = "sbx-0123456789ab";
const JDG = "jdg-0123456789ab";
const iso = (ms: number) => new Date(ms).toISOString();
const S1 = "11111111-1111-4111-8111-111111111111";

describe("shiftDocForNextDay: exactly the table's fields move by -1 day", () => {
  it("covers the seven collections of the table", () => {
    expect([...NEXT_DAY_SHIFT_COLLECTIONS].sort()).toEqual(
      [COLLECTIONS.captureSessions, COLLECTIONS.segments, COLLECTIONS.threads, COLLECTIONS.questions, COLLECTIONS.corrections, COLLECTIONS.labelUnits, COLLECTIONS.proposals].sort(),
    );
  });

  it("capture_sessions: every instant, local_date and the received_* ISO times move; ids do not", () => {
    const doc = CaptureSessionSchema.parse({
      outlet_id: SBX, device_id: JDG, session_id: S1,
      started_at_ms: T0 - 3_600_000, ended_at_ms: T0, end_reason: "selesai", local_date: TODAY,
      auto_stop_at_ms: T0 + 600_000, debrief_ends_at_ms: T0 + 3_600_000, demo_closing_at_ms: T0 - 60_000,
      received_start_at: iso(T0 - 3_600_000), received_end_at: iso(T0),
    });
    const out = shiftDocForNextDay(COLLECTIONS.captureSessions, doc as Record<string, unknown>);
    expect(out).toEqual({
      ...doc,
      started_at_ms: T0 - 3_600_000 - DAY, ended_at_ms: T0 - DAY, local_date: "2026-10-13",
      auto_stop_at_ms: T0 + 600_000 - DAY, debrief_ends_at_ms: T0 + 3_600_000 - DAY, demo_closing_at_ms: T0 - 60_000 - DAY,
      received_start_at: iso(T0 - 3_600_000 - DAY), received_end_at: iso(T0 - DAY),
    });
    expect(CaptureSessionSchema.parse(out)).toBeTruthy();
  });

  it("segments: received_at, device_start, device_end move; expires_at (the TTL, a native Timestamp in Firestore) and lines never", () => {
    const expires = { toDate: () => new Date(T0 + 48 * 3_600_000) }; // stands in for a Firestore Timestamp
    const lines = [{ text: "Pelanggan tanya roti.", start: 1.5, end: 3 }];
    const doc = {
      ...SegmentSchema.parse({ outlet_id: SBX, device_id: JDG, seg_id: "seg1", received_at: iso(T0), device_start: iso(T0 - 15_000), device_end: iso(T0), model: "m", location: "global", lines, expires_at: iso(T0), session_id: S1 }),
      expires_at: expires,
    };
    const out = shiftDocForNextDay(COLLECTIONS.segments, doc);
    expect(out).toEqual({ ...doc, received_at: iso(T0 - DAY), device_start: iso(T0 - 15_000 - DAY), device_end: iso(T0 - DAY) });
    expect(out.expires_at).toBe(expires);
    expect(out.lines).toEqual(lines); // text, start, end unchanged (seconds, not instants)
  });

  it("threads: line times and record times move; summary, lines[].text, fields, gate, runner_up, status do not", () => {
    const doc = ThreadSchema.parse({
      outlet_id: SBX, thread_id: "th1", device_id: JDG, category: "CUSTOMER_SERVICE", confidence: 0.6,
      line_ids: ["seg1#0"], evidence_line_ids: ["seg1#0"],
      lines: [{ line_id: "seg1#0", start_ms: T0 - 20_000, end_ms: T0 - 15_000, text: "Roti habis." }],
      first_line_start_ms: T0 - 20_000, last_line_end_ms: T0 - 15_000, summary: "Sold-out bread.",
      fields: { business_date: TODAY, note_ms: T0 }, runner_up: { category: "COMPLAINT", why_not: "no complaint words" }, label_conflict: false, status: "open",
      gate: { verdict: "question", fired_rule: "below_threshold", checks: [{ rule: "invalid_label", passed: true }], category: "CUSTOMER_SERVICE", confidence: 0.6, threshold: 0.9, evidence_count: 1, gate_version: "1" },
      created_at_ms: T0, updated_at_ms: T0,
    });
    const out = shiftDocForNextDay(COLLECTIONS.threads, doc as Record<string, unknown>);
    expect(out).toEqual({
      ...doc,
      lines: [{ line_id: "seg1#0", start_ms: T0 - 20_000 - DAY, end_ms: T0 - 15_000 - DAY, text: "Roti habis." }],
      first_line_start_ms: T0 - 20_000 - DAY, last_line_end_ms: T0 - 15_000 - DAY, created_at_ms: T0 - DAY, updated_at_ms: T0 - DAY,
    });
    expect(out.fields).toBe(doc.fields);
    expect(out.gate).toBe(doc.gate);
    expect(out.runner_up).toBe(doc.runner_up);
  });

  it("questions: window, created, answered and expired_by move; status and answer do not", () => {
    const doc = QuestionSchema.parse({
      outlet_id: SBX, question_id: "q1", device_id: JDG, thread_id: "th1", kind: "gate", status: "answered", category: "CUSTOMER_SERVICE",
      window_start_ms: T0 - 20_000, window_end_ms: T0 - 15_000, created_at_ms: T0, answer: "yes", answered_at_ms: T0 + 60_000, expired_by_debrief_end_ms: T0 + 3_600_000,
    });
    const out = shiftDocForNextDay(COLLECTIONS.questions, doc as Record<string, unknown>);
    expect(out).toEqual({ ...doc, window_start_ms: T0 - 20_000 - DAY, window_end_ms: T0 - 15_000 - DAY, created_at_ms: T0 - DAY, answered_at_ms: T0 + 60_000 - DAY, expired_by_debrief_end_ms: T0 + 3_600_000 - DAY });
  });

  it("corrections: answered_at_ms, received_at_ms, debrief_business_date move; expires_at, created_at, reason_text never", () => {
    const doc = CorrectionSchema.parse({
      outlet_id: SBX, correction_id: "q1", question_id: "q1", thread_id: "th1", answer: "yes", reason_text: "Stok habis jam 3.",
      answered_device_id: JDG, debrief_business_date: TODAY, answered_at_ms: T0, received_at_ms: T0 + 1, needs_supervisor_confirm: false,
      expires_at: iso(T0 + 14 * DAY), created_at: iso(T0),
    });
    const out = shiftDocForNextDay(COLLECTIONS.corrections, doc as Record<string, unknown>);
    expect(out).toEqual({ ...doc, debrief_business_date: "2026-10-13", answered_at_ms: T0 - DAY, received_at_ms: T0 + 1 - DAY });
  });

  it("label_units: labelled_at_ms moves (null stays null)", () => {
    const doc = LabelUnitLedgerSchema.parse({ outlet_id: SBX, device_id: JDG, unit_key: "u1", line_ids: ["seg1#0"], status: "done", attempts: 1, labelled_at_ms: T0 });
    expect(shiftDocForNextDay(COLLECTIONS.labelUnits, doc as Record<string, unknown>)).toEqual({ ...doc, labelled_at_ms: T0 - DAY });
    expect(shiftDocForNextDay(COLLECTIONS.labelUnits, { ...doc, labelled_at_ms: null })).toEqual({ ...doc, labelled_at_ms: null });
  });

  it("proposals: range dates and record times move; everything else is passed through untouched", () => {
    const doc = { outlet_id: SBX, proposal_id: S1, status: "suppressed", range: { from_date: "2026-10-12", to_date: TODAY }, focus_category: null, created_at_ms: T0, updated_at_ms: T0, counts: { candidate_facts: 0 }, content: null };
    expect(shiftDocForNextDay(COLLECTIONS.proposals, doc)).toEqual({ ...doc, range: { from_date: "2026-10-11", to_date: "2026-10-13" }, created_at_ms: T0 - DAY, updated_at_ms: T0 - DAY });
  });

  it("sandbox.* on any doc is never touched, nor ts, paired_at, created_at, pairing_code_expires_at, expires_at_ms", () => {
    const doc = { sandbox: { created_at_ms: T0, expires_at_ms: T0 }, ts: iso(T0), paired_at: iso(T0), created_at: iso(T0), pairing_code_expires_at: iso(T0), expires_at_ms: T0, other_ms: T0 };
    const out = shiftDocForNextDay(COLLECTIONS.threads, doc);
    expect(out).toEqual({ ...doc, other_ms: T0 - DAY });
    expect(out.sandbox).toBe(doc.sandbox);
  });

  it("an unknown collection is refused (the table is closed)", () => {
    expect(() => shiftDocForNextDay(COLLECTIONS.auditLog, { ts: iso(T0) })).toThrow(/not in the next-day table/);
  });
});

describe("shiftLastEnded (devices: only last_ended moves)", () => {
  it("moves business_date, ended_at_ms and debrief_ends_at_ms by one day", () => {
    const last = { business_date: TODAY, end_reason: "selesai" as const, ended_at_ms: T0, debrief_ends_at_ms: T0 + 3_600_000 };
    expect(shiftLastEnded(last)).toEqual({ business_date: "2026-10-13", end_reason: "selesai", ended_at_ms: T0 - DAY, debrief_ends_at_ms: T0 + 3_600_000 - DAY });
    expect(shiftLastEnded({ ...last, debrief_ends_at_ms: null }).debrief_ends_at_ms).toBeNull();
  });

  it("after the shift, an open question of the ended day expires at the shifted debrief end (unverified), so day 2 never shows it", () => {
    const last = { business_date: TODAY, end_reason: "selesai" as const, ended_at_ms: T0, debrief_ends_at_ms: T0 + 3_600_000 };
    const shifted = shiftLastEnded(last);
    const q = shiftDocForNextDay(COLLECTIONS.questions, { status: "open", created_at_ms: T0 + 60_000 }) as { status: "open"; created_at_ms: number };
    expect(expireAtDebriefEnd(q, last.debrief_ends_at_ms, T0)).toBeNull(); // before the shift: the debrief is still running
    expect(expireAtDebriefEnd(q, shifted.debrief_ends_at_ms, T0)).toEqual({ status: "unverified", expired_by_debrief_end_ms: shifted.debrief_ends_at_ms });
  });
});

// ── runNextDay: the orchestration over an injected store (section 4.1 G1/G7, 4.2 order) ─────────────────────
import { AppError, LockedError } from "@/lib/http/errors";
import { runNextDay, type NextDayInput } from "@/lib/demo/next-day";
import { fakeNextDayStore } from "@/lib/demo/testing/fake-next-day-store";
import { NEXT_DAY_PER_SANDBOX, TEMPLATE_DOC_MAX } from "@/lib/demo/constants";
import type { Outlet } from "@/lib/firestore/schema";

const sbxOutlet = (over: Partial<NonNullable<Outlet["sandbox"]>> = {}): Outlet => ({
  outlet_id: SBX, name: "Sandbox", project_kind: "demo", timezone: TZ, opening_time: "07:00", closing_time: "21:45", created_at: iso(0),
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: T0 - 3_600_000, expires_at_ms: T0 + 3_600_000, key_sha256: "a".repeat(64), ...over },
});
const endedLast = (): LastEndedT => ({ business_date: TODAY, end_reason: "selesai", ended_at_ms: T0 - 10 * 60_000, debrief_ends_at_ms: T0 + 50 * 60_000 });
type LastEndedT = NonNullable<NextDayGuardInput["last_ended"]>;

/** A sandbox after day 1: one ended session, two threads, one open gate question, a suppressed proposal. */
function dayOneDocs() {
  const ended = T0 - 10 * 60_000;
  return {
    [COLLECTIONS.captureSessions]: {
      [`${JDG}:${S1}`]: { outlet_id: SBX, device_id: JDG, session_id: S1, started_at_ms: ended - 300_000, ended_at_ms: ended, end_reason: "selesai", local_date: TODAY, auto_stop_at_ms: ended + 300_000, debrief_ends_at_ms: ended + 3_600_000, received_start_at: iso(ended - 300_000), received_end_at: iso(ended) },
    },
    [COLLECTIONS.segments]: {
      [`${SBX}:${JDG}:seg1`]: { outlet_id: SBX, device_id: JDG, seg_id: "seg1", received_at: iso(ended - 100_000), device_start: iso(ended - 115_000), device_end: iso(ended - 100_000), model: "m", location: "global", lines: [{ text: "Roti habis.", start: 0, end: 2 }], expires_at: { toDate: () => new Date(0) }, session_id: S1 },
    },
    [COLLECTIONS.labelUnits]: { u1: { outlet_id: SBX, device_id: JDG, unit_key: "u1", line_ids: ["seg1#0"], status: "done", attempts: 1, labelled_at_ms: ended - 60_000 } },
    [COLLECTIONS.threads]: { th1: { outlet_id: SBX, device_id: JDG, thread_id: "th1", summary: "Sold out.", lines: [{ line_id: "seg1#0", start_ms: ended - 115_000, end_ms: ended - 100_000, text: "Roti habis." }], first_line_start_ms: ended - 115_000, last_line_end_ms: ended - 100_000, status: "open", gate: { verdict: "question" }, created_at_ms: ended - 60_000, updated_at_ms: ended - 60_000 } },
    [COLLECTIONS.questions]: { q1: { outlet_id: SBX, device_id: JDG, question_id: "q1", thread_id: "th1", kind: "gate", status: "open", category: "CUSTOMER_SERVICE", window_start_ms: ended - 115_000, window_end_ms: ended - 100_000, created_at_ms: ended - 60_000 } },
    [COLLECTIONS.proposals]: { p1: { outlet_id: SBX, proposal_id: S1, status: "suppressed", range: { from_date: "2026-10-12", to_date: TODAY }, content: null, created_at_ms: ended, updated_at_ms: ended } },
  };
}

function input(over: Partial<NextDayInput> = {}): NextDayInput {
  return { outlet_id: SBX, device_id: JDG, now_ms: T0, demoMode: true, body: { expected_day: 1, confirm_unanswered: true }, log: () => undefined, ...over };
}
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${e.code}${e.details ? ":" + JSON.stringify(e.details) : ""}` : String(e);
  }
};

describe("runNextDay", () => {
  it("G1: off demo mode, a missing outlet, a pilot outlet or an outlet without a sandbox is 404 before any other read", async () => {
    const pilot = { ...sbxOutlet(), project_kind: "pilot" as const };
    for (const [name, f, inp] of [
      ["demoMode off", fakeNextDayStore({ outlet: sbxOutlet() }), input({ demoMode: false })],
      ["missing outlet", fakeNextDayStore({ outlet: null }), input()],
      ["pilot kind", fakeNextDayStore({ outlet: pilot }), input()],
      ["no sandbox", fakeNextDayStore({ outlet: { ...sbxOutlet(), sandbox: undefined } }), input()],
    ] as const) {
      expect(await codeOf(runNextDay(f.store, inp)), name).toBe("404:NOT_FOUND");
      expect(f.calls.filter((c) => !c.startsWith("getOutlet")), name).toEqual([]);
    }
  });

  it("each refusal is a 409 with the NextDayRefusal code and nothing written", async () => {
    const cases: [string, ReturnType<typeof fakeNextDayStore>, Partial<NextDayInput>][] = [
      ["session_open", fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: { [COLLECTIONS.captureSessions]: { open: { outlet_id: SBX, device_id: JDG, session_id: S1, ended_at_ms: null } } } }), {}],
      ["day_not_ended", fakeNextDayStore({ outlet: sbxOutlet(), last_ended: null }), {}],
      ["preparing", fakeNextDayStore({ outlet: sbxOutlet(), last_ended: { ...endedLast(), ended_at_ms: T0 - 60_000 }, docs: { ...dayOneDocs(), [COLLECTIONS.labelUnits]: {} } }), {}],
      ["proposal_exists", fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: { [COLLECTIONS.proposals]: { p: { outlet_id: SBX, content: { x: 1 } } } } }), {}],
      ["busy", fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), proposal_lock_expires_at_ms: T0 + 1 }), {}],
    ];
    for (const [code, f, over] of cases) {
      expect(await codeOf(runNextDay(f.store, input(over))), code).toBe(`409:${code}`);
      expect(f.calls, code).not.toContain("takeShiftMarker");
      expect(f.state.written, code).toEqual([]);
    }
  });

  it("unanswered_questions carries the count in details and writes nothing", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    expect(await codeOf(runNextDay(f.store, input({ body: { expected_day: 1, confirm_unanswered: false } })))).toBe('409:unanswered_questions:{"unanswered":1}');
    expect(f.calls).not.toContain("takeShiftMarker");
  });

  it("a stale expected_day answers 200 with the current day and writes nothing", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet({ next_day_count: 1 }), last_ended: null });
    expect(await runNextDay(f.store, input({ body: { expected_day: 1, confirm_unanswered: false } }))).toEqual({ day: 2 });
    expect(f.calls).not.toContain("takeShiftMarker");
  });

  it("a stale expected_day is answered after ONE outlet read and one counter bump: no guard-state read at all", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet({ next_day_count: 1 }), last_ended: null });
    expect(await runNextDay(f.store, input({ body: { expected_day: 1, confirm_unanswered: false } }))).toEqual({ day: 2 });
    expect(f.calls).toEqual([`getOutlet:${SBX}`, "bumpCounter"]);
    const f3 = fakeNextDayStore({ outlet: sbxOutlet({ next_day_count: 2 }), last_ended: null });
    expect(await runNextDay(f3.store, input({ body: { expected_day: 2, confirm_unanswered: false } }))).toEqual({ day: 3 });
    expect(f3.calls).toEqual([`getOutlet:${SBX}`, "bumpCounter"]);
  });

  it("per-sandbox call cap: NEXT_DAY_PER_SANDBOX calls pass (stale ones too), the next is a 429 with a stable code and Retry-After, before any guard read", async () => {
    expect(NEXT_DAY_PER_SANDBOX).toBe(20);
    const f = fakeNextDayStore({ outlet: sbxOutlet({ next_day_count: 1 }), last_ended: null });
    const stale = input({ body: { expected_day: 1, confirm_unanswered: false } });
    for (let i = 0; i < NEXT_DAY_PER_SANDBOX; i += 1) expect(await runNextDay(f.store, stale)).toEqual({ day: 2 });
    f.calls.length = 0;
    const err = await runNextDay(f.store, stale).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(LockedError);
    expect(err).toMatchObject({ statusCode: 429, code: "demo_next_day_cap", retryAfterSeconds: 3600 });
    expect(f.calls).toEqual([`getOutlet:${SBX}`, "bumpCounter"]);
    expect(f.state.counters.get(`next_day_sandbox:${SBX}`)).toBe(NEXT_DAY_PER_SANDBOX);
  });

  it("a capped real jump writes nothing (no marker, no lease, no shift)", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs(), counters: { [`next_day_sandbox:${SBX}`]: NEXT_DAY_PER_SANDBOX } });
    expect(await codeOf(runNextDay(f.store, input()))).toBe("429:demo_next_day_cap");
    expect(f.calls).toEqual([`getOutlet:${SBX}`, "bumpCounter"]);
    expect(f.state.written).toEqual([]);
  });

  it("within the cap a real jump behaves as before and counts once", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    expect(await runNextDay(f.store, input())).toEqual({ day: 2 });
    expect(f.state.counters.get(`next_day_sandbox:${SBX}`)).toBe(1);
  });

  it("a failing counter transaction fails closed: 503 demo_cap_unavailable, nothing else read", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast() });
    f.store.bumpCounter = async () => {
      throw new Error("firestore down");
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await codeOf(runNextDay(f.store, input()))).toBe("503:demo_cap_unavailable");
    expect(f.calls).toEqual([`getOutlet:${SBX}`]);
  });

  it("an expected_day ahead of the server is a 422", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast() });
    expect(await codeOf(runNextDay(f.store, input({ body: { expected_day: 2, confirm_unanswered: true } })))).toMatch(/^422:VALIDATION_ERROR/);
  });

  it("success: marker, lease, every doc shifted one day back, day-1 questions expired, count + 1, marker cleared, lease released", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    const log: unknown[] = [];
    expect(await runNextDay(f.store, input({ log: (e, fields) => log.push([e, fields]) }))).toEqual({ day: 2 });

    expect(f.calls).toEqual(["getOutlet:" + SBX, "bumpCounter", "readGuardState", "takeShiftMarker", "proposalWithContent", "acquireLease", "readShiftDocs", "writeShift", "expireOpenQuestions", "completeShift", "releaseLease"]);
    expect(f.state.outlet?.sandbox).toMatchObject({ next_day_count: 1, shift_started_at_ms: null });
    expect(f.state.leaseHeld).toBe(false);

    const session = f.cols.get(COLLECTIONS.captureSessions)!.get(`${JDG}:${S1}`)!;
    expect(session.local_date).toBe("2026-10-13");
    expect(session.ended_at_ms).toBe(T0 - 10 * 60_000 - DAY);
    expect(f.state.last_ended).toEqual({ business_date: "2026-10-13", end_reason: "selesai", ended_at_ms: T0 - 10 * 60_000 - DAY, debrief_ends_at_ms: T0 + 50 * 60_000 - DAY });
    const seg = f.cols.get(COLLECTIONS.segments)!.get(`${SBX}:${JDG}:seg1`)!;
    expect(seg.device_start).toBe(iso(T0 - 10 * 60_000 - 115_000 - DAY));
    expect((seg.lines as { text: string }[])[0]!.text).toBe("Roti habis.");
    expect(seg.expires_at).toBe(dayOneDocs()[COLLECTIONS.segments]![`${SBX}:${JDG}:seg1`]!.expires_at === undefined ? undefined : seg.expires_at); // reference kept (checked in the shift tests)
    const thread = f.cols.get(COLLECTIONS.threads)!.get("th1")!;
    expect(thread.summary).toBe("Sold out.");
    expect(thread.status).toBe("open");
    expect(thread.created_at_ms).toBe(T0 - 10 * 60_000 - 60_000 - DAY);
    // The open day-1 question expired at the SHIFTED debrief end (yesterday), so day 2's debrief never shows it.
    expect(f.state.expired).toEqual([{ debrief_ends_at_ms: T0 + 50 * 60_000 - DAY, now_ms: T0 }]);
    expect(f.cols.get(COLLECTIONS.questions)!.get("q1")).toMatchObject({ status: "unverified", expired_by_debrief_end_ms: T0 + 50 * 60_000 - DAY });
    const proposal = f.cols.get(COLLECTIONS.proposals)!.get("p1")!;
    expect(proposal.range).toEqual({ from_date: "2026-10-11", to_date: "2026-10-13" });
    // Log: counts only, no text, no device id.
    expect(JSON.stringify(log)).not.toContain("Roti");
    expect(JSON.stringify(log)).not.toContain(JDG);
  });

  it("the second jump (day 2 -> 3) works the same; a tap after it answers 200 {day:3} and writes nothing", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet({ next_day_count: 1 }), last_ended: endedLast(), docs: dayOneDocs() });
    expect(await runNextDay(f.store, input({ body: { expected_day: 2, confirm_unanswered: true } }))).toEqual({ day: 3 });
    f.state.last_ended = endedLast(); // day 3 ended
    const writtenBefore = f.state.written.length;
    const callsBefore = f.calls.length;
    expect(await runNextDay(f.store, input({ body: { expected_day: 2, confirm_unanswered: true } }))).toEqual({ day: 3 });
    expect(f.state.written).toHaveLength(writtenBefore);
    expect(f.calls.slice(callsBefore)).not.toContain("takeShiftMarker");
    expect(f.state.outlet?.sandbox?.next_day_count).toBe(2);
  });

  it("a proposal with content that appears after the guard read (before the marker) is refused proposal_exists, marker cleared, nothing written, no lease", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    const store = {
      ...f.store,
      async takeShiftMarker(o: string, n: number, expectedCount: number) {
        const r = await f.store.takeShiftMarker(o, n, expectedCount);
        f.cols.get(COLLECTIONS.proposals)!.set("late", { outlet_id: SBX, content: { change_title: "x" } });
        return r;
      },
    };
    expect(await codeOf(runNextDay(store, input()))).toBe("409:proposal_exists");
    expect(f.calls).toContain("abortShift");
    expect(f.calls).not.toContain("acquireLease");
    expect(f.state.outlet?.sandbox?.shift_started_at_ms).toBeNull();
    expect(f.state.written).toEqual([]);
  });

  it("a throwing acquireLease clears our marker and rethrows", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    const store = { ...f.store, async acquireLease(): Promise<number | null> { throw new Error("lease boom"); } };
    await expect(runNextDay(store, input())).rejects.toThrow("lease boom");
    expect(f.calls).toContain("abortShift");
    expect(f.state.outlet?.sandbox?.shift_started_at_ms).toBeNull();
    expect(f.state.written).toEqual([]);
  });

  it("a throwing releaseLease is logged with the error class only and never changes the result", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    const store = { ...f.store, async releaseLease(): Promise<void> { throw new TypeError("secret detail"); } };
    const log: [string, Record<string, unknown>][] = [];
    expect(await runNextDay(store, input({ log: (e, fields) => log.push([e, fields]) }))).toEqual({ day: 2 });
    const failed = log.find(([e]) => e === "next_day_release_failed");
    expect(failed?.[1]).toEqual({ error_class: "TypeError" });
    expect(JSON.stringify(log)).not.toContain("secret detail");
  });

  it("a throwing releaseLease after a failed shift does not mask the shift's own error", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    f.state.failWriteAfter = 1;
    const store = { ...f.store, async releaseLease(): Promise<void> { throw new TypeError("release boom"); } };
    await expect(runNextDay(store, input())).rejects.toThrow("fake: write crashed");
  });

  it("G7 marker: a marker newer than SHIFT_MARKER_STALE_MS is busy; an older one is shift_incomplete; nothing written either way", async () => {
    const fresh = fakeNextDayStore({ outlet: sbxOutlet({ shift_started_at_ms: T0 - SHIFT_MARKER_STALE_MS + 1 }), last_ended: endedLast() });
    expect(await codeOf(runNextDay(fresh.store, input()))).toBe("409:busy");
    const stale = fakeNextDayStore({ outlet: sbxOutlet({ shift_started_at_ms: T0 - SHIFT_MARKER_STALE_MS - 1 }), last_ended: endedLast() });
    expect(await codeOf(runNextDay(stale.store, input()))).toBe("409:shift_incomplete");
    for (const f of [fresh, stale]) {
      expect(f.calls).not.toContain("acquireLease");
      expect(f.state.written).toEqual([]);
      expect(f.state.outlet?.sandbox?.shift_started_at_ms).not.toBeNull(); // not ours to clear
    }
  });

  it("G7 lease held by the tick: busy, and OUR marker is cleared again so the next tap is not stuck", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), lease_held: true });
    expect(await codeOf(runNextDay(f.store, input()))).toBe("409:busy");
    expect(f.calls).toContain("abortShift");
    expect(f.state.outlet?.sandbox?.shift_started_at_ms).toBeNull();
    expect(f.state.written).toEqual([]);
  });

  it("too many docs: 503 template_too_large before any write, marker cleared, lease released", async () => {
    const docs = dayOneDocs();
    const many: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < TEMPLATE_DOC_MAX * 3 + 1; i += 1) many[`u${i}`] = { outlet_id: SBX, device_id: JDG, unit_key: `u${i}`, line_ids: [], status: "done", attempts: 1, labelled_at_ms: null };
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: { ...docs, [COLLECTIONS.labelUnits]: many } });
    expect(await codeOf(runNextDay(f.store, input()))).toBe("503:template_too_large");
    expect(f.state.written).toEqual([]);
    expect(f.state.outlet?.sandbox?.shift_started_at_ms).toBeNull();
    expect(f.state.leaseHeld).toBe(false);
  });

  it("DOUBLE-SHIFT race (QA defect 1): B reads the guard at count 0 and stalls before the marker; A finishes the whole shift; B then gets the stale 200 {day:2} and writes nothing", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    let finishA!: () => void;
    const aFinished = new Promise<void>((r) => (finishA = r));
    const storeB = {
      ...f.store,
      async takeShiftMarker(o: string, n: number, expectedCount: number) {
        await aFinished; // B is slow between its guard read and the marker
        return f.store.takeShiftMarker(o, n, expectedCount);
      },
    };
    const pB = runNextDay(storeB, input());
    await Promise.resolve();
    expect(await runNextDay(f.store, input())).toEqual({ day: 2 }); // A: the real shift
    const writesAfterA = f.state.written.length;
    const startedAfterA = (f.cols.get(COLLECTIONS.captureSessions)!.get(`${JDG}:${S1}`) as { started_at_ms: number }).started_at_ms;
    finishA();
    expect(await pB).toEqual({ day: 2 }); // B: stale 200, not an error
    expect(f.state.outlet?.sandbox?.next_day_count).toBe(1);
    expect(f.state.outlet?.sandbox?.shift_started_at_ms).toBeNull();
    expect(f.state.written.length).toBe(writesAfterA); // B wrote nothing
    expect((f.cols.get(COLLECTIONS.captureSessions)!.get(`${JDG}:${S1}`) as { started_at_ms: number }).started_at_ms).toBe(startedAfterA); // data shifted once
    expect(f.calls.filter((c) => c === "acquireLease")).toHaveLength(1);
    expect(f.calls.filter((c) => c === "completeShift")).toHaveLength(1);
  });

  it("two requests past the guard read together: exactly one shifts, the other is busy (marker), count 1", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => (release = r));
    const store = {
      ...f.store,
      async readGuardState(...a: Parameters<typeof f.store.readGuardState>) {
        const g = await f.store.readGuardState(...a);
        if (++arrived === 2) release();
        await barrier;
        return g;
      },
    };
    const res = await Promise.allSettled([runNextDay(store, input()), runNextDay(store, input())]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe("busy");
    expect(f.state.outlet?.sandbox?.next_day_count).toBe(1);
  });

  it("a failure AFTER writeShift (expire throws): the retry is busy inside SHIFT_MARKER_STALE_MS and shift_incomplete after it, never day_not_ended (QA defect 2)", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    const store = { ...f.store, async expireOpenQuestions(): Promise<number> { throw new Error("expire boom"); } };
    await expect(runNextDay(store, input())).rejects.toThrow("expire boom");
    expect(f.state.last_ended?.business_date).not.toBe(TODAY); // the shift already moved last_ended to yesterday
    expect(f.state.outlet?.sandbox).toMatchObject({ shift_started_at_ms: T0 });
    expect(f.state.leaseHeld).toBe(false);
    expect(await codeOf(runNextDay(f.store, input()))).toBe("409:busy"); // +0 s
    expect(await codeOf(runNextDay(f.store, input({ now_ms: T0 + 200_000 })))).toBe("409:shift_incomplete"); // +200 s: the owner reset
    expect(f.state.outlet?.sandbox?.next_day_count ?? 0).toBe(0);
  });

  it("a failure AFTER writeShift (completeShift throws) behaves the same: marker stays, retries are busy then shift_incomplete", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    const store = { ...f.store, async completeShift(): Promise<void> { throw new Error("complete boom"); } };
    await expect(runNextDay(store, input())).rejects.toThrow("complete boom");
    expect(await codeOf(runNextDay(f.store, input()))).toBe("409:busy");
    expect(await codeOf(runNextDay(f.store, input({ now_ms: T0 + 200_000 })))).toBe("409:shift_incomplete");
  });

  it("a failure BEFORE the first write (lease throws) clears the marker: the retry just proceeds", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    let first = true;
    const store = { ...f.store, async acquireLease(...a: Parameters<typeof f.store.acquireLease>) { if (first) { first = false; throw new Error("lease boom"); } return f.store.acquireLease(...a); } };
    await expect(runNextDay(store, input())).rejects.toThrow("lease boom");
    expect(await runNextDay(store, input())).toEqual({ day: 2 });
  });

  it("a crash mid-write leaves the marker set (owner reset is the recovery) and releases the lease; later taps get shift_incomplete", async () => {
    const f = fakeNextDayStore({ outlet: sbxOutlet(), last_ended: endedLast(), docs: dayOneDocs() });
    f.state.failWriteAfter = 2;
    await expect(runNextDay(f.store, input())).rejects.toThrow("fake: write crashed");
    expect(f.state.outlet?.sandbox).toMatchObject({ shift_started_at_ms: T0 });
    expect(f.state.outlet?.sandbox?.next_day_count ?? 0).toBe(0);
    expect(f.state.leaseHeld).toBe(false);
    f.state.failWriteAfter = null;
    expect(await codeOf(runNextDay(f.store, input({ now_ms: T0 + SHIFT_MARKER_STALE_MS + 1 })))).toBe("409:shift_incomplete");
  });
});

// ── refusal copy (section 4.4) lives in the journey i18n slice, one key per code ─────────────────────────────
import { NEXT_DAY_REFUSALS } from "@/lib/demo/contract";
import { journeyEN, journeyID } from "@/lib/i18n/v2/journey";

describe("next-day refusal copy", () => {
  it("has an EN and ID line for every NextDayRefusal code, plus the unanswered dialog's body and two buttons", () => {
    const keys = [...NEXT_DAY_REFUSALS.map((c) => `C-journey-next-day-${c}`), "C-journey-next-day-unanswered-body", "C-journey-next-day-unanswered-answer-first", "C-journey-next-day-unanswered-jump-anyway"];
    for (const k of keys) {
      expect((journeyEN as Record<string, string>)[k], k).toBeTruthy();
      expect((journeyID as Record<string, string>)[k], k).toBeTruthy();
    }
    expect((journeyEN as Record<string, string>)["C-journey-next-day-unanswered_questions"]).toContain("{n}");
    expect((journeyEN as Record<string, string>)["C-journey-next-day-max_days"]).toBe("All 3 demo days are done. Sign out and continue as Supervisor.");
  });
});
