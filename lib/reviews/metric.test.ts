import { describe, expect, it } from "vitest";
import { zonedTimeToEpochMs } from "@/lib/capture/calendar";
import type { AttributionSession } from "@/lib/day/attribution";
import type { ProposalThreadRow } from "@/lib/proposals/candidates";
import { countWindow, rate, reviewWindows } from "@/lib/reviews/metric";

const TZ = "Asia/Jakarta";
const DEVICE = "dev-DEVSENTINEL";

function row(date: string, over: Partial<ProposalThreadRow> = {}, hm = "10:00"): ProposalThreadRow {
  return {
    outlet_id: "o1",
    thread_id: `t-${date}-${hm}-${Math.random()}`,
    device_id: DEVICE,
    category: "CUSTOMER_SERVICE",
    status: "fact",
    first_line_start_ms: zonedTimeToEpochMs(date, hm, TZ),
    summary: "a fact",
    ...over,
  };
}

function session(date: string, over: Partial<AttributionSession> = {}): AttributionSession {
  return {
    device_id: DEVICE,
    local_date: date,
    started_at_ms: zonedTimeToEpochMs(date, "09:30", TZ),
    ended_at_ms: null,
    auto_stop_at_ms: zonedTimeToEpochMs(date, "22:00", TZ),
    end_reason: null,
    ...over,
  };
}

describe("reviewWindows", () => {
  it("2.T1 before = the proposal range; after = effective .. review_date - 1", () => {
    const w = reviewWindows({
      range: { from_date: "2026-10-06", to_date: "2026-10-12" },
      effective_from_date: "2026-10-16",
      review_date: "2026-10-23",
    });
    expect(w.before).toEqual({ from_date: "2026-10-06", to_date: "2026-10-12" });
    expect(w.after).toEqual({ from_date: "2026-10-16", to_date: "2026-10-22" });
  });

  it("2.T1 a range ending on the effective date is clipped to the day before", () => {
    const w = reviewWindows({
      range: { from_date: "2026-10-10", to_date: "2026-10-16" },
      effective_from_date: "2026-10-16",
      review_date: "2026-10-23",
    });
    expect(w.before).toEqual({ from_date: "2026-10-10", to_date: "2026-10-15" });
  });

  it("2.T1 a range wholly on/after the effective date collapses to the day before (guard)", () => {
    const w = reviewWindows({
      range: { from_date: "2026-10-17", to_date: "2026-10-18" },
      effective_from_date: "2026-10-16",
      review_date: "2026-10-23",
    });
    expect(w.before).toEqual({ from_date: "2026-10-15", to_date: "2026-10-15" });
  });
});

describe("countWindow", () => {
  const window = { from_date: "2026-10-06", to_date: "2026-10-08" };
  const sessions = [session("2026-10-06"), session("2026-10-07"), session("2026-10-08")];
  const base = { window, sessions, tz: TZ, category: "CUSTOMER_SERVICE" as const };

  it("2.T2 counts only facts of the metric category", () => {
    const rows = [row("2026-10-06"), row("2026-10-07"), row("2026-10-07", { category: "ROUTINE_OPS" })];
    expect(countWindow({ ...base, rows }).count).toBe(2);
  });

  it("2.T2 excludes open, unverified, excluded, supervisor_rejected, NON_WORK", () => {
    const rows = [
      row("2026-10-06", { status: "open" }),
      row("2026-10-06", { status: "unverified" }),
      row("2026-10-06", { excluded_from_evidence: true }),
      row("2026-10-06", { label_source: "supervisor_rejected" }),
      row("2026-10-06", { category: "NON_WORK" as never }),
      row("2026-10-06"),
    ];
    expect(countWindow({ ...base, rows }).count).toBe(1);
  });

  it("2.T2 excludes facts inside a discarded session", () => {
    const rows = [row("2026-10-06"), row("2026-10-07")];
    const s = [session("2026-10-06", { end_reason: "discarded" }), session("2026-10-07"), session("2026-10-08")];
    expect(countWindow({ ...base, rows, sessions: s }).count).toBe(1);
  });

  it("2.T2 uses confirmed_category over category", () => {
    const rows = [
      row("2026-10-06", { category: "ROUTINE_OPS", confirmed_category: "CUSTOMER_SERVICE" }),
      row("2026-10-06", { category: "CUSTOMER_SERVICE", confirmed_category: "ROUTINE_OPS" }),
    ];
    expect(countWindow({ ...base, rows }).count).toBe(1);
  });

  it("2.T2 a fact outside the window dates is not counted", () => {
    const rows = [row("2026-10-05"), row("2026-10-09"), row("2026-10-07")];
    const s = [...sessions, session("2026-10-05"), session("2026-10-09")];
    expect(countWindow({ ...base, rows, sessions: s }).count).toBe(1);
  });

  it("2.T3 days_captured counts sessions' dates (3 sessions, facts on 2 dates -> 3)", () => {
    const rows = [row("2026-10-06"), row("2026-10-07")];
    expect(countWindow({ ...base, rows })).toMatchObject({ days_captured: 3, count: 2 });
  });

  it("2.T3 a date with only a discarded session is not counted", () => {
    const s = [session("2026-10-06"), session("2026-10-07", { end_reason: "discarded" }), session("2026-10-08")];
    expect(countWindow({ ...base, rows: [], sessions: s }).days_captured).toBe(2);
  });

  it("2.T3 a fact attributed to a date with no session adds that date", () => {
    // no sessions at all: attribution falls back to the business date of the timestamp
    const rows = [row("2026-10-07"), row("2026-10-07", {}, "11:00")];
    const r = countWindow({ ...base, rows, sessions: [] });
    expect(r.days_captured).toBe(1);
    expect(r.count).toBe(2);
  });

  it("2.T3 any evidence-category candidate adds its date; sessions outside the window do not count", () => {
    // R-19 D-3: ROUTINE_OPS is never a candidate (selectCandidates drops it), so an evidence category stands in.
    const rows = [row("2026-10-08", { category: "EVENT" })];
    const s = [session("2026-10-05"), session("2026-10-09")];
    expect(countWindow({ ...base, rows, sessions: s })).toMatchObject({ days_captured: 1, count: 0 });
  });

  it("returns the window dates unchanged", () => {
    expect(countWindow({ ...base, rows: [] })).toMatchObject(window);
  });
});

describe("rate", () => {
  it("2.T4 null when 0 days; 6/3 -> 2", () => {
    expect(rate({ days_captured: 0, count: 0 })).toBeNull();
    expect(rate({ days_captured: 0, count: 5 })).toBeNull();
    expect(rate({ days_captured: 3, count: 6 })).toBe(2);
  });
});
