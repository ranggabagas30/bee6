import { describe, expect, it } from "vitest";
import { clockLabel, dayLabel } from "@/lib/i18n/format";

describe("dayLabel: written-out business day in the page language (UX-03 section 6)", () => {
  it("EN is 'Fri 16 Oct'", () => {
    expect(dayLabel("2026-10-16", "en")).toBe("Fri 16 Oct");
    expect(dayLabel("2026-10-15", "en")).toBe("Thu 15 Oct");
  });

  it("ID is 'Jum 16 Okt' and 'Rab 14 Okt'", () => {
    expect(dayLabel("2026-10-16", "id")).toBe("Jum 16 Okt");
    expect(dayLabel("2026-10-14", "id")).toBe("Rab 14 Okt");
  });

  it("never pads the day number", () => {
    expect(dayLabel("2026-10-07", "en")).toBe("Wed 7 Oct");
  });
});

describe("clockLabel: HH:MM 24-hour in the shop's zone", () => {
  it("prints the shop-local wall clock, not UTC", () => {
    // 2026-10-12 16:00 UTC is 23:00 in Asia/Jakarta (UTC+7).
    expect(clockLabel(Date.UTC(2026, 9, 12, 16, 0), "Asia/Jakarta")).toBe("23:00");
  });

  it("zero-pads hours below 10", () => {
    expect(clockLabel(Date.UTC(2026, 9, 12, 18, 5), "Asia/Jakarta")).toBe("01:05");
  });
});
