import { describe, expect, it } from "vitest";
import {
  ClosingRefusalDetailsSchema,
  ClosingRefusalSchema,
  DemoClosingBodySchema,
  DemoClosingResponseSchema,
  DemoNextDayBodySchema,
  DemoNextDayResponseSchema,
  DemoProcessNowBodySchema,
  DemoProcessNowResponseSchema,
  DemoProgressResponseSchema,
  DemoResetBodySchema,
  DemoResetResponseSchema,
  DemoSessionBodySchema,
  DemoSessionResponseSchema,
  NEXT_DAY_REFUSALS,
  NextDayRefusalDetailsSchema,
  NextDayRefusalSchema,
} from "@/lib/demo/contract";

const KEY = "A".repeat(43);

describe("DemoSessionBodySchema", () => {
  it("accepts each role, with or without a well-formed sandbox_key", () => {
    for (const role of ["owner", "supervisor", "staff"]) {
      expect(DemoSessionBodySchema.safeParse({ role }).success).toBe(true);
      expect(DemoSessionBodySchema.safeParse({ role, sandbox_key: KEY }).success).toBe(true);
    }
    expect(DemoSessionBodySchema.safeParse({ role: "staff", sandbox_key: "a-_9".repeat(10) + "abc" }).success).toBe(true);
  });

  it("rejects an unknown role, an extra key and a malformed key", () => {
    expect(DemoSessionBodySchema.safeParse({ role: "admin" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "device" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", outlet_id: "sbx-1" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", sandbox_key: "short" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", sandbox_key: "A".repeat(44) }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", sandbox_key: "!".repeat(43) }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({}).success).toBe(false);
  });
});

describe("DemoSessionResponseSchema", () => {
  it("accepts the web and device shapes", () => {
    expect(
      DemoSessionResponseSchema.safeParse({ kind: "web", role: "owner", custom_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home" }).success,
    ).toBe(true);
    expect(
      DemoSessionResponseSchema.safeParse({ kind: "device", role: "staff", device_id: "jdg-1", device_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/capture" }).success,
    ).toBe(true);
  });

  it("rejects staff on the web shape, owner on the device shape, a wrong landing path and extra keys", () => {
    expect(DemoSessionResponseSchema.safeParse({ kind: "web", role: "staff", custom_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home" }).success).toBe(false);
    expect(DemoSessionResponseSchema.safeParse({ kind: "device", role: "owner", device_id: "j", device_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/capture" }).success).toBe(false);
    expect(DemoSessionResponseSchema.safeParse({ kind: "device", role: "staff", device_id: "j", device_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home" }).success).toBe(false);
    expect(DemoSessionResponseSchema.safeParse({ kind: "web", role: "owner", custom_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home", outlet_id: "sbx-1" }).success).toBe(false);
  });
});

// ── R-19 PR-0: contracts of the new demo routes (plan section 2.3). Types and schemas only. ──
const SID = "11111111-1111-4111-8111-111111111111";

describe("R-19 NextDayRefusal", () => {
  it("is exactly the eight plan codes", () => {
    expect([...NEXT_DAY_REFUSALS].sort()).toEqual(
      ["busy", "day_not_ended", "max_days", "preparing", "proposal_exists", "session_open", "shift_incomplete", "unanswered_questions"].sort(),
    );
    for (const code of NEXT_DAY_REFUSALS) expect(NextDayRefusalSchema.safeParse(code).success).toBe(true);
    expect(NextDayRefusalSchema.safeParse("nope").success).toBe(false);
  });
});

describe("R-19 POST /api/v1/demo/closing", () => {
  it("body: a strict { session_id: uuid }", () => {
    expect(DemoClosingBodySchema.safeParse({ session_id: SID }).success).toBe(true);
    expect(DemoClosingBodySchema.safeParse({ session_id: "x" }).success).toBe(false);
    expect(DemoClosingBodySchema.safeParse({}).success).toBe(false);
    expect(DemoClosingBodySchema.safeParse({ session_id: SID, outlet_id: "sbx-1" }).success).toBe(false);
  });
  it("200: exactly { closing_reached: true }", () => {
    expect(DemoClosingResponseSchema.safeParse({ closing_reached: true }).success).toBe(true);
    expect(DemoClosingResponseSchema.safeParse({ closing_reached: false }).success).toBe(false);
    expect(DemoClosingResponseSchema.safeParse({ closing_reached: true, x: 1 }).success).toBe(false);
  });
  it("409 error.code is one of the two closing refusals", () => {
    expect(ClosingRefusalSchema.safeParse("not_enough_speech").success).toBe(true);
    expect(ClosingRefusalSchema.safeParse("session_not_open").success).toBe(true);
    expect(ClosingRefusalSchema.safeParse("other").success).toBe(false);
  });
  it("409 error.details of not_enough_speech: strict { have >= 0, need >= 1 } counts", () => {
    expect(ClosingRefusalDetailsSchema.safeParse({ have: 3, need: 5 }).success).toBe(true);
    expect(ClosingRefusalDetailsSchema.safeParse({ have: 3 }).success).toBe(false);
    expect(ClosingRefusalDetailsSchema.safeParse({ have: -1, need: 5 }).success).toBe(false);
    expect(ClosingRefusalDetailsSchema.safeParse({ have: 0, need: 0 }).success).toBe(false);
    expect(ClosingRefusalDetailsSchema.safeParse({ have: 1, need: 5, text: "x" }).success).toBe(false);
  });
});

describe("R-19 POST /api/v1/demo/next-day", () => {
  it("body: expected_day 1 or 2 and a boolean confirm_unanswered, strict", () => {
    for (const expected_day of [1, 2]) {
      expect(DemoNextDayBodySchema.safeParse({ expected_day, confirm_unanswered: false }).success).toBe(true);
    }
    for (const expected_day of [0, 3, 1.5, "1"]) {
      expect(DemoNextDayBodySchema.safeParse({ expected_day, confirm_unanswered: false }).success).toBe(false);
    }
    expect(DemoNextDayBodySchema.safeParse({ expected_day: 1 }).success).toBe(false);
    expect(DemoNextDayBodySchema.safeParse({ expected_day: 1, confirm_unanswered: "yes" }).success).toBe(false);
    expect(DemoNextDayBodySchema.safeParse({ expected_day: 1, confirm_unanswered: true, outlet_id: "sbx-1" }).success).toBe(false);
  });
  it("200: { day: 2 | 3 }", () => {
    expect(DemoNextDayResponseSchema.safeParse({ day: 2 }).success).toBe(true);
    expect(DemoNextDayResponseSchema.safeParse({ day: 3 }).success).toBe(true);
    expect(DemoNextDayResponseSchema.safeParse({ day: 1 }).success).toBe(false);
    expect(DemoNextDayResponseSchema.safeParse({ day: 4 }).success).toBe(false);
  });
  it("409 error.details: { unanswered? } only; the code is a NextDayRefusal in error.code", () => {
    expect(NextDayRefusalDetailsSchema.safeParse({}).success).toBe(true);
    expect(NextDayRefusalDetailsSchema.safeParse({ unanswered: 2 }).success).toBe(true);
    expect(NextDayRefusalDetailsSchema.safeParse({ unanswered: -1 }).success).toBe(false);
    expect(NextDayRefusalDetailsSchema.safeParse({ code: "max_days" }).success).toBe(false);
    expect(NextDayRefusalDetailsSchema.safeParse({ unanswered: 1, extra: 1 }).success).toBe(false);
  });
});

describe("R-19 POST /api/v1/demo/process-now", () => {
  it("body is an empty strict object; response is { processed: int >= 0 }", () => {
    expect(DemoProcessNowBodySchema.safeParse({}).success).toBe(true);
    expect(DemoProcessNowBodySchema.safeParse({ device_id: "jdg-1" }).success).toBe(false);
    expect(DemoProcessNowResponseSchema.safeParse({ processed: 0 }).success).toBe(true);
    expect(DemoProcessNowResponseSchema.safeParse({ processed: -1 }).success).toBe(false);
    expect(DemoProcessNowResponseSchema.safeParse({ processed: 1.5 }).success).toBe(false);
    expect(DemoProcessNowResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("R-19 GET /api/v1/demo/progress", () => {
  const good = { day: 2, days_done: 1, proposals_with_content: 1, feasible: 0, owner_decided: 0 };
  it("accepts the five counters and refuses an out-of-range day, a negative, an extra key", () => {
    expect(DemoProgressResponseSchema.safeParse(good).success).toBe(true);
    expect(DemoProgressResponseSchema.safeParse({ ...good, day: 4 }).success).toBe(false);
    expect(DemoProgressResponseSchema.safeParse({ ...good, days_done: 4 }).success).toBe(false);
    expect(DemoProgressResponseSchema.safeParse({ ...good, feasible: -1 }).success).toBe(false);
    expect(DemoProgressResponseSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    const { owner_decided: _drop, ...partial } = good;
    expect(DemoProgressResponseSchema.safeParse(partial).success).toBe(false);
  });
});

describe("R-19 POST /api/v1/demo/reset", () => {
  it("body must be exactly { confirm: 'reset' }; response { reset: true }", () => {
    expect(DemoResetBodySchema.safeParse({ confirm: "reset" }).success).toBe(true);
    expect(DemoResetBodySchema.safeParse({ confirm: "RESET" }).success).toBe(false);
    expect(DemoResetBodySchema.safeParse({ confirm: true }).success).toBe(false);
    expect(DemoResetBodySchema.safeParse({}).success).toBe(false);
    expect(DemoResetBodySchema.safeParse({ confirm: "reset", outlet_id: "sbx-1" }).success).toBe(false);
    expect(DemoResetResponseSchema.safeParse({ reset: true }).success).toBe(true);
    expect(DemoResetResponseSchema.safeParse({ reset: false }).success).toBe(false);
  });
});
