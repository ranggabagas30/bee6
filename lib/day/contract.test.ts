import { describe, expect, it } from "vitest";
import {
  ConfirmBodySchema,
  ConfirmResponseSchema,
  DayParamSchema,
  DayRecordResponseSchema,
  OwnerDayHeaderSchema,
  OwnerThreadSchema,
  RunnerUpSchema,
  SupervisorDayHeaderSchema,
  SupervisorThreadSchema,
  SupervisorUnlabelledSchema,
  UNLABELLED_CAP,
} from "@/lib/day/contract";

const baseThread = {
  row: 0,
  category: "ROUTINE_OPS" as const,
  start_hm: "10:00",
  end_hm: "10:05",
  summary: "Did a thing.",
  confidence_pct: 90,
};

describe("DayParamSchema", () => {
  it.each(["today", "2026-10-08"])("accepts %s", (v) => {
    expect(DayParamSchema.safeParse(v).success).toBe(true);
  });

  it.each(["2026-13-01", "2026-02-30", "20261008", "TODAY", "2026-10-08T00:00", ""])(
    "rejects %s",
    (v) => {
      expect(DayParamSchema.safeParse(v).success).toBe(false);
    },
  );
});

describe("OwnerThreadSchema", () => {
  it.each([
    "evidence",
    "staff_answer",
    "lines",
    "reason",
    "thread_id",
    "device_id",
    "question_id",
    "handle",
    "can_review",
    "runner_up",
  ])(
    "rejects the extra key %s",
    (key) => {
      const result = OwnerThreadSchema.safeParse({ ...baseThread, display_status: "fact", [key]: "x" });
      expect(result.success).toBe(false);
    },
  );

  it.each([
    "question_open",
    "question_answered",
    "awaiting_supervisor",
    "rejected_by_staff",
    "rejected_by_supervisor",
    "unverified",
  ])("rejects the non-fact display_status %s", (status) => {
    const result = OwnerThreadSchema.safeParse({ ...baseThread, display_status: status });
    expect(result.success).toBe(false);
  });

  it("accepts every fact display_status", () => {
    for (const status of ["fact", "fact_staff_confirmed", "fact_supervisor_confirmed"]) {
      expect(OwnerThreadSchema.safeParse({ ...baseThread, display_status: status }).success).toBe(true);
    }
  });

  it("has exactly the expected keys (no more, no less)", () => {
    expect(Object.keys(OwnerThreadSchema.shape).sort()).toEqual(
      ["category", "confidence_pct", "display_status", "end_hm", "row", "start_hm", "summary"].sort(),
    );
  });
});

describe("OwnerDayHeaderSchema / SupervisorDayHeaderSchema", () => {
  const baseHeader = {
    date: "2026-10-08",
    today: "2026-10-08",
    day_status: "on" as const,
    sessions_cancelled: 0,
    capture_mode: "room" as const,
    fact_count: 3,
    truncated: false,
  };

  it("OwnerDayHeaderSchema rejects question_count", () => {
    expect(OwnerDayHeaderSchema.safeParse({ ...baseHeader, question_count: 1 }).success).toBe(false);
  });

  it("OwnerDayHeaderSchema accepts without question_count", () => {
    expect(OwnerDayHeaderSchema.safeParse(baseHeader).success).toBe(true);
  });

  it("SupervisorDayHeaderSchema requires question_count", () => {
    expect(SupervisorDayHeaderSchema.safeParse(baseHeader).success).toBe(false);
    expect(SupervisorDayHeaderSchema.safeParse({ ...baseHeader, question_count: 2 }).success).toBe(true);
  });
});

describe("SupervisorThreadSchema", () => {
  const baseSupervisorThread = {
    ...baseThread,
    display_status: "question_open" as const,
    evidence: [],
    evidence_more: 0,
    staff_answer: null,
    runner_up: null,
    handle: null,
    can_review: false,
  };

  it.each(["thread_id", "device_id", "answered_device_id", "question_id"])(
    "rejects the extra key %s",
    (key) => {
      expect(SupervisorThreadSchema.safeParse({ ...baseSupervisorThread, [key]: "x" }).success).toBe(false);
    },
  );

  it("rejects 21 evidence lines (cap is 20)", () => {
    const evidence = Array.from({ length: 21 }, (_, i) => ({ hm: "10:00", text: `line ${i}` }));
    expect(SupervisorThreadSchema.safeParse({ ...baseSupervisorThread, evidence }).success).toBe(false);
  });

  it("accepts exactly 20 evidence lines", () => {
    const evidence = Array.from({ length: 20 }, (_, i) => ({ hm: "10:00", text: `line ${i}` }));
    expect(SupervisorThreadSchema.safeParse({ ...baseSupervisorThread, evidence }).success).toBe(true);
  });

  it("requires handle (null allowed) and can_review", () => {
    expect(SupervisorThreadSchema.safeParse({ ...baseSupervisorThread, handle: "abc123" }).success).toBe(true);
    const { handle: _h, ...withoutHandle } = baseSupervisorThread;
    expect(SupervisorThreadSchema.safeParse(withoutHandle).success).toBe(false);
    const { can_review: _c, ...withoutCanReview } = baseSupervisorThread;
    expect(SupervisorThreadSchema.safeParse(withoutCanReview).success).toBe(false);
  });

  it("rejects an empty-string or over-length handle", () => {
    expect(SupervisorThreadSchema.safeParse({ ...baseSupervisorThread, handle: "" }).success).toBe(false);
    expect(
      SupervisorThreadSchema.safeParse({ ...baseSupervisorThread, handle: "a".repeat(513) }).success,
    ).toBe(false);
  });
});

describe("ConfirmBodySchema", () => {
  it("accepts { action: 'confirm' }", () => {
    expect(ConfirmBodySchema.safeParse({ action: "confirm" }).success).toBe(true);
  });

  it("accepts { action: 'override', category }", () => {
    expect(ConfirmBodySchema.safeParse({ action: "override", category: "COMPLAINT" }).success).toBe(true);
  });

  it("rejects override with no category", () => {
    expect(ConfirmBodySchema.safeParse({ action: "override" }).success).toBe(false);
  });

  it("rejects override with category NON_WORK", () => {
    expect(ConfirmBodySchema.safeParse({ action: "override", category: "NON_WORK" }).success).toBe(false);
  });

  it("rejects confirm with an extra category key (strict)", () => {
    expect(ConfirmBodySchema.safeParse({ action: "confirm", category: "COMPLAINT" }).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(ConfirmBodySchema.safeParse({ action: "delete" }).success).toBe(false);
  });

  it("accepts { action: 'reject' } (v4, Task 15)", () => {
    expect(ConfirmBodySchema.safeParse({ action: "reject" }).success).toBe(true);
  });

  it("rejects a reject body carrying a category (strict)", () => {
    expect(ConfirmBodySchema.safeParse({ action: "reject", category: "COMPLAINT" }).success).toBe(false);
  });

  it("rejects a reject body carrying free text (no reason is ever accepted)", () => {
    expect(ConfirmBodySchema.safeParse({ action: "reject", reason: "x" }).success).toBe(false);
  });
});

describe("ConfirmResponseSchema", () => {
  it("accepts a confirmed response", () => {
    expect(
      ConfirmResponseSchema.safeParse({
        result: "confirmed",
        category: "COMPLAINT",
        display_status: "fact_supervisor_confirmed",
      }).success,
    ).toBe(true);
  });

  it("rejects display_status: fact", () => {
    expect(
      ConfirmResponseSchema.safeParse({
        result: "confirmed",
        category: "COMPLAINT",
        display_status: "fact",
      }).success,
    ).toBe(false);
  });

  it("accepts a rejected response (v4, Task 15)", () => {
    expect(
      ConfirmResponseSchema.safeParse({
        result: "rejected",
        category: "COMPLAINT",
        display_status: "rejected_by_supervisor",
      }).success,
    ).toBe(true);
  });
});

describe("DayRecordResponseSchema", () => {
  it("the owner variant rejects a thread carrying evidence: []", () => {
    const result = DayRecordResponseSchema.safeParse({
      view: "owner",
      day: {
        date: "2026-10-08",
        today: "2026-10-08",
        day_status: "on",
        sessions_cancelled: 0,
        capture_mode: "room",
        fact_count: 1,
        truncated: false,
      },
      threads: [{ ...baseThread, display_status: "fact", evidence: [] }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid owner response", () => {
    const result = DayRecordResponseSchema.safeParse({
      view: "owner",
      day: {
        date: "2026-10-08",
        today: "2026-10-08",
        day_status: "on",
        sessions_cancelled: 0,
        capture_mode: "room",
        fact_count: 1,
        truncated: false,
      },
      threads: [{ ...baseThread, display_status: "fact" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid supervisor response", () => {
    const result = DayRecordResponseSchema.safeParse({
      view: "supervisor",
      day: {
        date: "2026-10-08",
        today: "2026-10-08",
        day_status: "on",
        sessions_cancelled: 0,
        capture_mode: "room",
        fact_count: 1,
        question_count: 1,
        truncated: false,
      },
      threads: [
        {
          ...baseThread,
          display_status: "question_open",
          evidence: [],
          evidence_more: 0,
          staff_answer: null,
          runner_up: null,
          handle: null,
          can_review: false,
        },
      ],
      unlabelled: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a supervisor response missing the unlabelled key (Task 12: required, not optional)", () => {
    const result = DayRecordResponseSchema.safeParse({
      view: "supervisor",
      day: {
        date: "2026-10-08",
        today: "2026-10-08",
        day_status: "on",
        sessions_cancelled: 0,
        capture_mode: "room",
        fact_count: 0,
        question_count: 0,
        truncated: false,
      },
      threads: [],
    });
    expect(result.success).toBe(false);
  });

  it("the owner variant rejects an extra unlabelled key (hard rule #7: an unlabelled unit can never reach the owner)", () => {
    const result = DayRecordResponseSchema.safeParse({
      view: "owner",
      day: {
        date: "2026-10-08",
        today: "2026-10-08",
        day_status: "on",
        sessions_cancelled: 0,
        capture_mode: "room",
        fact_count: 0,
        truncated: false,
      },
      threads: [],
      unlabelled: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("SupervisorUnlabelledSchema", () => {
  const baseUnlabelled = {
    key: 0,
    after_row: null,
    start_hm: "10:00",
    end_hm: "10:02",
    display_status: "question_open" as const,
    staff_answer: null,
  };

  it("accepts a valid open row with after_row null", () => {
    expect(SupervisorUnlabelledSchema.safeParse(baseUnlabelled).success).toBe(true);
  });

  it("accepts a valid answered row with after_row set and a staff answer", () => {
    expect(
      SupervisorUnlabelledSchema.safeParse({
        ...baseUnlabelled,
        after_row: 3,
        display_status: "question_answered",
        staff_answer: { answer: "yes", reason: "Because of X" },
      }).success,
    ).toBe(true);
  });

  it.each(["question_id", "device_id", "thread_id", "category", "summary", "confidence_pct", "evidence"])(
    "rejects the extra key %s (strict; no id that embeds a device id, hard rule #7)",
    (key) => {
      const result = SupervisorUnlabelledSchema.safeParse({ ...baseUnlabelled, [key]: "x" });
      expect(result.success).toBe(false);
    },
  );

  it.each(["fact", "awaiting_supervisor", "rejected_by_staff", "rejected_by_supervisor"])(
    "rejects a thread-only display_status %s",
    (display_status) => {
      const result = SupervisorUnlabelledSchema.safeParse({ ...baseUnlabelled, display_status });
      expect(result.success).toBe(false);
    },
  );

  it("rejects a negative after_row", () => {
    expect(SupervisorUnlabelledSchema.safeParse({ ...baseUnlabelled, after_row: -1 }).success).toBe(false);
  });

  it(`DayRecordResponseSchema caps unlabelled at UNLABELLED_CAP (${UNLABELLED_CAP})`, () => {
    const many = Array.from({ length: UNLABELLED_CAP + 1 }, (_, i) => ({ ...baseUnlabelled, key: i }));
    const result = DayRecordResponseSchema.safeParse({
      view: "supervisor",
      day: {
        date: "2026-10-08",
        today: "2026-10-08",
        day_status: "on",
        sessions_cancelled: 0,
        capture_mode: "room",
        fact_count: 0,
        question_count: UNLABELLED_CAP + 1,
        truncated: true,
      },
      threads: [],
      unlabelled: many,
    });
    expect(result.success).toBe(false);
  });
});

describe("RunnerUpSchema", () => {
  it("accepts a work category and a NON_WORK category", () => {
    expect(RunnerUpSchema.safeParse({ category: "CUSTOMER_SERVICE", why_not: "Not a service request." }).success).toBe(true);
    expect(RunnerUpSchema.safeParse({ category: "NON_WORK", why_not: "Small talk." }).success).toBe(true);
  });

  it("accepts a null why_not", () => {
    expect(RunnerUpSchema.safeParse({ category: "ROUTINE_OPS", why_not: null }).success).toBe(true);
  });

  it("rejects a blank why_not (the service maps blank to null before this parse)", () => {
    expect(RunnerUpSchema.safeParse({ category: "ROUTINE_OPS", why_not: "" }).success).toBe(false);
  });

  it("rejects an extra key (strict)", () => {
    expect(
      RunnerUpSchema.safeParse({ category: "ROUTINE_OPS", why_not: "x", thread_id: "t1" }).success,
    ).toBe(false);
  });
});
