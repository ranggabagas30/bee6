import { describe, expect, it } from "vitest";
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
import { demoDayOf, demoDaysDone, isPreparing, nextDayDecision, nextDayEligibility, type NextDayGuardInput } from "@/lib/demo/next-day";
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
    expect(nextDayDecision({ ...okInput({ next_day_count: 2, last_ended: null }), expected_day: 2, confirm_unanswered: false, open_questions: 0 })).toEqual({ kind: "stale", day: 3 });
    expect(nextDayDecision({ ...okInput({ next_day_count: 2, last_ended: null }), expected_day: 1, confirm_unanswered: false, open_questions: 0 })).toEqual({ kind: "stale", day: 3 });
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
