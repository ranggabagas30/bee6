import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ForbiddenError, LockedError } from "@/lib/http/errors";
import type { Outlet } from "@/lib/firestore/schema";
import { fakeStore } from "@/lib/demo/testing/fake-store";
import { templateSet } from "@/lib/demo/testing/fixtures";

const hoisted = vi.hoisted(() => ({ store: null as unknown, factory: vi.fn() }));
vi.mock("@/lib/firestore/demo-store", () => ({
  firestoreDemoStore: () => {
    hoisted.factory();
    return hoisted.store;
  },
}));

import { enforceDemoCapsForRoute } from "@/lib/demo/route-caps";

const SBX = "sbx-0123456789ab";
const sandboxOutlet = (): Outlet => ({
  ...templateSet().outlet,
  outlet_id: SBX,
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: Date.now(), expires_at_ms: Date.now() + 3_600_000, key_sha256: "a".repeat(64) },
});

let f: ReturnType<typeof fakeStore>;
beforeEach(() => {
  f = fakeStore();
  hoisted.store = f.store;
  vi.stubEnv("DEMO_MODE", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  hoisted.factory.mockReset();
});

describe("enforceDemoCapsForRoute", () => {
  it("off-demo (DEMO_MODE not exactly 'true'): no store is built, nothing is read", async () => {
    for (const v of [undefined, "", "1", "TRUE", "false"]) {
      if (v === undefined) vi.stubEnv("DEMO_MODE", undefined as unknown as string);
      else vi.stubEnv("DEMO_MODE", v);
      await enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" });
    }
    expect(hoisted.factory).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it("a non-sandbox outlet (pilot, shared demo outlet): zero reads, zero counters", async () => {
    for (const outlet_id of ["proofed", "demo-outlet", "demo-tpl-outlet", "xsbx-1"]) {
      await enforceDemoCapsForRoute("segment", { outlet_id, role: "device" });
    }
    expect(hoisted.factory).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it("a sandbox outlet: one outlet read, then the caps (the 41st segment is 429 with Retry-After)", async () => {
    f.sandboxes.set(SBX, sandboxOutlet());
    for (let i = 0; i < 40; i++) await enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" });
    expect(f.calls.filter((c) => c === "getOutlet")).toHaveLength(40);
    const err = await enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(LockedError);
    expect((err as LockedError).code).toBe("demo_segment_cap");
    expect((err as LockedError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("honours the env overrides at call time", async () => {
    f.sandboxes.set(SBX, sandboxOutlet());
    vi.stubEnv("DEMO_SEGMENT_SANDBOX_CAP", "1");
    await enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" });
    await expect(enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" })).rejects.toBeInstanceOf(LockedError);
  });

  it("a caller whose role lacks the permission is refused (403) BEFORE any cap is spent", async () => {
    f.sandboxes.set(SBX, sandboxOutlet());
    const err = await enforceDemoCapsForRoute("generate", { outlet_id: SBX, role: "staff" }, "proposals:generate").then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(f.bumps).toEqual([]);
    expect(f.calls).toEqual([]);
    await enforceDemoCapsForRoute("generate", { outlet_id: SBX, role: "supervisor" }, "proposals:generate");
    expect(f.bumps.length).toBeGreaterThan(0);
  });

  it("the permission check is inert off a sandbox (the service repeats it there)", async () => {
    await enforceDemoCapsForRoute("generate", { outlet_id: "proofed", role: "staff" }, "proposals:generate");
    expect(hoisted.factory).not.toHaveBeenCalled();
  });

  it("fails closed (503 demo_not_ready) when a sandbox outlet's doc cannot be read", async () => {
    const err = await enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(503);
    expect((err as AppError).code).toBe("demo_not_ready");
    expect(f.bumps).toEqual([]);
  });
});
