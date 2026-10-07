import { describe, expect, it } from "vitest";
import { offHoursBanner } from "@/app/capture/off-hours-banner";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

// Asia/Jakarta is UTC+7 with no DST. Monday 2026-10-12 is an open day (08:00-22:00).
const CONFIG: CaptureConfigResponse = {
  timezone: "Asia/Jakarta",
  weekly_hours: {
    sun: null,
    mon: { open: "08:00", close: "22:00" },
    tue: { open: "08:00", close: "22:00" },
    wed: { open: "08:00", close: "22:00" },
    thu: { open: "08:00", close: "22:00" },
    fri: { open: "08:00", close: "22:00" },
    sat: { open: "08:00", close: "22:00" },
  },
  last_ended: null,
};

const MON_2330_JKT = Date.UTC(2026, 9, 12, 16, 30); // 23:30 Monday, after the 18:00 Start cut-off
const SUN_1200_JKT = Date.UTC(2026, 9, 11, 5, 0); // 12:00 Sunday, a closed day

describe("offHoursBanner: the status banner outside opening hours (UX-03 5.2)", () => {
  it("after a time-based close with no session today: Not started and the window-passed Mulai note", () => {
    expect(
      offHoursBanner({ config: CONFIG, nowMs: MON_2330_JKT, autoStoppedOn: null, lang: "en" }),
    ).toEqual({
      state: "idle",
      note: "The Start cut-off today passed at 18:00. Today is recorded as a day off. Next Start Tue 13 Oct at 01:00.",
    });
  });

  it("the same moment in ID is Bahasa only", () => {
    expect(
      offHoursBanner({ config: CONFIG, nowMs: MON_2330_JKT, autoStoppedOn: null, lang: "id" }),
    ).toEqual({
      state: "idle",
      note: "Batas Mulai hari ini sudah lewat pukul 18:00. Hari ini dicatat libur. Mulai lagi Sel 13 Okt pukul 01:00.",
    });
  });

  it("a closed day shows the closed Mulai note with the next start day", () => {
    expect(
      offHoursBanner({ config: CONFIG, nowMs: SUN_1200_JKT, autoStoppedOn: null, lang: "en" }),
    ).toEqual({ state: "idle", note: "Closed today. Next Start Mon 12 Oct at 01:00." });
  });

  it("a session that auto-stopped today (this page saw it stop) is Ended automatically, never Not started", () => {
    expect(
      offHoursBanner({ config: CONFIG, nowMs: MON_2330_JKT, autoStoppedOn: "2026-10-12", lang: "en" }),
    ).toEqual({ state: "ended_auto", endedAt: "23:00" });
  });

  it("a session that auto-stopped today (server last_ended, after a reload) is Ended automatically", () => {
    const config = {
      ...CONFIG,
      last_ended: { business_date: "2026-10-12", end_reason: "auto_stop" as const, debrief_ends_at_ms: null },
    };
    expect(
      offHoursBanner({ config, nowMs: MON_2330_JKT, autoStoppedOn: null, lang: "id" }),
    ).toEqual({ state: "ended_auto", endedAt: "23:00" });
  });

  it("an auto-stop from an earlier day is not today: Not started again", () => {
    const config = {
      ...CONFIG,
      last_ended: { business_date: "2026-10-11", end_reason: "auto_stop" as const, debrief_ends_at_ms: null },
    };
    expect(
      offHoursBanner({ config, nowMs: MON_2330_JKT, autoStoppedOn: "2026-10-11", lang: "en" }).state,
    ).toBe("idle");
  });
});
