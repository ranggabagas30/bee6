import { describe, expect, it } from "vitest";
import type { SupervisorThread, SupervisorUnlabelled } from "@/lib/day/contract";
import type { TimelineItem } from "@/lib/day/view-model";
import { CATEGORIES } from "@/lib/pipeline/categories";
import {
  CATEGORY_CODE,
  debriefOutcome,
  debriefRows,
  hasQuestion,
  isFactStatus,
  needsCheck,
  statusPill,
  summarize,
} from "@/app/day/summary";

function thread(overrides: Partial<SupervisorThread> = {}): SupervisorThread {
  return {
    row: 0,
    category: "COMPLAINT",
    start_hm: "10:00",
    end_hm: "10:05",
    summary: "S",
    confidence_pct: 70,
    display_status: "fact",
    evidence: [],
    evidence_more: 0,
    staff_answer: null,
    runner_up: null,
    handle: null,
    can_review: false,
    ...overrides,
  };
}

function unlabelled(overrides: Partial<SupervisorUnlabelled> = {}): SupervisorUnlabelled {
  return { key: 0, after_row: null, start_hm: "09:00", end_hm: "09:02", display_status: "question_open", staff_answer: null, ...overrides };
}

describe("CATEGORY_CODE", () => {
  it("has a unique three-letter code for every work category", () => {
    const work = CATEGORIES.filter((c) => c !== "NON_WORK");
    const codes = work.map((c) => CATEGORY_CODE[c as keyof typeof CATEGORY_CODE]);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(work.length);
  });
});

describe("needsCheck", () => {
  const reviewable = { can_review: true, handle: "H", display_status: "awaiting_supervisor" as const };

  it("is true for a reviewable row that is not a fact and not rejected by a supervisor", () => {
    for (const display_status of ["awaiting_supervisor", "question_answered", "rejected_by_staff"] as const) {
      expect(needsCheck(thread({ ...reviewable, display_status }))).toBe(true);
    }
  });

  it("is false for facts, a supervisor rejection, no handle, or a row the server says is not reviewable", () => {
    expect(needsCheck(thread({ ...reviewable, display_status: "fact_supervisor_confirmed" }))).toBe(false);
    expect(needsCheck(thread({ ...reviewable, display_status: "fact_staff_confirmed" }))).toBe(false);
    expect(needsCheck(thread({ ...reviewable, display_status: "rejected_by_supervisor" }))).toBe(false);
    expect(needsCheck(thread({ ...reviewable, handle: null }))).toBe(false);
    expect(needsCheck(thread({ ...reviewable, can_review: false }))).toBe(false);
  });

  it("isFactStatus agrees with the three fact statuses", () => {
    expect(isFactStatus("fact")).toBe(true);
    expect(isFactStatus("fact_staff_confirmed")).toBe(true);
    expect(isFactStatus("fact_supervisor_confirmed")).toBe(true);
    expect(isFactStatus("question_open")).toBe(false);
  });
});

describe("statusPill", () => {
  it.each([
    ["fact", false, "neutral", "C-day2-pill-auto"],
    ["fact_supervisor_confirmed", false, "green", "C-day-st-fact-supervisor"],
    ["fact_staff_confirmed", false, "green", "C-day-st-fact-staff"],
    ["rejected_by_staff", false, "red", "C-day-st-rejected"],
    ["rejected_by_supervisor", false, "red", "C-day-st-rejected-supervisor"],
    ["unverified", false, "amber", "C-day-st-unverified"],
    ["question_open", false, "neutral", "C-day-st-open"],
    ["awaiting_supervisor", false, "neutral", "C-day-st-supervisor"],
    ["awaiting_supervisor", true, "amber", "C-day2-pill-check"],
    ["fact", true, "amber", "C-day2-pill-check"],
  ] as const)("%s (check=%s) -> %s / %s", (status, check, tone, key) => {
    expect(statusPill(status, check)).toEqual({ tone, key });
  });
});

describe("debrief rows", () => {
  it("hasQuestion: an answer, or a status only a question produces; a plain fact has none", () => {
    expect(hasQuestion(thread({ display_status: "fact" }))).toBe(false);
    expect(hasQuestion(thread({ display_status: "fact", staff_answer: { answer: "yes", reason: null } }))).toBe(true);
    expect(hasQuestion(thread({ display_status: "question_open" }))).toBe(true);
    expect(hasQuestion(thread({ display_status: "unverified" }))).toBe(true);
    expect(hasQuestion(thread({ display_status: "fact_supervisor_confirmed" }))).toBe(false);
  });

  it("debriefOutcome: yes / no from the answer; unverified or open from the status", () => {
    expect(debriefOutcome({ staff_answer: { answer: "yes", reason: null }, display_status: "question_answered" })).toBe("yes");
    expect(debriefOutcome({ staff_answer: { answer: "no", reason: "r" }, display_status: "rejected_by_staff" })).toBe("no");
    expect(debriefOutcome({ staff_answer: null, display_status: "unverified" })).toBe("unverified");
    expect(debriefOutcome({ staff_answer: null, display_status: "question_open" })).toBe("open");
  });

  it("debriefRows keeps timeline order, skips plain facts, keeps every unlabelled moment, and carries no id", () => {
    const timeline: TimelineItem<SupervisorThread>[] = [
      { kind: "unlabelled", item: unlabelled({ key: 0 }) },
      { kind: "thread", thread: thread({ row: 0, display_status: "fact" }) },
      { kind: "thread", thread: thread({ row: 1, display_status: "question_answered", staff_answer: { answer: "no", reason: "R1" } }) },
    ];
    const rows = debriefRows(timeline);
    expect(rows.map((r) => r.key)).toEqual(["u-0", "t-1"]);
    expect(rows[0]).toMatchObject({ kind: "unlabelled_unit", category: null, outcome: "open", reason: null });
    expect(rows[1]).toMatchObject({ kind: "gate", category: "COMPLAINT", outcome: "no", reason: "R1" });
    expect(JSON.stringify(rows)).not.toMatch(/handle|device|question_id/);
  });
});

describe("summarize (the three tiles, ruling R16)", () => {
  it("counts notes, answered of asked, unverified/open and need-your-check (threads + open unlabelled)", () => {
    const threads = [
      thread({ row: 0, display_status: "fact" }),
      thread({ row: 1, display_status: "awaiting_supervisor", staff_answer: { answer: "yes", reason: null }, can_review: true, handle: "H", start_hm: "13:05", category: "ROUTINE_OPS" }),
      thread({ row: 2, display_status: "rejected_by_staff", staff_answer: { answer: "no", reason: "r" } }),
      thread({ row: 3, display_status: "unverified" }),
    ];
    const s = summarize(threads, [unlabelled({ key: 0, display_status: "question_open" }), unlabelled({ key: 1, display_status: "unverified" })]);
    expect(s).toMatchObject({ notes: 4, unlabelled: 2, asked: 5, answered: 2, unverified: 2, open: 1, check: 2 });
    expect(s.firstCheck?.start_hm).toBe("13:05");
  });

  it("an empty day is all zeros with no first check", () => {
    expect(summarize([], [])).toMatchObject({ notes: 0, asked: 0, answered: 0, check: 0, firstCheck: null });
  });
});
