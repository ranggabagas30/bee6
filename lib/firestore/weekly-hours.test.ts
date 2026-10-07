import { describe, expect, it } from "vitest";
import {
  DayHoursSchema,
  WeeklyHoursSchema,
  noStopPastNextOpen,
  type WeeklyHours,
} from "@/lib/firestore/schema";

const day = (open: string, close: string) => ({ open, close });
const everyDay = (h: { open: string; close: string } | null) => ({
  mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h,
});

describe("DayHoursSchema refines (PROD-01 §3.1, §4.0)", () => {
  it("accepts the test outlet 09:30-01:00", () => {
    expect(DayHoursSchema.safeParse(day("09:30", "01:00")).success).toBe(true);
  });

  it("accepts 08:00-22:00", () => {
    expect(DayHoursSchema.safeParse(day("08:00", "22:00")).success).toBe(true);
  });

  it("rejects a zero-length day", () => {
    expect(DayHoursSchema.safeParse(day("08:00", "08:00")).success).toBe(false);
  });

  it("rejects close at 01:30 the next day (refine 2)", () => {
    expect(DayHoursSchema.safeParse(day("09:30", "01:30")).success).toBe(false);
  });

  it("rejects opening before 01:00 (refine 1)", () => {
    expect(DayHoursSchema.safeParse(day("00:30", "09:30")).success).toBe(false);
  });

  it("rejects an opening that is less than 4 h before close (refine 3)", () => {
    expect(DayHoursSchema.safeParse(day("20:00", "23:00")).success).toBe(false);
  });

  it("rejects a window that ends by 03:00 (refine 4)", () => {
    expect(DayHoursSchema.safeParse(day("03:00", "06:30")).success).toBe(false);
  });

  it("rejects extra keys (strict)", () => {
    expect(
      DayHoursSchema.safeParse({ ...day("09:30", "01:00"), name: "x" }).success,
    ).toBe(false);
  });
});

describe("WeeklyHoursSchema", () => {
  it("accepts 09:30-01:00 every day", () => {
    const w = everyDay(day("09:30", "01:00"));
    expect(WeeklyHoursSchema.safeParse(w).success).toBe(true);
  });

  it("accepts a closed weekday (null) when another weekday is open", () => {
    const w = { ...everyDay(day("09:30", "01:00")), thu: null };
    expect(WeeklyHoursSchema.safeParse(w).success).toBe(true);
  });

  it("rejects a week with every weekday closed", () => {
    expect(WeeklyHoursSchema.safeParse(everyDay(null)).success).toBe(false);
  });

  it("rejects a missing weekday key", () => {
    const { sun: _sun, ...rest } = everyDay(day("09:30", "01:00"));
    expect(WeeklyHoursSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a day whose auto-stop passes the next opening", () => {
    // Mon closes 01:00 -> auto-stop Tue 02:00; Tue opens 01:30 -> conflict.
    const w = {
      ...everyDay(null),
      mon: day("09:30", "01:00"),
      tue: day("01:30", "13:30"),
    };
    expect(WeeklyHoursSchema.safeParse(w).success).toBe(false);
  });

  it("accepts an auto-stop that ends before the next opening", () => {
    const w = {
      ...everyDay(null),
      mon: day("09:30", "01:00"),
      tue: day("02:00", "14:00"),
    };
    expect(WeeklyHoursSchema.safeParse(w).success).toBe(true);
  });
});

describe("noStopPastNextOpen", () => {
  it("passes when the next day is closed", () => {
    const w: WeeklyHours = {
      ...everyDay(null),
      mon: day("09:30", "01:00"),
    };
    expect(noStopPastNextOpen(w)).toBe(true);
  });

  it("does not check days with no stop past midnight", () => {
    const w: WeeklyHours = everyDay(day("08:00", "22:00"));
    expect(noStopPastNextOpen(w)).toBe(true);
  });
});
