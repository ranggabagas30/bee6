import { describe, expect, it } from "vitest";
import {
  DeviceRowSchema,
  DevicesResponseSchema,
  HomeR19ExtensionSchema,
  PairingCodeBodySchema,
  PairingCodeResponseSchema,
  ProposalsWatchSchema,
  WatchRowSchema,
} from "@/lib/contracts/r19";

const UUID = "22222222-2222-4222-8222-222222222222";

describe("R-19 GET /api/v1/proposals watch panel (plan section 3.5)", () => {
  const row = { category: "CUSTOMER_SERVICE", facts: 2, dates: 2, need_dates: 2, state: "ready" };

  it("a row is a work category with counts, need_dates fixed at 2 and one of three states", () => {
    expect(WatchRowSchema.safeParse(row).success).toBe(true);
    for (const state of ["ready", "needs_more", "proposed"]) expect(WatchRowSchema.safeParse({ ...row, state }).success).toBe(true);
    expect(WatchRowSchema.safeParse({ ...row, state: "idle" }).success).toBe(false);
    expect(WatchRowSchema.safeParse({ ...row, need_dates: 3 }).success).toBe(false);
    expect(WatchRowSchema.safeParse({ ...row, facts: -1 }).success).toBe(false);
    expect(WatchRowSchema.safeParse({ ...row, extra: 1 }).success).toBe(false);
  });

  it("NON_WORK never appears as a row (plain code lists work categories only)", () => {
    expect(WatchRowSchema.safeParse({ ...row, category: "NON_WORK" }).success).toBe(false);
    expect(WatchRowSchema.safeParse({ ...row, category: "MADE_UP" }).success).toBe(false);
  });

  it("the panel is { from_date, to_date, categories } and strict; an empty list is valid", () => {
    expect(ProposalsWatchSchema.safeParse({ from_date: "2026-10-08", to_date: "2026-10-14", categories: [] }).success).toBe(true);
    expect(ProposalsWatchSchema.safeParse({ from_date: "2026-10-08", to_date: "2026-10-14", categories: [row] }).success).toBe(true);
    expect(ProposalsWatchSchema.safeParse({ from_date: "8 Oct", to_date: "2026-10-14", categories: [] }).success).toBe(false);
    expect(ProposalsWatchSchema.safeParse({ from_date: "2026-10-08", to_date: "2026-10-14" }).success).toBe(false);
    expect(ProposalsWatchSchema.safeParse({ from_date: "2026-10-08", to_date: "2026-10-14", categories: [], extra: 1 }).success).toBe(false);
  });
});

describe("R-19 GET /api/v1/home additions (plan section 9.2)", () => {
  const good = {
    progress: {
      week: { approved: 1, rejected: 0 },
      month: { approved: 1, rejected: 1 },
      since_start: { approved: 2, rejected: 1 },
    },
    waiting_approval: { count: 1, items: [{ proposal_id: UUID, change_title: "Write the bake time on every tray" }] },
    next_review: { date: "2026-10-27", change_title: "Write the bake time on every tray" },
  };

  it("accepts the three additions, and empty values (zeros, no items, no review)", () => {
    expect(HomeR19ExtensionSchema.safeParse(good).success).toBe(true);
    const zero = { approved: 0, rejected: 0 };
    expect(
      HomeR19ExtensionSchema.safeParse({
        progress: { week: zero, month: zero, since_start: zero },
        waiting_approval: { count: 0, items: [] },
        next_review: { date: null, change_title: null },
      }).success,
    ).toBe(true);
  });

  it("refuses a negative tally, more than 5 waiting items, a non-uuid id and a bad review date", () => {
    expect(HomeR19ExtensionSchema.safeParse({ ...good, progress: { ...good.progress, week: { approved: -1, rejected: 0 } } }).success).toBe(false);
    const item = good.waiting_approval.items[0]!;
    expect(HomeR19ExtensionSchema.safeParse({ ...good, waiting_approval: { count: 6, items: Array(6).fill(item) } }).success).toBe(false);
    expect(HomeR19ExtensionSchema.safeParse({ ...good, waiting_approval: { count: 1, items: [{ ...item, proposal_id: "x" }] } }).success).toBe(false);
    expect(HomeR19ExtensionSchema.safeParse({ ...good, next_review: { date: "27/10", change_title: null } }).success).toBe(false);
  });

  it("every object is strict", () => {
    expect(HomeR19ExtensionSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(HomeR19ExtensionSchema.safeParse({ ...good, progress: { ...good.progress, week: { approved: 1, rejected: 0, extra: 1 } } }).success).toBe(false);
    expect(HomeR19ExtensionSchema.safeParse({ ...good, waiting_approval: { ...good.waiting_approval, extra: 1 } }).success).toBe(false);
    expect(HomeR19ExtensionSchema.safeParse({ ...good, next_review: { ...good.next_review, extra: 1 } }).success).toBe(false);
  });
});

describe("R-19 connected devices (plan section 9.3, hard rule #7: no device id, token or person)", () => {
  const row = { label: "Shop phone 1", paired: true, paired_on: "2026-10-12", last_seen_ms: 1_700_000_000_000, listening: false };

  it("a row has a label, paired state, paired_on, last_seen_ms and listening; the nullable ones may be null", () => {
    expect(DeviceRowSchema.safeParse(row).success).toBe(true);
    expect(DeviceRowSchema.safeParse({ ...row, paired: false, paired_on: null, last_seen_ms: null }).success).toBe(true);
    expect(DeviceRowSchema.safeParse({ ...row, label: "" }).success).toBe(false);
    expect(DeviceRowSchema.safeParse({ ...row, paired_on: "yesterday" }).success).toBe(false);
    expect(DeviceRowSchema.safeParse({ ...row, paired_on: "2026-10-12T08:00:00Z" }).success).toBe(false);
    expect(DeviceRowSchema.safeParse({ ...row, listening: "yes" }).success).toBe(false);
  });

  it("a device id, a token hash or a pairing code on a row is refused (the shape is strict)", () => {
    for (const key of ["device_id", "id", "token_hash", "pairing_code"]) {
      expect(DeviceRowSchema.safeParse({ ...row, [key]: "x" }).success, key).toBe(false);
    }
  });

  it("the list response is { devices: DeviceRow[] } and strict", () => {
    expect(DevicesResponseSchema.safeParse({ devices: [] }).success).toBe(true);
    expect(DevicesResponseSchema.safeParse({ devices: [row] }).success).toBe(true);
    expect(DevicesResponseSchema.safeParse({ devices: [{ ...row, device_id: "dev-1" }] }).success).toBe(false);
    expect(DevicesResponseSchema.safeParse({ devices: [], extra: 1 }).success).toBe(false);
  });

  it("pairing-code: an empty strict body; the response is a 6-digit code and an expiry", () => {
    expect(PairingCodeBodySchema.safeParse({}).success).toBe(true);
    expect(PairingCodeBodySchema.safeParse({ device_id: "dev-1" }).success).toBe(false);
    expect(PairingCodeResponseSchema.safeParse({ code: "123456", expires_at_ms: 1 }).success).toBe(true);
    for (const code of ["12345", "1234567", "12345a", " 12345", 123456]) {
      expect(PairingCodeResponseSchema.safeParse({ code, expires_at_ms: 1 }).success, String(code)).toBe(false);
    }
    expect(PairingCodeResponseSchema.safeParse({ code: "123456", expires_at_ms: -1 }).success).toBe(false);
    expect(PairingCodeResponseSchema.safeParse({ code: "123456", expires_at_ms: 1, device_id: "dev-1" }).success).toBe(false);
  });
});
