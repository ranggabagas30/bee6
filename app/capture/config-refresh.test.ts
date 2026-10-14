import { describe, expect, it } from "vitest";
import {
  CONFIG_BUSY_POLL_MS,
  CONFIG_POLL_MS,
  configPollMs,
  dropOpenSession,
  markOpenSessionClosed,
  mergeRefreshedLastEnded,
} from "@/app/capture/config-refresh";
import type { CaptureConfigResponse } from "@/lib/capture/contract";

type LastEnded = CaptureConfigResponse["last_ended"];
const L = (over: Partial<NonNullable<LastEnded>> = {}): NonNullable<LastEnded> => ({
  business_date: "2026-10-12",
  end_reason: "selesai",
  debrief_ends_at_ms: 5_000,
  ...over,
});

describe("mergeRefreshedLastEnded", () => {
  it("keeps the phone-local record when the server reports the same day and reason (a changed debrief end would remount the debrief)", () => {
    const local = L({ debrief_ends_at_ms: 5_000 });
    expect(mergeRefreshedLastEnded(local, L({ debrief_ends_at_ms: 5_007 }))).toBe(local);
  });

  it("takes the server record when the day moved (a next-day jump shifts last_ended back a day)", () => {
    const server = L({ business_date: "2026-10-11" });
    expect(mergeRefreshedLastEnded(L(), server)).toBe(server);
  });

  it("takes the server record when the reason differs or nothing is held locally", () => {
    const server = L({ end_reason: "auto_stop" });
    expect(mergeRefreshedLastEnded(L(), server)).toBe(server);
    expect(mergeRefreshedLastEnded(null, server)).toBe(server);
  });

  it("never drops a held record for a null from the server", () => {
    const local = L();
    expect(mergeRefreshedLastEnded(local, null)).toBe(local);
    expect(mergeRefreshedLastEnded(null, null)).toBeNull();
  });
});

describe("configPollMs", () => {
  it("is 30 s normally and 5 s while the jump reports busy (transient)", () => {
    expect(configPollMs(null)).toBe(CONFIG_POLL_MS);
    expect(configPollMs("preparing")).toBe(CONFIG_POLL_MS);
    expect(configPollMs("busy")).toBe(CONFIG_BUSY_POLL_MS);
    expect(CONFIG_POLL_MS).toBe(30_000);
    expect(CONFIG_BUSY_POLL_MS).toBe(5_000);
  });
});

describe("open_session local updates", () => {
  const base = {
    timezone: "Asia/Jakarta",
    weekly_hours: {} as CaptureConfigResponse["weekly_hours"],
    last_ended: null,
    capture_mode: "room",
  } as unknown as CaptureConfigResponse;
  const withDemo = (open: unknown, closing = false) =>
    ({ ...base, demo_session: { open_session: open, closing_reached: closing, day: 1 } }) as unknown as CaptureConfigResponse;
  const OPEN = { session_id: "00000000-0000-4000-8000-000000000001", started_at_ms: 1, closing_reached: false, auto_stop_at_ms: 2 };

  it("dropOpenSession clears open_session and closing_reached, nothing else", () => {
    const out = dropOpenSession(withDemo(OPEN, true));
    expect(out.demo_session).toMatchObject({ open_session: null, closing_reached: false, day: 1 });
  });

  it("dropOpenSession leaves a pilot config (no demo_session) as is", () => {
    expect(dropOpenSession(base)).toBe(base);
  });

  it("markOpenSessionClosed sets closing_reached on the open session and the profile", () => {
    const out = markOpenSessionClosed(withDemo(OPEN));
    expect(out.demo_session).toMatchObject({ closing_reached: true, open_session: { closing_reached: true, session_id: OPEN.session_id } });
  });

  it("markOpenSessionClosed does nothing without an open session", () => {
    const c = withDemo(null);
    expect(markOpenSessionClosed(c)).toBe(c);
  });
});
