import { describe, expect, it } from "vitest";
import { HOME_LINES, HomeLineSchema, HomeResponseSchema } from "@/lib/home/contract";

const baseLine = {
  start_hm: "10:00",
  category: "ROUTINE_OPS" as const,
  summary: "Did a thing.",
};

const zero = { approved: 0, rejected: 0 };
const baseExtension = {
  progress: { week: zero, month: zero, since_start: zero },
  waiting_approval: { count: 0, items: [] },
  next_review: { date: null, change_title: null },
};

const baseResponse = {
  today: "2026-10-08",
  day_status: "on" as const,
  fact_count: 3,
  lines: [baseLine],
  more: 0,
  ...baseExtension,
};

describe("HomeLineSchema", () => {
  it("accepts a well-formed line", () => {
    expect(HomeLineSchema.safeParse(baseLine).success).toBe(true);
  });

  it.each(["evidence", "handle", "question_count", "runner_up"])(
    "rejects the extra key %s",
    (key) => {
      expect(HomeLineSchema.safeParse({ ...baseLine, [key]: "x" }).success).toBe(false);
    },
  );
});

describe("HomeResponseSchema", () => {
  it("accepts a well-formed response", () => {
    expect(HomeResponseSchema.safeParse(baseResponse).success).toBe(true);
  });

  it(`rejects a ${HOME_LINES + 1}th line`, () => {
    const lines = Array.from({ length: HOME_LINES + 1 }, () => baseLine);
    expect(HomeResponseSchema.safeParse({ ...baseResponse, lines }).success).toBe(false);
  });

  it(`accepts exactly ${HOME_LINES} lines`, () => {
    const lines = Array.from({ length: HOME_LINES }, () => baseLine);
    expect(HomeResponseSchema.safeParse({ ...baseResponse, lines }).success).toBe(true);
  });

  it.each(["evidence", "handle", "question_count", "runner_up"])(
    "rejects the extra key %s",
    (key) => {
      expect(HomeResponseSchema.safeParse({ ...baseResponse, [key]: "x" }).success).toBe(false);
    },
  );

  it("has exactly the expected keys (no more, no less)", () => {
    expect(Object.keys(HomeResponseSchema.shape).sort()).toEqual(
      ["day_status", "fact_count", "lines", "more", "today", "progress", "waiting_approval", "next_review"].sort(),
    );
  });

  // R-19 PR-8 (plan 9.2): the strict extension. No cost field: "Cost per outlet" is a placeholder the UI owns.
  it.each(["progress", "waiting_approval", "next_review"])("rejects a response missing %s", (key) => {
    const { [key]: _dropped, ...rest } = baseResponse as Record<string, unknown>;
    expect(HomeResponseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a cost field (never invented)", () => {
    expect(HomeResponseSchema.safeParse({ ...baseResponse, cost: { idr: 0 } }).success).toBe(false);
  });

  it("accepts waiting items with proposal_id + change_title and a dated next review", () => {
    const ok = {
      ...baseResponse,
      waiting_approval: { count: 7, items: [{ proposal_id: "11111111-1111-4111-8111-111111111111", change_title: "Read the order back" }] },
      next_review: { date: "2026-10-30", change_title: "Read the order back" },
    };
    expect(HomeResponseSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects a waiting item that carries anything beyond proposal_id and change_title (rule 7)", () => {
    const bad = {
      ...baseResponse,
      waiting_approval: { count: 1, items: [{ proposal_id: "11111111-1111-4111-8111-111111111111", change_title: "T", device_id: "d" }] },
    };
    expect(HomeResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects more than 5 waiting items", () => {
    const item = { proposal_id: "11111111-1111-4111-8111-111111111111", change_title: "T" };
    const bad = { ...baseResponse, waiting_approval: { count: 6, items: Array.from({ length: 6 }, () => item) } };
    expect(HomeResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a negative tally", () => {
    const bad = { ...baseResponse, progress: { ...baseResponse.progress, week: { approved: -1, rejected: 0 } } };
    expect(HomeResponseSchema.safeParse(bad).success).toBe(false);
  });
});
