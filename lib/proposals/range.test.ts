import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/capture/calendar";
import { validateRange } from "@/lib/proposals/range";

const TODAY = "2026-10-10";
const RETENTION = 14;

describe("validateRange (suff-v1 range_valid)", () => {
  it("from > to -> range_order", () => {
    const r = validateRange({ from_date: "2026-10-05", to_date: "2026-10-01" }, TODAY, RETENTION);
    expect(r).toEqual({ ok: false, code: "range_order" });
  });

  it("to = today + 1 -> range_future", () => {
    const r = validateRange(
      { from_date: TODAY, to_date: addDays(TODAY, 1) },
      TODAY,
      RETENTION,
    );
    expect(r).toEqual({ ok: false, code: "range_future" });
  });

  it("15 days -> range_too_long", () => {
    const r = validateRange(
      { from_date: addDays(TODAY, -14), to_date: TODAY },
      TODAY,
      RETENTION,
    );
    expect(r).toEqual({ ok: false, code: "range_too_long" });
  });

  it("14 days -> ok", () => {
    const r = validateRange(
      { from_date: addDays(TODAY, -13), to_date: TODAY },
      TODAY,
      RETENTION,
    );
    expect(r).toEqual({ ok: true });
  });

  it("from = today - 14 with retention 14 -> range_too_old", () => {
    const from = addDays(TODAY, -14);
    const r = validateRange({ from_date: from, to_date: from }, TODAY, RETENTION);
    expect(r).toEqual({ ok: false, code: "range_too_old" });
  });

  it("from = today - 13 with retention 14 -> ok", () => {
    const from = addDays(TODAY, -13);
    const r = validateRange({ from_date: from, to_date: from }, TODAY, RETENTION);
    expect(r).toEqual({ ok: true });
  });

  it("[today, today] -> ok", () => {
    const r = validateRange({ from_date: TODAY, to_date: TODAY }, TODAY, RETENTION);
    expect(r).toEqual({ ok: true });
  });

  it("a range that is both reversed and future -> range_order (checked first)", () => {
    const r = validateRange(
      { from_date: addDays(TODAY, 2), to_date: addDays(TODAY, 1) },
      TODAY,
      RETENTION,
    );
    expect(r).toEqual({ ok: false, code: "range_order" });
  });
});
