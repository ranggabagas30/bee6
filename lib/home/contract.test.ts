import { describe, expect, it } from "vitest";
import { HOME_LINES, HomeLineSchema, HomeResponseSchema } from "@/lib/home/contract";

const baseLine = {
  start_hm: "10:00",
  category: "ROUTINE_OPS" as const,
  summary: "Did a thing.",
};

const baseResponse = {
  today: "2026-10-08",
  day_status: "on" as const,
  fact_count: 3,
  lines: [baseLine],
  more: 0,
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
      ["day_status", "fact_count", "lines", "more", "today"].sort(),
    );
  });
});
