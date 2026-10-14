import { describe, expect, it } from "vitest";
import { autoStopDeadline, demoMulaiAvailability, selesaiReady } from "@/lib/capture/demo-session";
import { FRESH_DEMO_SESSION } from "@/lib/capture/contract";
import { DEMO_SESSION_MAX_MS } from "@/lib/demo/constants";
import { autoStopAtMs, mulaiAvailability } from "@/lib/capture/calendar";
import type { WeeklyHours } from "@/lib/firestore/schema";

const TZ = "Asia/Jakarta";
const day = { open: "07:00", close: "21:45" };
const weekly: WeeklyHours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
const wib = (iso: string) => Date.parse(`${iso}+07:00`);
const NIGHT = wib("2026-10-14T22:30:00"); // past the pilot's Mulai window (17:45)
const NOON = wib("2026-10-14T12:00:00");

describe("demoMulaiAvailability (R-18: sandbox only)", () => {
  it("offers Mulai at 22:30 WIB where the pilot rules say window_passed", () => {
    const pilot = mulaiAvailability({ now_ms: NIGHT, weekly, tz: TZ, session_open: false, last_ended: null });
    expect(pilot.reason).toBe("window_passed");
    expect(demoMulaiAvailability({ now_ms: NIGHT, tz: TZ, session_open: false, last_ended: null })).toEqual({
      offered: true,
      reason: "offered",
      business_date: "2026-10-14",
      next_offer_ms: null,
    });
  });

  it("is offered on a closed weekday too (no window, no closed day)", () => {
    const sunday = wib("2026-10-18T12:00:00");
    expect(demoMulaiAvailability({ now_ms: sunday, tz: TZ, session_open: false, last_ended: null }).offered).toBe(true);
  });

  it("is not offered while a session is open", () => {
    expect(demoMulaiAvailability({ now_ms: NOON, tz: TZ, session_open: true, last_ended: null })).toMatchObject({
      offered: false,
      reason: "session_open",
    });
  });

  it("the template's last day (yesterday) does not block today", () => {
    const last = { business_date: "2026-10-13", end_reason: "selesai" as const, debrief_ends_at_ms: wib("2026-10-13T23:45:00") };
    expect(demoMulaiAvailability({ now_ms: NOON, tz: TZ, session_open: false, last_ended: last }).offered).toBe(true);
  });

  it("one demo day per sandbox: a finished day today is day_ended, even while its debrief runs", () => {
    for (const end_reason of ["selesai", "auto_stop", "lost"] as const) {
      const last = { business_date: "2026-10-14", end_reason, debrief_ends_at_ms: NOON + 1_800_000 };
      expect(demoMulaiAvailability({ now_ms: NOON, tz: TZ, session_open: false, last_ended: last })).toMatchObject({
        offered: false,
        reason: "day_ended",
      });
    }
  });

  it("a discarded session leaves Mulai offered again (the retake path)", () => {
    const last = { business_date: "2026-10-14", end_reason: "discarded" as const, debrief_ends_at_ms: null };
    expect(demoMulaiAvailability({ now_ms: NOON, tz: TZ, session_open: false, last_ended: last }).offered).toBe(true);
  });

  it("a debrief of an earlier business date that is still running blocks Mulai", () => {
    const last = { business_date: "2026-10-13", end_reason: "selesai" as const, debrief_ends_at_ms: NOON + 60_000 };
    expect(demoMulaiAvailability({ now_ms: NOON, tz: TZ, session_open: false, last_ended: last })).toMatchObject({
      offered: false,
      reason: "debrief_running",
    });
  });
});

describe("autoStopDeadline", () => {
  const started = NIGHT;
  it("pilot (no max): exactly the close + 1 h rule, unchanged", () => {
    expect(autoStopDeadline({ localDate: "2026-10-14", startedAtMs: NOON, weekly, tz: TZ })).toBe(
      autoStopAtMs("2026-10-14", weekly, TZ),
    );
  });
  it("pilot on a closed weekday: null as before", () => {
    const closed: WeeklyHours = { ...weekly, wed: null };
    expect(autoStopDeadline({ localDate: "2026-10-14", startedAtMs: NOON, weekly: closed, tz: TZ })).toBeNull();
  });
  it("profile: start + max_ms when that is earlier than close + 1 h", () => {
    expect(autoStopDeadline({ localDate: "2026-10-14", startedAtMs: NOON, weekly, tz: TZ, maxMs: DEMO_SESSION_MAX_MS })).toBe(NOON + DEMO_SESSION_MAX_MS);
  });
  it("profile: start + max_ms even when close + 1 h comes first (the server uses start + max_ms only)", () => {
    const late = wib("2026-10-14T22:44:00");
    expect(autoStopDeadline({ localDate: "2026-10-14", startedAtMs: late, weekly, tz: TZ, maxMs: DEMO_SESSION_MAX_MS })).toBe(
      late + DEMO_SESSION_MAX_MS,
    );
  });
  it("profile: a start after close + 1 h (23:10, or 00:30 while local_date is still yesterday) is never already past", () => {
    const after = wib("2026-10-14T23:10:00");
    const deadline = autoStopDeadline({ localDate: "2026-10-14", startedAtMs: after, weekly, tz: TZ, maxMs: DEMO_SESSION_MAX_MS });
    expect(deadline).toBe(after + DEMO_SESSION_MAX_MS);
    expect(deadline!).toBeGreaterThan(after);
  });
  it("profile on a closed weekday: start + max_ms", () => {
    const closed: WeeklyHours = { ...weekly, wed: null };
    expect(autoStopDeadline({ localDate: "2026-10-14", startedAtMs: started, weekly: closed, tz: TZ, maxMs: DEMO_SESSION_MAX_MS })).toBe(
      started + DEMO_SESSION_MAX_MS,
    );
  });
});

describe("selesaiReady", () => {
  it("true with the profile, false without (the pilot waits for min(start + 4 h, close))", () => {
    expect(selesaiReady(FRESH_DEMO_SESSION)).toBe(true);
    expect(selesaiReady(undefined)).toBe(false);
  });
});
