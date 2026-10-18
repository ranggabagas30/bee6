import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { AppError, BadRequestError, DemoCapError, ForbiddenError, LockedError, NotFoundError, UnauthorizedError } from "@/lib/http/errors";
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

  it("a sandbox outlet: one outlet read, then the caps (the 251st segment is 429 with Retry-After)", async () => {
    f.sandboxes.set(SBX, sandboxOutlet());
    for (let i = 0; i < 250; i++) await enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" });
    expect(f.calls.filter((c) => c === "getOutlet")).toHaveLength(250);
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

  it("mode 'check' reads the counters and never writes one; a later 'charge' does", async () => {
    f.sandboxes.set(SBX, sandboxOutlet());
    vi.stubEnv("DEMO_FAST_FORWARD_SANDBOX_CAP", "1");
    const who = { outlet_id: SBX, role: "supervisor" } as const;
    await enforceDemoCapsForRoute("fast_forward", who, "reviews:verdict", "check");
    await enforceDemoCapsForRoute("fast_forward", who, "reviews:verdict", "check");
    expect(f.bumps).toEqual([]);
    await enforceDemoCapsForRoute("fast_forward", who, "reviews:verdict", "charge");
    const err = await enforceDemoCapsForRoute("fast_forward", who, "reviews:verdict", "check").then(() => null, (e) => e);
    expect(err).toBeInstanceOf(LockedError);
    expect((err as LockedError).code).toBe("demo_fast_forward_cap");
    expect(f.bumps).toHaveLength(1);
  });

  it("fails closed (503 demo_not_ready) when a sandbox outlet's doc cannot be read", async () => {
    const err = await enforceDemoCapsForRoute("segment", { outlet_id: SBX, role: "device" }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(503);
    expect((err as AppError).code).toBe("demo_not_ready");
    expect(f.bumps).toEqual([]);
  });
});

describe("enforceDemoCapsForRoute: one fail-closed contract for every caller (QA: untyped cap failures)", () => {
  const SENTINEL = "sentinel-raw-firestore-message-7f3a";
  const consoleSpies = () => (["error", "warn", "info", "log", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  const allOutput = (spies: ReturnType<typeof consoleSpies>) => inspect(spies.flatMap((s) => s.mock.calls), { depth: 6 });
  const who = { outlet_id: SBX, role: "device" } as const;

  beforeEach(() => {
    f.sandboxes.set(SBX, sandboxOutlet());
  });
  afterEach(() => vi.restoreAllMocks());

  it("an untyped throw from the counter transaction is DemoCapError 503 demo_cap_unavailable, with only the class logged", async () => {
    const spies = consoleSpies();
    vi.spyOn(f.store, "bumpCounter").mockRejectedValue(new Error(SENTINEL));
    const err = await enforceDemoCapsForRoute("segment", who).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(DemoCapError);
    expect(err).toMatchObject({ statusCode: 503, code: "demo_cap_unavailable", message: "The demo is temporarily unavailable" });
    expect(spies[0]).toHaveBeenCalledWith("[demo] cap check failed", { error_class: "Error" });
    expect(allOutput(spies)).not.toContain(SENTINEL);
  });

  it("an untyped throw from the outlet read is the same typed 503, and no counter is written", async () => {
    const spies = consoleSpies();
    vi.spyOn(f.store, "getOutlet").mockRejectedValue(new Error(SENTINEL));
    const err = await enforceDemoCapsForRoute("segment", who).then(() => null, (e) => e);
    expect(err).toMatchObject({ name: "DemoCapError", statusCode: 503, code: "demo_cap_unavailable" });
    expect(f.bumps).toEqual([]);
    expect(allOutput(spies)).not.toContain(SENTINEL);
  });

  it("a store that cannot even be built fails closed the same way", async () => {
    const spies = consoleSpies();
    hoisted.factory.mockImplementation(() => {
      throw new Error(SENTINEL);
    });
    const err = await enforceDemoCapsForRoute("segment", who).then(() => null, (e) => e);
    expect(err).toMatchObject({ name: "DemoCapError", statusCode: 503, code: "demo_cap_unavailable" });
    expect(allOutput(spies)).not.toContain(SENTINEL);
  });

  it("an unready sandbox outlet is a typed DemoCapError demo_not_ready (not a bare AppError)", async () => {
    f.sandboxes.delete(SBX);
    const err = await enforceDemoCapsForRoute("segment", who).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(DemoCapError);
    expect(err).toMatchObject({ statusCode: 503, code: "demo_not_ready", message: "The demo is not ready" });
  });

  it("a permission failure passes through as its own 403 (not 503), before any read", async () => {
    const err = await enforceDemoCapsForRoute("generate", { outlet_id: SBX, role: "staff" }, "proposals:generate").then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as ForbiddenError).statusCode).toBe(403);
    expect(f.calls).toEqual([]);
  });

  it("client-facing 4xx AppErrors raised by the check pass through unchanged", async () => {
    for (const thrown of [new UnauthorizedError("no"), new NotFoundError("outlet", "x"), new BadRequestError("bad")]) {
      vi.spyOn(f.store, "getOutlet").mockRejectedValueOnce(thrown);
      const err = await enforceDemoCapsForRoute("segment", who).then(() => null, (e) => e);
      expect(err).toBe(thrown);
    }
  });

  it("a LockedError from the cap keeps its Retry-After seconds", async () => {
    vi.stubEnv("DEMO_SEGMENT_SANDBOX_CAP", "1");
    await enforceDemoCapsForRoute("segment", who);
    const err = await enforceDemoCapsForRoute("segment", who).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(LockedError);
    expect((err as LockedError).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("off-demo and non-sandbox callers are untouched: no store, no read, no log", async () => {
    const spies = consoleSpies();
    vi.spyOn(f.store, "getOutlet").mockRejectedValue(new Error(SENTINEL));
    await enforceDemoCapsForRoute("segment", { outlet_id: "proofed", role: "device" });
    vi.stubEnv("DEMO_MODE", "");
    await enforceDemoCapsForRoute("segment", who);
    expect(hoisted.factory).not.toHaveBeenCalled();
    expect(allOutput(spies)).toBe("[]");
  });
});
