import { describe, expect, it } from "vitest";
import {
  DayParamSchema,
  DayRecordResponseSchema,
  OwnerDayHeaderSchema,
  OwnerThreadSchema,
  SupervisorDayHeaderSchema,
  SupervisorThreadSchema,
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
  it.each(["evidence", "staff_answer", "lines", "reason", "thread_id", "device_id", "question_id", "handle", "can_review"])(
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
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
