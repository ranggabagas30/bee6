import { describe, expect, it } from "vitest";
import { isWithinOpeningHours, minutesOfDayInZone, mulaiWindowEnd } from "@/lib/capture/hours";

const JAKARTA = "Asia/Jakarta"; // UTC+7, no DST

describe("minutesOfDayInZone", () => {
  it("converts a UTC instant to local minutes-of-day", () => {
    // 2026-09-30T03:30:00Z → 10:30 in Jakarta (UTC+7).
    const d = new Date("2026-09-30T03:30:00Z");
    expect(minutesOfDayInZone(d, JAKARTA)).toBe(10 * 60 + 30);
  });
});

describe("isWithinOpeningHours", () => {
  const hours = {
    opening_time: "07:00",
    closing_time: "21:45",
    timezone: JAKARTA,
  };

  it("is active inside the window", () => {
    // 08:00 WIB = 01:00 UTC.
    expect(isWithinOpeningHours(new Date("2026-09-30T01:00:00Z"), hours)).toBe(
      true,
    );
  });

  it("is active exactly at opening (inclusive)", () => {
    // 07:00 WIB = 00:00 UTC.
    expect(isWithinOpeningHours(new Date("2026-09-30T00:00:00Z"), hours)).toBe(
      true,
    );
  });

  it("is inactive at and after closing (exclusive)", () => {
    // 21:45 WIB = 14:45 UTC.
    expect(isWithinOpeningHours(new Date("2026-09-30T14:45:00Z"), hours)).toBe(
      false,
    );
  });

  it("is inactive before opening", () => {
    // 06:00 WIB = 23:00 UTC previous day.
    expect(isWithinOpeningHours(new Date("2026-09-29T23:00:00Z"), hours)).toBe(
      false,
    );
  });

  it("handles a window that wraps past midnight", () => {
    const night = {
      opening_time: "20:00",
      closing_time: "02:00",
      timezone: JAKARTA,
    };
    // 23:00 WIB = 16:00 UTC → active.
    expect(isWithinOpeningHours(new Date("2026-09-30T16:00:00Z"), night)).toBe(
      true,
    );
    // 01:00 WIB = 18:00 UTC prev day → active.
    expect(isWithinOpeningHours(new Date("2026-09-29T18:00:00Z"), night)).toBe(
      true,
    );
    // 03:00 WIB = 20:00 UTC prev day → inactive.
    expect(isWithinOpeningHours(new Date("2026-09-29T20:00:00Z"), night)).toBe(
      false,
    );
  });

  it("treats an equal opening/closing as never active", () => {
    const zero = {
      opening_time: "09:00",
      closing_time: "09:00",
      timezone: JAKARTA,
    };
    expect(isWithinOpeningHours(new Date("2026-09-30T05:00:00Z"), zero)).toBe(
      false,
    );
  });
});

describe("mulaiWindowEnd", () => {
  it("is the closing time minus the 4 h minimum opening duration", () => {
    expect(mulaiWindowEnd("21:45")).toBe("17:45");
    expect(mulaiWindowEnd("09:30")).toBe("05:30");
  });

  it("wraps past midnight for a close after 01:00", () => {
    expect(mulaiWindowEnd("01:00")).toBe("21:00");
    expect(mulaiWindowEnd("02:00")).toBe("22:00");
  });
});
