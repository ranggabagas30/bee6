import { describe, expect, it } from "vitest";
import { weekdayOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { dayStatus } from "@/lib/day/day-status";
import type { AttributionSession } from "@/lib/day/attribution";
import type { WeeklyHours } from "@/lib/firestore/schema";

const JKT = "Asia/Jakarta";

const day = (open: string, close: string) => ({ open, close });
const everyDay = (h: { open: string; close: string } | null): WeeklyHours => ({
  mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h,
});
/** Test outlet: 09:30-01:00 every day (W = 01:00-21:00, auto-stop 02:00 D+1). */
const TEST_OUTLET = everyDay(day("09:30", "01:00"));

const WED = "2026-10-07";
const THU = "2026-10-08";

function closedOn(d: string): WeeklyHours {
  return { ...TEST_OUTLET, [weekdayOf(d)]: null };
}

function at(d: string, hm: string): number {
  return zonedTimeToEpochMs(d, hm, JKT);
}

function session(input: {
  device_id?: string;
  local_date: string;
  started_at_ms?: number;
  ended_at_ms?: number | null;
  auto_stop_at_ms?: number;
  end_reason: AttributionSession["end_reason"];
}): AttributionSession {
  return {
    device_id: input.device_id ?? "d1",
    local_date: input.local_date,
    started_at_ms: input.started_at_ms ?? at(input.local_date, "10:00"),
    ended_at_ms: input.ended_at_ms ?? null,
    auto_stop_at_ms: input.auto_stop_at_ms ?? at(input.local_date, "10:00") + 3_600_000,
    end_reason: input.end_reason,
  };
}

describe("dayStatus (technical spec §8.15)", () => {
  it("a closed weekday is closed even with a stale session dated to it", () => {
    const s = session({ local_date: WED, end_reason: null });
    expect(dayStatus(WED, closedOn(WED), JKT, [s], at(WED, "15:00"))).toBe("closed");
  });

  it("a selesai (or still-open) session for the day is on", () => {
    const s = session({ local_date: WED, end_reason: "selesai" });
    expect(dayStatus(WED, TEST_OUTLET, JKT, [s], at(WED, "15:00"))).toBe("on");

    const open = session({ local_date: WED, end_reason: null });
    expect(dayStatus(WED, TEST_OUTLET, JKT, [open], at(WED, "15:00"))).toBe("on");
  });

  it("only a discarded session for the day is off, even before the Mulai window ends", () => {
    const s = session({ local_date: WED, end_reason: "discarded" });
    expect(dayStatus(WED, TEST_OUTLET, JKT, [s], at(WED, "15:00"))).toBe("off");
  });

  it("no session and the Mulai window has passed is off", () => {
    expect(dayStatus(WED, TEST_OUTLET, JKT, [], at(WED, "22:00"))).toBe("off");
  });

  it("no session and the Mulai window is still open is pending", () => {
    expect(dayStatus(WED, TEST_OUTLET, JKT, [], at(WED, "15:00"))).toBe("pending");
  });

  it("a session dated D+1 does not make D on", () => {
    const s = session({ local_date: THU, end_reason: null });
    expect(dayStatus(WED, TEST_OUTLET, JKT, [s], at(WED, "15:00"))).toBe("pending");
  });
});
