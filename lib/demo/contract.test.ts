import { describe, expect, it } from "vitest";
import { DemoSessionBodySchema, DemoSessionResponseSchema } from "@/lib/demo/contract";

const KEY = "A".repeat(43);

describe("DemoSessionBodySchema", () => {
  it("accepts each role, with or without a well-formed sandbox_key", () => {
    for (const role of ["owner", "supervisor", "staff"]) {
      expect(DemoSessionBodySchema.safeParse({ role }).success).toBe(true);
      expect(DemoSessionBodySchema.safeParse({ role, sandbox_key: KEY }).success).toBe(true);
    }
    expect(DemoSessionBodySchema.safeParse({ role: "staff", sandbox_key: "a-_9".repeat(10) + "abc" }).success).toBe(true);
  });

  it("rejects an unknown role, an extra key and a malformed key", () => {
    expect(DemoSessionBodySchema.safeParse({ role: "admin" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "device" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", outlet_id: "sbx-1" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", sandbox_key: "short" }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", sandbox_key: "A".repeat(44) }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({ role: "owner", sandbox_key: "!".repeat(43) }).success).toBe(false);
    expect(DemoSessionBodySchema.safeParse({}).success).toBe(false);
  });
});

describe("DemoSessionResponseSchema", () => {
  it("accepts the web and device shapes", () => {
    expect(
      DemoSessionResponseSchema.safeParse({ kind: "web", role: "owner", custom_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home" }).success,
    ).toBe(true);
    expect(
      DemoSessionResponseSchema.safeParse({ kind: "device", role: "staff", device_id: "jdg-1", device_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/capture" }).success,
    ).toBe(true);
  });

  it("rejects staff on the web shape, owner on the device shape, a wrong landing path and extra keys", () => {
    expect(DemoSessionResponseSchema.safeParse({ kind: "web", role: "staff", custom_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home" }).success).toBe(false);
    expect(DemoSessionResponseSchema.safeParse({ kind: "device", role: "owner", device_id: "j", device_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/capture" }).success).toBe(false);
    expect(DemoSessionResponseSchema.safeParse({ kind: "device", role: "staff", device_id: "j", device_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home" }).success).toBe(false);
    expect(DemoSessionResponseSchema.safeParse({ kind: "web", role: "owner", custom_token: "t", sandbox_key: KEY, expires_at_ms: 1, landing_path: "/home", outlet_id: "sbx-1" }).success).toBe(false);
  });
});
