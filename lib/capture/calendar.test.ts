import { describe, expect, it } from "vitest";
import type { WeeklyHours } from "@/lib/firestore/schema";
import {
  AUTO_STOP_AFTER_CLOSE_MS,
  MULAI_CUTOFF_BEFORE_CLOSE_MS,
  SELESAI_AFTER_START_MS,
  addDays,
  autoStopAtMs,
  businessDateOf,
  closeMs,
  evaluateCheckpoint,
  localDateOf,
  localHmOf,
  mulaiAvailability,
  mulaiWindowDateOf,
  mulaiWindowFor,
  nextOpenDay,
  plannedIntervalFor,
  selesaiFromMs,
  weekdayOf,
  zonedTimeToEpochMs,
} from "@/lib/capture/calendar";

const JKT = "Asia/Jakarta";
const NY = "America/New_York";

/** ISO instant helper: local wall time in Jakarta (+07:00). */
function wib(iso: string): number {
  return Date.parse(`${iso}+07:00`);
}

const day = (open: string, close: string) => ({ open, close });
const everyDay = (h: { open: string; close: string } | null): WeeklyHours => ({
  mon: h, tue: h, wed: h, thu: h, fri: h, sat: h, sun: h,
});
/** Test outlet: 09:30-01:00 every day (W = 01:00-21:00, auto-stop 02:00). */
const TEST_OUTLET = everyDay(day("09:30", "01:00"));
/** 22:00 outlet: open 08:00, close 22:00 every day (W = 01:00-18:00, auto-stop 23:00). */
const OUTLET_22 = everyDay(day("08:00", "22:00"));

describe("nextOpenDay (phone copy on a closed day, shows the next open day's hours)", () => {
  // Mon open 07:00-21:00, every other day closed except Wed 08:00-22:00.
  const weekly: WeeklyHours = {
    ...everyDay(null),
    mon: day("07:00", "21:00"),
    wed: day("08:00", "22:00"),
  };

  it("returns the business date itself when that day is open", () => {
    expect(nextOpenDay("2026-09-30", weekly)).toEqual({
      local_date: "2026-09-30",
      hours: day("08:00", "22:00"),
    });
  });

  it("skips closed days forward to the next open weekday", () => {
    // 2026-10-01 is a Thursday (closed); the next open day is Mon 2026-10-05.
    expect(nextOpenDay("2026-10-01", weekly)).toEqual({
      local_date: "2026-10-05",
      hours: day("07:00", "21:00"),
    });
  });

  it("returns null when no weekday is open within 7 days", () => {
    expect(nextOpenDay("2026-10-01", everyDay(null))).toBeNull();
  });
});

describe("zonedTimeToEpochMs", () => {
  it("converts Asia/Jakarta wall time (UTC+7)", () => {
    expect(zonedTimeToEpochMs("2026-10-14", "10:00", JKT)).toBe(wib("2026-10-14T10:00:00"));
  });

  it("handles a New York DST-change date (EDT, UTC-4, after 2 am on 2026-03-08)", () => {
    // 2026-03-08 03:30 local is EDT (UTC-4) -> 07:30Z
    expect(zonedTimeToEpochMs("2026-03-08", "03:30", NY)).toBe(Date.parse("2026-03-08T07:30:00Z"));
    // 2026-03-08 01:30 local is EST (UTC-5) -> 06:30Z
    expect(zonedTimeToEpochMs("2026-03-08", "01:30", NY)).toBe(Date.parse("2026-03-08T06:30:00Z"));
  });
});

describe("date helpers", () => {
  it("localDateOf uses the zone, not UTC", () => {
    // 2026-10-13T20:00Z is 2026-10-14 03:00 in Jakarta
    expect(localDateOf(Date.parse("2026-10-13T20:00:00Z"), JKT)).toBe("2026-10-14");
  });

  it("weekdayOf and addDays work across month and year ends", () => {
    expect(weekdayOf("2026-10-14")).toBe("wed");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("localHmOf formats 24h zero-padded wall-clock time in the zone (R-07)", () => {
    expect(localHmOf(Date.UTC(2026, 9, 7, 19, 5), JKT)).toBe("02:05");
  });

  it("localHmOf zero-pads single-digit hours and minutes", () => {
    expect(localHmOf(Date.UTC(2026, 9, 7, 0, 30), JKT)).toBe("07:30");
  });
});

describe("businessDateOf (01:00 clock boundary, PROD-01 4.10)", () => {
  it("is the previous date before 01:00 and the same date from 01:00", () => {
    expect(businessDateOf(wib("2026-10-14T23:30:00"), JKT)).toBe("2026-10-14");
    expect(businessDateOf(wib("2026-10-15T00:30:00"), JKT)).toBe("2026-10-14");
    expect(businessDateOf(wib("2026-10-15T00:59:00"), JKT)).toBe("2026-10-14");
    expect(businessDateOf(wib("2026-10-15T01:00:00"), JKT)).toBe("2026-10-15");
    expect(businessDateOf(wib("2026-10-15T01:30:00"), JKT)).toBe("2026-10-15");
  });
});

describe("closeMs / mulaiWindowFor / autoStopAtMs (test outlet 09:30-01:00)", () => {
  it("close is the next day's 01:00 and auto-stop is 02:00", () => {
    expect(closeMs("2026-10-14", TEST_OUTLET, JKT)).toBe(wib("2026-10-15T01:00:00"));
    expect(autoStopAtMs("2026-10-14", TEST_OUTLET, JKT)).toBe(wib("2026-10-15T02:00:00"));
    expect(AUTO_STOP_AFTER_CLOSE_MS).toBe(60 * 60_000);
  });

  it("window is 01:00 to close - 4 h (21:00), both ends inclusive", () => {
    const w = mulaiWindowFor("2026-10-14", TEST_OUTLET, JKT);
    expect(w).toEqual({
      business_date: "2026-10-14",
      start_ms: wib("2026-10-14T01:00:00"),
      end_ms: wib("2026-10-14T21:00:00"),
    });
  });

  it("22:00 outlet: window 01:00-18:00, auto-stop 23:00", () => {
    expect(mulaiWindowFor("2026-10-14", OUTLET_22, JKT)?.end_ms).toBe(wib("2026-10-14T18:00:00"));
    expect(autoStopAtMs("2026-10-14", OUTLET_22, JKT)).toBe(wib("2026-10-14T23:00:00"));
  });

  it("a closed weekday has no close, window or auto-stop", () => {
    const w = { ...TEST_OUTLET, wed: null };
    expect(closeMs("2026-10-14", w, JKT)).toBeNull();
    expect(mulaiWindowFor("2026-10-14", w, JKT)).toBeNull();
    expect(autoStopAtMs("2026-10-14", w, JKT)).toBeNull();
  });

  it("the Selesai delay equals the Mulai cut-off (4 h), by construction", () => {
    expect(SELESAI_AFTER_START_MS).toBe(MULAI_CUTOFF_BEFORE_CLOSE_MS);
    expect(MULAI_CUTOFF_BEFORE_CLOSE_MS).toBe(4 * 60 * 60_000);
  });
});

describe("mulaiWindowDateOf (inclusive window edges)", () => {
  it("00:59 is outside, 01:00 and 21:00 are inside, 21:00:00.001 is outside", () => {
    expect(mulaiWindowDateOf(wib("2026-10-14T00:59:00"), TEST_OUTLET, JKT)).toBeNull();
    expect(mulaiWindowDateOf(wib("2026-10-14T01:00:00"), TEST_OUTLET, JKT)).toBe("2026-10-14");
    expect(mulaiWindowDateOf(wib("2026-10-14T21:00:00"), TEST_OUTLET, JKT)).toBe("2026-10-14");
    expect(mulaiWindowDateOf(wib("2026-10-14T21:00:00") + 1, TEST_OUTLET, JKT)).toBeNull();
  });
});

describe("selesaiFromMs (D1: start + 4 h, capped at close)", () => {
  it("Mulai 01:00 -> Selesai 05:00", () => {
    expect(selesaiFromMs(wib("2026-10-14T01:00:00"), "2026-10-14", TEST_OUTLET, JKT)).toBe(
      wib("2026-10-14T05:00:00"),
    );
  });

  it("Mulai 21:00 (window end) -> 01:00 next day, the close", () => {
    expect(selesaiFromMs(wib("2026-10-14T21:00:00"), "2026-10-14", TEST_OUTLET, JKT)).toBe(
      wib("2026-10-15T01:00:00"),
    );
  });

  it("Mulai 09:40 -> 13:40", () => {
    expect(selesaiFromMs(wib("2026-10-14T09:40:00"), "2026-10-14", TEST_OUTLET, JKT)).toBe(
      wib("2026-10-14T13:40:00"),
    );
  });
});

describe("plannedIntervalFor", () => {
  it("normal day: opening to close", () => {
    expect(plannedIntervalFor("2026-10-14", OUTLET_22, JKT)).toEqual({
      local_date: "2026-10-14",
      start_ms: wib("2026-10-14T08:00:00"),
      end_ms: wib("2026-10-14T22:00:00"),
    });
  });

  it("past-midnight day wraps to the next local day", () => {
    expect(plannedIntervalFor("2026-10-14", TEST_OUTLET, JKT)?.end_ms).toBe(
      wib("2026-10-15T01:00:00"),
    );
  });

  it("closed day is null", () => {
    expect(plannedIntervalFor("2026-10-14", { ...TEST_OUTLET, wed: null }, JKT)).toBeNull();
  });
});

describe("mulaiAvailability (PROD-01 4.0 rule 6, 4.13)", () => {
  const base = { weekly: TEST_OUTLET, tz: JKT, session_open: false, last_ended: null };

  it("offered at 01:00 on a fresh device (D2)", () => {
    const r = mulaiAvailability({ ...base, now_ms: wib("2026-10-14T01:00:00") });
    expect(r).toEqual({ offered: true, reason: "offered", business_date: "2026-10-14", next_offer_ms: null });
  });

  it("not offered at 00:59 (before the window); next offer at 01:00", () => {
    const r = mulaiAvailability({ ...base, now_ms: wib("2026-10-14T00:59:00") });
    expect(r.offered).toBe(false);
    expect(r.next_offer_ms).toBe(wib("2026-10-14T01:00:00"));
  });

  it("window_passed after 21:00 with no session", () => {
    const r = mulaiAvailability({ ...base, now_ms: wib("2026-10-14T21:00:30") });
    expect(r.reason).toBe("window_passed");
  });

  it("session_open wins over everything", () => {
    const r = mulaiAvailability({ ...base, session_open: true, now_ms: wib("2026-10-14T10:00:00") });
    expect(r).toEqual({ offered: false, reason: "session_open", business_date: null, next_offer_ms: null });
  });

  it("closed_day on a null weekday, next offer on the next open day at 01:00", () => {
    const w = { ...TEST_OUTLET, wed: null, thu: null };
    const r = mulaiAvailability({ ...base, weekly: w, now_ms: wib("2026-10-14T12:00:00") });
    expect(r.reason).toBe("closed_day");
    expect(r.next_offer_ms).toBe(wib("2026-10-16T01:00:00"));
  });

  it("day_ended for a date already ended by this device", () => {
    const r = mulaiAvailability({
      ...base,
      now_ms: wib("2026-10-14T15:00:00"),
      last_ended: { business_date: "2026-10-14", debrief_ends_at_ms: wib("2026-10-14T16:00:00") },
    });
    expect(r.reason).toBe("day_ended");
  });

  it("debrief_running (Mulai gate): Thu 01:00 with Wed's debrief to 01:40", () => {
    const last = { business_date: "2026-10-14", debrief_ends_at_ms: wib("2026-10-15T01:40:00") };
    const before = mulaiAvailability({ ...base, last_ended: last, now_ms: wib("2026-10-15T01:00:00") });
    expect(before.reason).toBe("debrief_running");
    expect(before.next_offer_ms).toBe(wib("2026-10-15T01:40:00"));
    const after = mulaiAvailability({ ...base, last_ended: last, now_ms: wib("2026-10-15T01:40:00") });
    expect(after).toEqual({ offered: true, reason: "offered", business_date: "2026-10-15", next_offer_ms: null });
  });

  it("previous day off (no last_ended for it): nothing to wait for, offered at 01:00", () => {
    const last = { business_date: "2026-10-12", debrief_ends_at_ms: wib("2026-10-13T03:00:00") };
    const r = mulaiAvailability({ ...base, last_ended: last, now_ms: wib("2026-10-14T01:00:00") });
    expect(r.offered).toBe(true);
  });

  it("cancel at Wed 10:05 (debrief null): Thu offered from 01:00, Wed not reopened", () => {
    const last = { business_date: "2026-10-14", debrief_ends_at_ms: null };
    const wed = mulaiAvailability({ ...base, last_ended: last, now_ms: wib("2026-10-14T10:10:00") });
    expect(wed.reason).toBe("day_ended");
    const thu = mulaiAvailability({ ...base, last_ended: last, now_ms: wib("2026-10-15T01:30:00") });
    expect(thu).toEqual({ offered: true, reason: "offered", business_date: "2026-10-15", next_offer_ms: null });
  });

  it("two devices: each depends only on its own last_ended", () => {
    const a = mulaiAvailability({
      ...base,
      now_ms: wib("2026-10-15T01:10:00"),
      last_ended: { business_date: "2026-10-14", debrief_ends_at_ms: wib("2026-10-15T01:40:00") },
    });
    const b = mulaiAvailability({ ...base, now_ms: wib("2026-10-15T01:10:00"), last_ended: null });
    expect(a.reason).toBe("debrief_running");
    expect(b.offered).toBe(true);
  });
});

describe("mulaiAvailability: day_ended persists through a closed day (R-P1 fix, UX-03 5.2)", () => {
  const base = { weekly: TEST_OUTLET, tz: JKT, session_open: false };
  const D = "2026-10-14"; // Wed, open in TEST_OUTLET
  const D1 = addDays(D, 1); // Thu
  const D2 = addDays(D, 2); // Fri
  const D3 = addDays(D, 3); // Sat

  it("T1 (regression): open day after — day_ended at 00:30, offered at 01:00", () => {
    const last = { business_date: D, debrief_ends_at_ms: null };
    const before = mulaiAvailability({ ...base, last_ended: last, now_ms: wib(`${D1}T00:30:00`) });
    expect(before.reason).toBe("day_ended");
    const at = mulaiAvailability({ ...base, last_ended: last, now_ms: wib(`${D1}T01:00:00`) });
    expect(at).toEqual({ offered: true, reason: "offered", business_date: D1, next_offer_ms: null });
  });

  it("T2 (the fix): closed day after — stays day_ended, next offer skips to the day after the closed one", () => {
    const weekly = { ...TEST_OUTLET, thu: null };
    const last = { business_date: D, debrief_ends_at_ms: null };
    const r = mulaiAvailability({ ...base, weekly, last_ended: last, now_ms: wib(`${D1}T10:00:00`) });
    expect(r.reason).toBe("day_ended");
    expect(r.offered).toBe(false);
    expect(r.next_offer_ms).toBe(wib(`${D2}T01:00:00`));
  });

  it("T3: two closed days after — still day_ended through both, enabled the day after", () => {
    const weekly = { ...TEST_OUTLET, thu: null, fri: null };
    const last = { business_date: D, debrief_ends_at_ms: null };
    const r = mulaiAvailability({ ...base, weekly, last_ended: last, now_ms: wib(`${D2}T12:00:00`) });
    expect(r.reason).toBe("day_ended");
    expect(r.next_offer_ms).toBe(wib(`${D3}T01:00:00`));
  });

  it("T4: a stale last_ended (two open days already passed since) is closed_day, not day_ended", () => {
    const weekly = { ...TEST_OUTLET, wed: null }; // D (Wed) closed; D-1 (Tue) and D-2 (Mon) open
    const last = { business_date: "2026-10-11", debrief_ends_at_ms: null }; // Sun, 3 days before D
    const r = mulaiAvailability({ ...base, weekly, last_ended: last, now_ms: wib(`${D}T10:00:00`) });
    expect(r.reason).toBe("closed_day");
  });

  it("T5: no last_ended at all on a closed day is closed_day", () => {
    const weekly = { ...TEST_OUTLET, wed: null };
    const r = mulaiAvailability({ ...base, weekly, last_ended: null, now_ms: wib(`${D}T10:00:00`) });
    expect(r.reason).toBe("closed_day");
  });

  it("T6: debrief running past 01:00 into a closed day, then day_ended once it ends", () => {
    const weekly = { ...TEST_OUTLET, thu: null };
    const last = { business_date: D, debrief_ends_at_ms: wib(`${D1}T02:10:00`) };
    const during = mulaiAvailability({ ...base, weekly, last_ended: last, now_ms: wib(`${D1}T01:30:00`) });
    expect(during.reason).toBe("debrief_running");
    const after = mulaiAvailability({ ...base, weekly, last_ended: last, now_ms: wib(`${D1}T02:10:00`) });
    expect(after.reason).toBe("day_ended");
  });

  it("T7: every day closed never throws, is closed_day with no next offer", () => {
    const r = mulaiAvailability({ ...base, weekly: everyDay(null), last_ended: null, now_ms: wib(`${D}T10:00:00`) });
    expect(r).toEqual({ offered: false, reason: "closed_day", business_date: null, next_offer_ms: null });
  });

  it("T8 (regression): last ended the day before, today open, now past today's window end — window_passed", () => {
    const last = { business_date: addDays(D, -1), debrief_ends_at_ms: null };
    const r = mulaiAvailability({ ...base, last_ended: last, now_ms: wib(`${D}T21:00:01`) });
    expect(r.reason).toBe("window_passed");
  });
});

describe("evaluateCheckpoint", () => {
  const offered = (now: number) =>
    mulaiAvailability({
      now_ms: now, weekly: OUTLET_22, tz: JKT, session_open: false, last_ended: null,
    });

  it("before opening: none; at opening with Mulai offered: opening_no_session", () => {
    const before = wib("2026-10-14T07:59:00");
    expect(
      evaluateCheckpoint({ now_ms: before, weekly: OUTLET_22, tz: JKT, running_session_local_date: null, mulai: offered(before) }),
    ).toBe("none");
    const at = wib("2026-10-14T08:00:00");
    expect(
      evaluateCheckpoint({ now_ms: at, weekly: OUTLET_22, tz: JKT, running_session_local_date: null, mulai: offered(at) }),
    ).toBe("opening_no_session");
  });

  it("opening banner stops at the window end (close - 4 h = 18:00 on the 22:00 outlet)", () => {
    const inside = wib("2026-10-14T18:00:00");
    const after = wib("2026-10-14T18:00:00") + 1;
    expect(
      evaluateCheckpoint({ now_ms: inside, weekly: OUTLET_22, tz: JKT, running_session_local_date: null, mulai: offered(inside) }),
    ).toBe("opening_no_session");
    expect(
      evaluateCheckpoint({ now_ms: after, weekly: OUTLET_22, tz: JKT, running_session_local_date: null, mulai: offered(after) }),
    ).toBe("none");
  });

  it("running before close: none; running at close and past midnight: closing_session_running", () => {
    const beforeClose = wib("2026-10-14T21:59:00");
    expect(
      evaluateCheckpoint({ now_ms: beforeClose, weekly: OUTLET_22, tz: JKT, running_session_local_date: "2026-10-14", mulai: offered(beforeClose) }),
    ).toBe("none");
    const atClose = wib("2026-10-14T22:00:00");
    expect(
      evaluateCheckpoint({ now_ms: atClose, weekly: OUTLET_22, tz: JKT, running_session_local_date: "2026-10-14", mulai: offered(atClose) }),
    ).toBe("closing_session_running");
  });

  it("test outlet closing hour after midnight: running at 01:30 is closing_session_running", () => {
    const now = wib("2026-10-15T01:30:00");
    const mulai = mulaiAvailability({ now_ms: now, weekly: TEST_OUTLET, tz: JKT, session_open: true, last_ended: null });
    expect(
      evaluateCheckpoint({ now_ms: now, weekly: TEST_OUTLET, tz: JKT, running_session_local_date: "2026-10-14", mulai }),
    ).toBe("closing_session_running");
  });

  it("no banner next to a disabled Mulai (debrief running)", () => {
    const now = wib("2026-10-15T01:10:00");
    const mulai = mulaiAvailability({
      now_ms: now, weekly: OUTLET_22, tz: JKT, session_open: false,
      last_ended: { business_date: "2026-10-14", debrief_ends_at_ms: wib("2026-10-15T01:40:00") },
    });
    expect(
      evaluateCheckpoint({ now_ms: now, weekly: OUTLET_22, tz: JKT, running_session_local_date: null, mulai }),
    ).toBe("none");
  });

  it("closed weekday: none", () => {
    const w = { ...OUTLET_22, wed: null };
    const now = wib("2026-10-14T10:00:00");
    const mulai = mulaiAvailability({ now_ms: now, weekly: w, tz: JKT, session_open: false, last_ended: null });
    expect(
      evaluateCheckpoint({ now_ms: now, weekly: w, tz: JKT, running_session_local_date: null, mulai }),
    ).toBe("none");
  });
});

describe("E13 window edges through mulaiAvailability (PROD-01 4.13 E13)", () => {
  const base = { weekly: TEST_OUTLET, tz: JKT, session_open: false, last_ended: null };

  it("01:00:00.000 and close - 4 h exactly are offered", () => {
    expect(mulaiAvailability({ ...base, now_ms: wib("2026-10-14T01:00:00") }).offered).toBe(true);
    expect(mulaiAvailability({ ...base, now_ms: wib("2026-10-14T21:00:00") }).offered).toBe(true);
  });

  it("close - 4 h plus 1 ms is not offered: the day is off, next offer Thu 01:00", () => {
    const r = mulaiAvailability({ ...base, now_ms: wib("2026-10-14T21:00:00") + 1 });
    expect(r).toEqual({
      offered: false,
      reason: "window_passed",
      business_date: null,
      next_offer_ms: wib("2026-10-15T01:00:00"),
    });
  });

  it("22:00 outlet: 18:00:00.001 is window_passed", () => {
    const r = mulaiAvailability({ ...base, weekly: OUTLET_22, now_ms: wib("2026-10-14T18:00:00") + 1 });
    expect(r.reason).toBe("window_passed");
  });
});

describe("Mulai eligibility invariant (PROD-01 4.13 section 6)", () => {
  /** Thu closed; Sunday runs 08:00-23:00 (close before midnight, no wrap). */
  const MIXED: WeeklyHours = { ...everyDay(day("09:30", "01:00")), thu: null, sun: day("08:00", "23:00") };
  const FIXTURES: ReadonlyArray<readonly [string, WeeklyHours]> = [
    ["test outlet 09:30-01:00", TEST_OUTLET],
    ["22:00 outlet", OUTLET_22],
    ["mixed (Thu closed, Sun 08:00-23:00)", MIXED],
  ];
  const STEP_MS = 15 * 60_000;
  const STEPS_48H = (48 * 60 * 60_000) / STEP_MS;
  const E_DATES = Array.from({ length: 14 }, (_, i) => addDays("2026-10-01", i));

  for (const [name, weekly] of FIXTURES) {
    it(`${name}: no crash and consistent results for 14 E dates x 3 debrief values x 15-min steps`, () => {
      const violations: string[] = [];
      for (const e of E_DATES) {
        const close = closeMs(e, weekly, JKT) ?? zonedTimeToEpochMs(e, "00:00", JKT);
        const debriefs: Array<number | null> = [null, close + 60 * 60_000, close + 2 * 60 * 60_000];
        const from = zonedTimeToEpochMs(e, "00:00", JKT);
        for (const debrief of debriefs) {
          const last = { business_date: e, debrief_ends_at_ms: debrief };
          for (let i = 0; i < STEPS_48H; i++) {
            const t = from + i * STEP_MS;
            const r = mulaiAvailability({ now_ms: t, weekly, tz: JKT, session_open: false, last_ended: last });
            const tag = `E=${e} debrief=${debrief} t=${new Date(t).toISOString()}`;
            const d = businessDateOf(t, JKT);
            const w = mulaiWindowFor(d, weekly, JKT);
            const inWindow = w !== null && t >= w.start_ms && t <= w.end_ms;
            const shouldOffer =
              inWindow && d > e && (debrief === null || t >= debrief);

            if (r.offered) {
              if (r.business_date !== d || r.reason !== "offered" || r.next_offer_ms !== null) {
                violations.push(`${tag}: offered result inconsistent ${JSON.stringify(r)}`);
              }
              if (!inWindow) violations.push(`${tag}: offered outside W(${d})`);
              if (d <= e) violations.push(`${tag}: offered for ${d} not after E`);
              if (weekly[weekdayOf(d)] === null) violations.push(`${tag}: offered on a closed weekday`);
              if (debrief !== null && t < debrief) violations.push(`${tag}: offered during debrief`);
            } else {
              if (r.business_date !== null) violations.push(`${tag}: not offered but business_date set`);
              if (shouldOffer) violations.push(`${tag}: inside W(${d}) with D > E and no debrief, not offered (${r.reason})`);
            }
          }
        }
      }
      expect(violations.slice(0, 5)).toEqual([]);
      expect(violations).toHaveLength(0);
    });
  }
});
