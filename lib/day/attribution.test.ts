import { describe, expect, it } from "vitest";
import { addDays, autoStopAtMs, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { attributedBusinessDate, sessionInterval, type AttributionSession } from "@/lib/day/attribution";
import type { WeeklyHours } from "@/lib/firestore/schema";

const JKT = "Asia/Jakarta";

const day = (open: string, close: string) => ({ open, close });
const everyDay = (h: { open: string; close: string } | null): WeeklyHours => ({
  mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h,
});
/** Test outlet: 09:30-01:00 every day (W = 01:00-21:00, auto-stop 02:00 D+1). */
const TEST_OUTLET = everyDay(day("09:30", "01:00"));

/** Three consecutive business dates; the actual weekday name is irrelevant
 * here (the test outlet is open every day the same way) — labelled Tue/Wed/Thu
 * to match the plan's grid. */
const MON = "2026-10-05";
const TUE = "2026-10-06";
const WED = "2026-10-07";
const THU = "2026-10-08";

function at(d: string, hm: string): number {
  return zonedTimeToEpochMs(d, hm, JKT);
}

function autoStopOf(d: string): number {
  return autoStopAtMs(d, TEST_OUTLET, JKT)!;
}

function session(input: {
  device_id: string;
  local_date: string;
  started_at_ms: number;
  ended_at_ms?: number | null;
  auto_stop_at_ms?: number;
  end_reason?: AttributionSession["end_reason"];
}): AttributionSession {
  return {
    device_id: input.device_id,
    local_date: input.local_date,
    started_at_ms: input.started_at_ms,
    ended_at_ms: input.ended_at_ms ?? null,
    auto_stop_at_ms: input.auto_stop_at_ms ?? autoStopOf(input.local_date),
    end_reason: input.end_reason ?? null,
  };
}

describe("sessionInterval", () => {
  it("an open session ends at auto_stop_at_ms", () => {
    const s = session({ device_id: "d1", local_date: WED, started_at_ms: at(WED, "10:00") });
    expect(sessionInterval(s)).toEqual({ start_ms: at(WED, "10:00"), end_ms: autoStopOf(WED) });
  });

  it("a session ended before auto-stop ends at ended_at_ms", () => {
    const s = session({
      device_id: "d1",
      local_date: WED,
      started_at_ms: at(WED, "10:00"),
      ended_at_ms: at(WED, "12:00"),
      end_reason: "selesai",
    });
    expect(sessionInterval(s)).toEqual({ start_ms: at(WED, "10:00"), end_ms: at(WED, "12:00") });
  });

  it("a session ended after auto-stop (recovery) is clamped to auto_stop_at_ms", () => {
    const s = session({
      device_id: "d1",
      local_date: WED,
      started_at_ms: at(WED, "10:00"),
      ended_at_ms: autoStopOf(WED) + 3_600_000, // recovered hours after the planned auto-stop
      end_reason: "lost",
    });
    expect(sessionInterval(s)).toEqual({ start_ms: at(WED, "10:00"), end_ms: autoStopOf(WED) });
  });
});

describe("attributedBusinessDate — attribution grid (technical spec §8.4)", () => {
  it("Tue 00:59, no sessions -> Mon (before 01:00 shifts back a day)", () => {
    expect(attributedBusinessDate(at(TUE, "00:59"), [], JKT)).toBe(MON);
  });

  it("Tue 01:00, no sessions -> Tue (at the boundary, no shift)", () => {
    expect(attributedBusinessDate(at(TUE, "01:00"), [], JKT)).toBe(TUE);
  });

  it("Thu 01:30 inside Wed's open session (started Wed 10:00) -> Wed", () => {
    const s = session({ device_id: "d1", local_date: WED, started_at_ms: at(WED, "10:00") });
    expect(attributedBusinessDate(at(THU, "01:30"), [s], JKT)).toBe(WED);
  });

  it("Thu 02:00 exactly (= Wed's auto-stop instant) -> Thu (end is exclusive)", () => {
    const s = session({ device_id: "d1", local_date: WED, started_at_ms: at(WED, "10:00") });
    expect(attributedBusinessDate(autoStopOf(WED), [s], JKT)).toBe(THU);
  });

  it("Thu 01:30, Wed off, a session started exactly Thu 01:30 -> Thu", () => {
    const s = session({ device_id: "d1", local_date: THU, started_at_ms: at(THU, "01:30") });
    expect(attributedBusinessDate(at(THU, "01:30"), [s], JKT)).toBe(THU);
  });

  it("Wed 12:00 inside a discarded Wed session -> null", () => {
    const s = session({
      device_id: "d1",
      local_date: WED,
      started_at_ms: at(WED, "09:00"),
      ended_at_ms: at(WED, "13:00"),
      end_reason: "discarded",
    });
    expect(attributedBusinessDate(at(WED, "12:00"), [s], JKT)).toBeNull();
  });

  it("Wed 12:05, a discarded session that ended at 12:00 -> Wed (outside the discarded interval)", () => {
    const s = session({
      device_id: "d1",
      local_date: WED,
      started_at_ms: at(WED, "09:00"),
      ended_at_ms: at(WED, "12:00"),
      end_reason: "discarded",
    });
    expect(attributedBusinessDate(at(WED, "12:05"), [s], JKT)).toBe(WED);
  });

  it("two overlapping sessions of one device, line at Wed 11:30 -> the earliest session's date", () => {
    const earlier = session({ device_id: "d1", local_date: WED, started_at_ms: at(WED, "10:00") });
    const stale = session({ device_id: "d1", local_date: WED, started_at_ms: at(WED, "11:00") });
    expect(attributedBusinessDate(at(WED, "11:30"), [stale, earlier], JKT)).toBe(WED);
  });

  it("device A line Thu 01:30; only device B has a Wed session covering it -> Wed (other devices checked when A has none)", () => {
    const b = session({ device_id: "devB", local_date: WED, started_at_ms: at(WED, "10:00") });
    expect(attributedBusinessDate(at(THU, "01:30"), [b], JKT, "devA")).toBe(WED);
  });

  it("device A line Thu 01:30; A has a Thu session started 01:15 and B a Wed session -> Thu (own device first)", () => {
    const a = session({ device_id: "devA", local_date: THU, started_at_ms: at(THU, "01:15") });
    const b = session({ device_id: "devB", local_date: WED, started_at_ms: at(WED, "10:00") });
    expect(attributedBusinessDate(at(THU, "01:30"), [a, b], JKT, "devA")).toBe(THU);
  });

  it("device A line Wed 12:00; A has no session; B's discarded session covers it -> null (literal §8.4 reading)", () => {
    const b = session({
      device_id: "devB",
      local_date: WED,
      started_at_ms: at(WED, "09:00"),
      ended_at_ms: at(WED, "13:00"),
      end_reason: "discarded",
    });
    expect(attributedBusinessDate(at(WED, "12:00"), [b], JKT, "devA")).toBeNull();
  });
});
