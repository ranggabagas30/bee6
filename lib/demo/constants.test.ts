import { describe, expect, it } from "vitest";
import * as C from "@/lib/demo/constants";

describe("demo constants (R-12 Task 4.1)", () => {
  it("template ids are unique tokens: neither is a substring of the other, both are the seeded ids", () => {
    expect(C.TEMPLATE_OUTLET_ID).toBe("demo-tpl-outlet");
    expect(C.TEMPLATE_DEVICE_ID).toBe("demo-tpl-phone");
    expect(C.TEMPLATE_OUTLET_ID.includes(C.TEMPLATE_DEVICE_ID)).toBe(false);
    expect(C.TEMPLATE_DEVICE_ID.includes(C.TEMPLATE_OUTLET_ID)).toBe(false);
  });

  it("sessions last 2 hours (T-708)", () => {
    expect(C.SANDBOX_TTL_MS).toBe(2 * 60 * 60_000);
  });

  it("the documented defaults (Q-3)", () => {
    expect(C.SANDBOX_IP_DAILY).toBe(10);
    expect(C.SANDBOX_DAILY).toBe(300);
    expect(C.SWITCHES_PER_SANDBOX).toBe(30);
    expect(C.GENERATE_PER_SANDBOX).toBe(8);
    expect(C.GENERATE_DAILY).toBe(300);
    expect(C.CLEANUP_PER_CREATE).toBe(2);
  });

  it("the template bound fits one Firestore batch (500 writes max)", () => {
    expect(C.TEMPLATE_DOC_MAX).toBe(400);
    expect(C.WRITE_BATCH_MAX).toBeLessThanOrEqual(500);
    expect(C.WRITE_BATCH_MAX).toBe(400);
  });

  it("expired sandboxes are only cleaned up after a 24 h grace (E18)", () => {
    expect(C.CLEANUP_GRACE_MS).toBe(24 * 60 * 60_000);
  });

  it("R-19 journey constants (plan section 2.2)", () => {
    expect(C.CARRY_OVER_MAX).toBe(0);
    expect(C.DEMO_SESSION_MAX_MS).toBe(600_000);
    expect(C.DEMO_DAYS_TOTAL).toBe(3);
    expect(C.NEXT_DAY_MAX).toBe(2);
    expect(C.SEGMENT_PER_SANDBOX).toBe(150);
    expect(C.RESET_PER_SANDBOX).toBe(3);
    expect(C.PREPARING_MAX_MS).toBe(6 * 60_000);
    expect(C.PROCESS_NOW_MIN_INTERVAL_MS).toBe(20_000);
    expect(C.PROCESS_NOW_PER_SANDBOX).toBe(40);
    expect(C.NEXT_DAY_PER_SANDBOX).toBe(20);
  });

  it("R-19: three days means at most two jumps", () => {
    expect(C.NEXT_DAY_MAX).toBe(C.DEMO_DAYS_TOTAL - 1);
  });
});
