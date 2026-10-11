import { describe, expect, it, vi } from "vitest";
import { LockedError } from "@/lib/http/errors";
import type { Outlet } from "@/lib/firestore/schema";
import { capFromEnv, capSpec, enforceDemoCaps, modelDailyLimit, sandboxDailyLimit, type DemoCapKey } from "@/lib/demo/caps";
import { SANDBOX_DAILY } from "@/lib/demo/constants";
import { OUTLETS_READ_MAX } from "@/lib/reviews/constants";
import { secondsToUtcMidnight, utcDay } from "@/lib/demo/limits";
import { fakeStore } from "@/lib/demo/testing/fake-store";
import { templateSet } from "@/lib/demo/testing/fixtures";

const NOW = Date.UTC(2026, 9, 28, 10, 0, 0);
const EXPIRES = NOW + 3_600_000;
const SBX = "sbx-0123456789ab";

function sandboxOutlet(id = SBX): Outlet {
  return {
    ...templateSet().outlet,
    outlet_id: id,
    sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: NOW, expires_at_ms: EXPIRES, key_sha256: "a".repeat(64) },
  };
}
const plainOutlet = (): Outlet => ({ ...templateSet().outlet, outlet_id: "demo-outlet" });

const refusal = async (p: Promise<unknown>) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(LockedError);
  return err as LockedError;
};

describe("capFromEnv", () => {
  it("uses a positive integer override, otherwise the default", () => {
    expect(capFromEnv("50", 300)).toBe(50);
    for (const bad of [undefined, "", "abc", "-4", "0", "1.5", " 7"]) expect(capFromEnv(bad, 300)).toBe(300);
  });
});

describe("capSpec / modelDailyLimit: defaults and env overrides", () => {
  it("defaults: 40 segments per sandbox, 3000 a day; 3 fast-forwards; 5 generations, 300 a day; model ceiling", () => {
    expect(capSpec("segment", {})).toMatchObject({ sandboxKind: "segment_sandbox", sandboxLimit: 40, daily: { kind: "segment_day", limit: 3000 }, model: true });
    expect(capSpec("fast_forward", {})).toMatchObject({ sandboxKind: "fast_forward_sandbox", sandboxLimit: 3, model: false });
    expect(capSpec("fast_forward", {}).daily).toBeUndefined();
    expect(capSpec("generate", {})).toMatchObject({ sandboxKind: "generate_sandbox", sandboxLimit: 5, daily: { kind: "generate_day", limit: 300 }, model: true });
    expect(capSpec("redact", {})).toMatchObject({ sandboxKind: "redact_sandbox", model: true });
    expect(modelDailyLimit({})).toBe(5000);
  });

  it("env overrides (positive integers only)", () => {
    const env = {
      DEMO_SEGMENT_SANDBOX_CAP: "7",
      DEMO_SEGMENT_DAILY_CAP: "70",
      DEMO_FAST_FORWARD_SANDBOX_CAP: "1",
      DEMO_GENERATE_SANDBOX_CAP: "2",
      DEMO_GENERATE_DAILY_CAP: "20",
      DEMO_REDACT_SANDBOX_CAP: "9",
      DEMO_MODEL_DAILY_CAP: "99",
    };
    expect(capSpec("segment", env)).toMatchObject({ sandboxLimit: 7, daily: { limit: 70 } });
    expect(capSpec("fast_forward", env).sandboxLimit).toBe(1);
    expect(capSpec("generate", env)).toMatchObject({ sandboxLimit: 2, daily: { limit: 20 } });
    expect(capSpec("redact", env).sandboxLimit).toBe(9);
    expect(modelDailyLimit(env)).toBe(99);
    expect(capSpec("segment", { DEMO_SEGMENT_SANDBOX_CAP: "abc" }).sandboxLimit).toBe(40);
  });
});

describe("enforceDemoCaps", () => {
  const run = (f: ReturnType<typeof fakeStore>, key: DemoCapKey, env: Record<string, string | undefined> = {}, outlet: Outlet = sandboxOutlet(), now = NOW) =>
    enforceDemoCaps(f.store, { outlet, now_ms: now, key, env });

  it("is inert for an outlet without a sandbox: zero store calls", async () => {
    const f = fakeStore();
    for (const key of ["segment", "generate", "fast_forward", "redact"] as const) await run(f, key, {}, plainOutlet());
    expect(f.calls).toEqual([]);
  });

  it.each([
    ["segment", "demo_segment_cap", "DEMO_SEGMENT_SANDBOX_CAP"],
    ["generate", "demo_generate_cap", "DEMO_GENERATE_SANDBOX_CAP"],
    ["fast_forward", "demo_fast_forward_cap", "DEMO_FAST_FORWARD_SANDBOX_CAP"],
    ["redact", "demo_redact_cap", "DEMO_REDACT_SANDBOX_CAP"],
  ] as const)("%s: the per-sandbox cap is a 429 with its own code and a Retry-After to the sandbox expiry", async (key, code, envName) => {
    const f = fakeStore();
    const env = { [envName]: "2" };
    await run(f, key, env);
    await run(f, key, env);
    const err = await refusal(run(f, key, env, sandboxOutlet(), NOW + 60_000));
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(code);
    expect(err.retryAfterSeconds).toBe(Math.ceil((EXPIRES - (NOW + 60_000)) / 1000));
  });

  it("the cap is per sandbox: another sandbox still passes", async () => {
    const f = fakeStore();
    const env = { DEMO_SEGMENT_SANDBOX_CAP: "1" };
    await run(f, "segment", env);
    await refusal(run(f, "segment", env));
    await run(f, "segment", env, sandboxOutlet("sbx-ffffffffffff"));
  });

  it("a refused sandbox burns nothing later: the daily and model counters are untouched", async () => {
    const f = fakeStore();
    const env = { DEMO_SEGMENT_SANDBOX_CAP: "1" };
    await run(f, "segment", env);
    const day = utcDay(NOW);
    const before = [f.counters.get(`segment_day:${day}`), f.counters.get(`model_day:${day}`)];
    await refusal(run(f, "segment", env));
    expect([f.counters.get(`segment_day:${day}`), f.counters.get(`model_day:${day}`)]).toEqual(before);
  });

  it("the path's daily cap is 429 demo_daily_cap for everyone, with a Retry-After to UTC midnight", async () => {
    const f = fakeStore();
    const env = { DEMO_SEGMENT_DAILY_CAP: "2" };
    await run(f, "segment", env, sandboxOutlet("sbx-aaaaaaaaaaaa"));
    await run(f, "segment", env, sandboxOutlet("sbx-bbbbbbbbbbbb"));
    const err = await refusal(run(f, "segment", env, sandboxOutlet("sbx-cccccccccccc")));
    expect(err.code).toBe("demo_daily_cap");
    expect(err.retryAfterSeconds).toBe(secondsToUtcMidnight(NOW));
    const roll = await run(f, "segment", env, sandboxOutlet("sbx-cccccccccccc"), NOW + 86_400_000).then(() => "ok", () => "refused");
    expect(roll).toBe("ok"); // counters roll over with the UTC day
  });

  it("the shared model-call ceiling spans every model-calling path, and fast-forward (no model call) never touches it", async () => {
    const f = fakeStore();
    const env = { DEMO_MODEL_DAILY_CAP: "3" };
    await run(f, "segment", env);
    await run(f, "generate", env);
    await run(f, "redact", env);
    const err = await refusal(run(f, "segment", env));
    expect(err.code).toBe("demo_model_cap");
    expect(err.retryAfterSeconds).toBe(secondsToUtcMidnight(NOW));
    await run(f, "fast_forward", env); // not a model call
    expect(f.counters.get(`model_day:${utcDay(NOW)}`)).toBe(3);
  });

  it("counter ids carry the sandbox id or the day only (no ip, no key)", async () => {
    const f = fakeStore();
    await run(f, "segment");
    expect(f.bumps.map((b) => b.id)).toEqual([`segment_sandbox:${SBX}`, `segment_day:${utcDay(NOW)}`, `model_day:${utcDay(NOW)}`]);
  });
});

describe("L8 the daily sandbox cap stays below the review run's outlet read", () => {
  it("the default is below OUTLETS_READ_MAX", () => {
    expect(SANDBOX_DAILY).toBeLessThan(OUTLETS_READ_MAX);
    expect(sandboxDailyLimit({})).toBe(SANDBOX_DAILY);
  });

  it("an env override below the limit is used; one at or above it falls back to the default (fail closed) and is logged once", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/demo/caps");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(fresh.sandboxDailyLimit({ DEMO_SANDBOX_DAILY_CAP: "50" })).toBe(50);
    expect(fresh.sandboxDailyLimit({ DEMO_SANDBOX_DAILY_CAP: String(OUTLETS_READ_MAX - 1) })).toBe(OUTLETS_READ_MAX - 1);
    expect(err).not.toHaveBeenCalled();
    for (const bad of [String(OUTLETS_READ_MAX), "10000"]) expect(fresh.sandboxDailyLimit({ DEMO_SANDBOX_DAILY_CAP: bad })).toBe(SANDBOX_DAILY);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});
