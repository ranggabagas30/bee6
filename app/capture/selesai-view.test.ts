import { describe, expect, it } from "vitest";
import { selesaiViewFor } from "@/app/capture/selesai-view";
import type { WeeklyHours } from "@/lib/firestore/schema";

// Asia/Jakarta, UTC+7, no DST. Mon 2026-10-12 08:00-22:00.
const day = { open: "08:00", close: "22:00" };
const weekly: WeeklyHours = { sun: null, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day };
const tz = "Asia/Jakarta";

const STARTED = Date.UTC(2026, 9, 12, 3, 0); // Mon 10:00 WIB
const session = { started_at_ms: STARTED, local_date: "2026-10-12" };

describe("selesaiViewFor: the Selesai button appears at start + 4h (technical spec §8.3 rule 4)", () => {
  it("before the threshold: not ready, the 'from HH:MM' note", () => {
    const beforeMs = STARTED + 3 * 60 * 60_000; // +3h, Mon 13:00 WIB
    expect(selesaiViewFor({ nowMs: beforeMs, session, weekly, tz, lang: "en" })).toEqual({
      ready: false,
      note: "You can tap End from 14:00.",
    });
  });

  it("exactly at the threshold: ready, no note", () => {
    const atMs = STARTED + 4 * 60 * 60_000; // +4h, Mon 14:00 WIB
    expect(selesaiViewFor({ nowMs: atMs, session, weekly, tz, lang: "en" })).toEqual({
      ready: true,
      note: null,
    });
  });

  it("after the threshold: still ready", () => {
    const afterMs = STARTED + 5 * 60 * 60_000;
    expect(selesaiViewFor({ nowMs: afterMs, session, weekly, tz, lang: "en" }).ready).toBe(true);
  });

  it("the threshold is capped at close(D): a very late start shows End available at close", () => {
    // Started Mon 20:00 WIB; start+4h would be Tue 00:00, but close(Mon) is 22:00.
    const lateStart = Date.UTC(2026, 9, 12, 13, 0); // Mon 20:00 WIB
    const lateSession = { started_at_ms: lateStart, local_date: "2026-10-12" };
    const beforeClose = lateStart + 60 * 60_000; // Mon 21:00 WIB
    expect(
      selesaiViewFor({ nowMs: beforeClose, session: lateSession, weekly, tz, lang: "en" }),
    ).toEqual({ ready: false, note: "You can tap End from 22:00." });
  });

  it("is Bahasa only in ID", () => {
    const beforeMs = STARTED + 60 * 60_000;
    expect(selesaiViewFor({ nowMs: beforeMs, session, weekly, tz, lang: "id" })).toEqual({
      ready: false,
      note: "Selesai bisa ditekan mulai pukul 14:00.",
    });
  });
});

describe("selesaiViewFor with the R-18 demo profile", () => {
  it("is ready at the first second of the session (the pilot waits 4 h)", () => {
    expect(selesaiViewFor({ nowMs: STARTED, session, weekly, tz, lang: "en", demo: true })).toEqual({ ready: true, note: null });
    expect(selesaiViewFor({ nowMs: STARTED, session, weekly, tz, lang: "en" }).ready).toBe(false);
    expect(selesaiViewFor({ nowMs: STARTED, session, weekly, tz, lang: "en", demo: false }).ready).toBe(false);
  });
});

