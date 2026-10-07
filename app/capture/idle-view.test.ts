import { describe, expect, it } from "vitest";
import { idleViewFor } from "@/app/capture/idle-view";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

// Asia/Jakarta is UTC+7, no DST. Monday 2026-10-12 to Sunday are all 08:00-22:00
// except Sunday, which is closed. Mulai window: 01:00-18:00 (close - 4h).
const day = { open: "08:00", close: "22:00" };
const CONFIG: CaptureConfigResponse = {
  timezone: "Asia/Jakarta",
  weekly_hours: { sun: null, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day },
  last_ended: null,
};

const MON_0200_JKT = Date.UTC(2026, 9, 11, 19, 0); // Mon 02:00 WIB (inside window)
const MON_2330_JKT = Date.UTC(2026, 9, 12, 16, 30); // Mon 23:30 WIB (window passed)
const SUN_1200_JKT = Date.UTC(2026, 9, 11, 5, 0); // Sun 12:00 WIB (closed day)

describe("idleViewFor: the Mulai button's headline and note (UX-03 5.4)", () => {
  it("offered: idle headline, Mulai enabled, no note", () => {
    expect(idleViewFor({ config: CONFIG, nowMs: MON_0200_JKT, lang: "en" })).toEqual({
      headline: "idle",
      offered: true,
      note: null,
      endedAt: null,
    });
  });

  it("window_passed: idle headline, Mulai disabled, the window-passed note", () => {
    expect(idleViewFor({ config: CONFIG, nowMs: MON_2330_JKT, lang: "en" })).toEqual({
      headline: "idle",
      offered: false,
      note: "The Start cut-off today passed at 18:00. Today is recorded as a day off. Next Start Tue 13 Oct at 01:00.",
      endedAt: null,
    });
  });

  it("closed_day: idle headline, Mulai disabled, the closed note", () => {
    expect(idleViewFor({ config: CONFIG, nowMs: SUN_1200_JKT, lang: "en" })).toEqual({
      headline: "idle",
      offered: false,
      note: "Closed today. Next Start Mon 12 Oct at 01:00.",
      endedAt: null,
    });
  });

  it("day_ended after a manual Selesai: Ended headline (no time), the day_ended note", () => {
    const config: CaptureConfigResponse = {
      ...CONFIG,
      last_ended: { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: null },
    };
    // Mon 23:30 WIB, debrief already over (debrief_ends_at_ms null means not running)
    expect(idleViewFor({ config, nowMs: MON_2330_JKT, lang: "en" })).toEqual({
      headline: "ended",
      offered: false,
      note: "The business day Mon 12 Oct has ended. You can tap Start again Tue 13 Oct at 01:00.",
      endedAt: null,
    });
  });

  it("day_ended after the auto-stop: Ended automatically headline with the stop time", () => {
    const config: CaptureConfigResponse = {
      ...CONFIG,
      last_ended: { business_date: "2026-10-12", end_reason: "auto_stop", debrief_ends_at_ms: null },
    };
    expect(idleViewFor({ config, nowMs: MON_2330_JKT, lang: "en" })).toEqual({
      headline: "ended_auto",
      offered: false,
      note: "The business day Mon 12 Oct has ended. You can tap Start again Tue 13 Oct at 01:00.",
      endedAt: "23:00", // close(Mon) 22:00 + 1h auto-stop
    });
  });

  it("day_ended after a cancel: Session cancelled headline, no time", () => {
    const config: CaptureConfigResponse = {
      ...CONFIG,
      last_ended: { business_date: "2026-10-12", end_reason: "discarded", debrief_ends_at_ms: null },
    };
    expect(idleViewFor({ config, nowMs: MON_2330_JKT, lang: "en" })).toEqual({
      headline: "discarded",
      offered: false,
      note: "The business day Mon 12 Oct has ended. You can tap Start again Tue 13 Oct at 01:00.",
      endedAt: null,
    });
  });

  it("debrief_running: Ended headline, the debrief note naming when it ends and the next Mulai", () => {
    const config: CaptureConfigResponse = {
      ...CONFIG,
      last_ended: {
        business_date: "2026-10-11", // yesterday (Sunday is closed, so this is Sat)
        end_reason: "selesai",
        debrief_ends_at_ms: Date.UTC(2026, 9, 11, 19, 30), // Mon 02:30 WIB
      },
    };
    expect(idleViewFor({ config, nowMs: MON_0200_JKT, lang: "en" })).toEqual({
      headline: "ended",
      offered: false,
      note: "The debrief runs until 02:30. You can tap Start again Mon 12 Oct at 02:30.",
      endedAt: null,
    });
  });

  it("is Bahasa only in ID (window_passed)", () => {
    const { note } = idleViewFor({ config: CONFIG, nowMs: MON_2330_JKT, lang: "id" });
    expect(note).toBe(
      "Batas Mulai hari ini sudah lewat pukul 18:00. Hari ini dicatat libur. Mulai lagi Sel 13 Okt pukul 01:00.",
    );
  });
});
