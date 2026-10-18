import { describe, expect, it, vi } from "vitest";
import { AppError, LockedError } from "@/lib/http/errors";
import type { Outlet } from "@/lib/firestore/schema";
import { capFromEnv, killableCapFromEnv, capSpec, enforceDemoCaps, modelDailyLimit, sandboxDailyLimit, type DemoCapKey } from "@/lib/demo/caps";
import { MODEL_DAILY, SANDBOX_DAILY, SEGMENT_DAILY } from "@/lib/demo/constants";
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
    for (const bad of [undefined, "", "abc", "-4", "0", "1.5", "7 7"]) expect(capFromEnv(bad, 300)).toBe(300);
  });

  it("trims surrounding whitespace and newlines first (a Secret Manager value often ends in \\n)", () => {
    expect(capFromEnv("50\n", 300)).toBe(50);
    expect(capFromEnv(" 7 ", 300)).toBe(7);
    expect(capFromEnv("\n", 300)).toBe(300);
  });
});

describe("killableCapFromEnv: 0 is an explicit kill switch, garbage still falls back (LOW-2)", () => {
  it('exactly "0" is 0; a positive integer is itself; anything else is the default', () => {
    expect(killableCapFromEnv("0", 300)).toBe(0);
    expect(killableCapFromEnv("50", 300)).toBe(50);
    for (const bad of [undefined, "", "abc", "-4", "00", "1.5", "0x0", "0 0", "9".repeat(30)]) expect(killableCapFromEnv(bad, 300)).toBe(300);
  });

  it('a trailing newline or surrounding spaces still mean the kill switch ("0\\n" from Secret Manager)', () => {
    expect(killableCapFromEnv("0\n", 300)).toBe(0);
    expect(killableCapFromEnv(" 0 ", 300)).toBe(0);
    expect(killableCapFromEnv("50\n", 300)).toBe(50);
    expect(killableCapFromEnv("00\n", 300)).toBe(300);
    expect(modelDailyLimit({ DEMO_MODEL_DAILY_CAP: "0\n" })).toBe(0);
  });

  it("capFromEnv itself keeps rejecting 0 (the other caps are not killable)", () => {
    expect(capFromEnv("0", 300)).toBe(300);
  });
});

describe("kill switch: DEMO_*_CAP=0 refuses everything for the model ceiling and segment/generate/redact caps", () => {
  it("capSpec and modelDailyLimit read 0", () => {
    expect(capSpec("segment", { DEMO_SEGMENT_SANDBOX_CAP: "0", DEMO_SEGMENT_DAILY_CAP: "0" })).toMatchObject({ sandboxLimit: 0, daily: { limit: 0 } });
    expect(capSpec("generate", { DEMO_GENERATE_SANDBOX_CAP: "0", DEMO_GENERATE_DAILY_CAP: "0" })).toMatchObject({ sandboxLimit: 0, daily: { limit: 0 } });
    expect(capSpec("redact", { DEMO_REDACT_SANDBOX_CAP: "0" }).sandboxLimit).toBe(0);
    expect(modelDailyLimit({ DEMO_MODEL_DAILY_CAP: "0" })).toBe(0);
  });

  it("fast-forward is not killable: 0 falls back to the default", () => {
    expect(capSpec("fast_forward", { DEMO_FAST_FORWARD_SANDBOX_CAP: "0" }).sandboxLimit).toBe(3);
  });

  it("each switch refuses with its own code and spends no counter at all", async () => {
    const cases: [DemoCapKey, Record<string, string>, string][] = [
      ["segment", { DEMO_SEGMENT_SANDBOX_CAP: "0" }, "demo_segment_cap"],
      ["segment", { DEMO_SEGMENT_DAILY_CAP: "0" }, "demo_daily_cap"],
      ["generate", { DEMO_GENERATE_SANDBOX_CAP: "0" }, "demo_generate_cap"],
      ["generate", { DEMO_GENERATE_DAILY_CAP: "0" }, "demo_daily_cap"],
      ["redact", { DEMO_REDACT_SANDBOX_CAP: "0" }, "demo_redact_cap"],
      ["segment", { DEMO_MODEL_DAILY_CAP: "0" }, "demo_model_cap"],
      ["redact", { DEMO_MODEL_DAILY_CAP: "0" }, "demo_model_cap"],
    ];
    for (const [key, env, code] of cases) {
      const f = fakeStore();
      const err = await refusal(enforceDemoCaps(f.store, { outlet: sandboxOutlet(), now_ms: NOW, key, env }));
      expect(err.statusCode).toBe(429);
      expect(err.code).toBe(code);
      expect(f.bumps).toEqual([]);
    }
  });

  it("the model ceiling at 0 never stops fast-forward (it calls no model)", async () => {
    const f = fakeStore();
    await enforceDemoCaps(f.store, { outlet: sandboxOutlet(), now_ms: NOW, key: "fast_forward", env: { DEMO_MODEL_DAILY_CAP: "0" } });
    expect(f.bumps).toHaveLength(1);
  });

  it("a garbage value is not a kill switch: the default applies", async () => {
    const f = fakeStore();
    await enforceDemoCaps(f.store, { outlet: sandboxOutlet(), now_ms: NOW, key: "segment", env: { DEMO_MODEL_DAILY_CAP: "off", DEMO_SEGMENT_SANDBOX_CAP: "zero" } });
    expect(f.bumps).toHaveLength(3);
  });
});

describe("capSpec fast_forward: a model call only while the ReviewAgent is on (D20)", () => {
  it("model follows REVIEW_AGENT === 'true' exactly", () => {
    expect(capSpec("fast_forward", { REVIEW_AGENT: "true" }).model).toBe(true);
    for (const v of [undefined, "false", "TRUE", "1", ""]) expect(capSpec("fast_forward", { REVIEW_AGENT: v }).model).toBe(false);
    expect(capSpec("fast_forward", {}).model).toBe(false);
  });
  it("the other keys are untouched by the flag", () => {
    expect(capSpec("next_day", { REVIEW_AGENT: "true" }).model).toBe(false);
    expect(capSpec("segment", { REVIEW_AGENT: "false" }).model).toBe(true);
  });
});

describe("capSpec / modelDailyLimit: defaults and env overrides", () => {
  it("defaults: 250 segments per sandbox, 3000 a day; 3 fast-forwards; 8 generations, 300 a day; model ceiling", () => {
    expect(capSpec("segment", {})).toMatchObject({ sandboxKind: "segment_sandbox", sandboxLimit: 250, daily: { kind: "segment_day", limit: 3000 }, model: true });
    expect(capSpec("fast_forward", {})).toMatchObject({ sandboxKind: "fast_forward_sandbox", sandboxLimit: 3, model: false });
    expect(capSpec("fast_forward", {}).daily).toBeUndefined();
    expect(capSpec("generate", {})).toMatchObject({ sandboxKind: "generate_sandbox", sandboxLimit: 8, daily: { kind: "generate_day", limit: 300 }, model: true });
    expect(capSpec("redact", {})).toMatchObject({ sandboxKind: "redact_sandbox", model: true });
    expect(capSpec("next_day", {})).toMatchObject({ sandboxKind: "next_day_sandbox", sandboxLimit: 30, code: "demo_next_day_cap", model: false });
    expect(capSpec("next_day", {}).daily).toBeUndefined();
    expect(capSpec("next_day", { DEMO_NEXT_DAY_SANDBOX_CAP: "0" }).sandboxLimit).toBe(30); // not a kill switch (no model spend)
    expect(capSpec("next_day", { DEMO_NEXT_DAY_SANDBOX_CAP: "5" }).sandboxLimit).toBe(5);
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
    expect(capSpec("segment", { DEMO_SEGMENT_SANDBOX_CAP: "abc" }).sandboxLimit).toBe(250);
  });
});

describe("enforceDemoCaps", () => {
  const run = (f: ReturnType<typeof fakeStore>, key: DemoCapKey, env: Record<string, string | undefined> = {}, outlet: Outlet = sandboxOutlet(), now = NOW) =>
    enforceDemoCaps(f.store, { outlet, now_ms: now, key, env });

  it("fails closed for an outlet without a sandbox object: 503 demo_not_ready, zero store calls", async () => {
    const f = fakeStore();
    for (const key of ["segment", "generate", "fast_forward", "redact"] as const) {
      const err = await run(f, key, {}, plainOutlet()).then(() => null, (e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ statusCode: 503, code: "demo_not_ready" });
    }
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

describe("enforceDemoCaps once-per-id charging (R-23)", () => {
  const MARKER = (id: string, outlet = SBX) => `charge_once:segment:${outlet}:${id}`;
  const once = (f: ReturnType<typeof fakeStore>, id: string, freeRetries = 30, env: Record<string, string | undefined> = {}, outlet: Outlet = sandboxOutlet()) =>
    enforceDemoCaps(f.store, { outlet, now_ms: NOW, key: "segment", env, once: { id, freeRetries } });
  const charges = (f: ReturnType<typeof fakeStore>) => {
    const day = utcDay(NOW);
    return [f.counters.get(`segment_sandbox:${SBX}`), f.counters.get(`segment_day:${day}`), f.counters.get(`model_day:${day}`)];
  };

  it("the first call charges the three counters and writes the marker (count 1)", async () => {
    const f = fakeStore();
    await once(f, "seg-1");
    expect(charges(f)).toEqual([1, 1, 1]);
    expect(f.counters.get(MARKER("seg-1"))).toBe(1);
    expect(f.countBumps).toEqual([{ id: MARKER("seg-1"), kind: "charge_once", limit: 31 }]);
  });

  it("the second call with the same id charges nothing (counters unchanged, marker count 2)", async () => {
    const f = fakeStore();
    await once(f, "seg-1");
    await once(f, "seg-1");
    await once(f, "seg-1");
    expect(charges(f)).toEqual([1, 1, 1]);
    expect(f.counters.get(MARKER("seg-1"))).toBe(3);
  });

  it("a different id charges again", async () => {
    const f = fakeStore();
    await once(f, "seg-1");
    await once(f, "seg-2");
    expect(charges(f)).toEqual([2, 2, 2]);
  });

  it("past the allowance (freeRetries 2: the 4th call) the full charge runs again, every time", async () => {
    const f = fakeStore();
    for (let i = 0; i < 3; i++) await once(f, "seg-1", 2);
    expect(charges(f)).toEqual([1, 1, 1]);
    await once(f, "seg-1", 2); // 4th
    expect(charges(f)).toEqual([2, 2, 2]);
    await once(f, "seg-1", 2); // 5th
    expect(charges(f)).toEqual([3, 3, 3]);
  });

  it("the abuse bound: the 31st retry of one segment (32nd PUT) is charged again with the default allowance of 30", async () => {
    const f = fakeStore();
    for (let i = 0; i < 31; i++) await once(f, "seg-1"); // the first PUT + 30 free retries
    expect(charges(f)).toEqual([1, 1, 1]);
    await once(f, "seg-1"); // the 31st retry
    expect(charges(f)).toEqual([2, 2, 2]);
  });

  it("past the allowance the cap applies: a full sandbox cap refuses the over-allowance retry", async () => {
    const f = fakeStore();
    const env = { DEMO_SEGMENT_SANDBOX_CAP: "1" };
    await once(f, "seg-1", 1, env);
    await once(f, "seg-1", 1, env); // free
    expect((await refusal(once(f, "seg-1", 1, env))).code).toBe("demo_segment_cap");
  });

  it("a kill switch still refuses before the marker is touched", async () => {
    const f = fakeStore();
    for (const env of [{ DEMO_SEGMENT_SANDBOX_CAP: "0" }, { DEMO_SEGMENT_DAILY_CAP: "0" }, { DEMO_MODEL_DAILY_CAP: "0" }]) {
      await refusal(once(f, "seg-1", 30, env));
    }
    expect(f.counters.has(MARKER("seg-1"))).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it("a kill switch set after a segment was charged still refuses its free retries", async () => {
    const f = fakeStore();
    await once(f, "seg-1");
    await refusal(once(f, "seg-1", 30, { DEMO_SEGMENT_SANDBOX_CAP: "0" }));
  });

  it("an already-charged id is free even when the cap is now full; a new id is refused and stays refused", async () => {
    const f = fakeStore();
    const env = { DEMO_SEGMENT_SANDBOX_CAP: "1" };
    await once(f, "A", 30, env);
    await once(f, "A", 30, env); // free
    expect((await refusal(once(f, "B", 30, env))).code).toBe("demo_segment_cap");
    // The refused id left no marker, so retrying it is NOT free (the cap cannot be bypassed by retrying a refusal).
    expect(f.counters.has(MARKER("B"))).toBe(false);
    expect((await refusal(once(f, "B", 30, env))).code).toBe("demo_segment_cap");
    expect(f.counters.get(`segment_sandbox:${SBX}`)).toBe(1);
  });

  it("a refused daily or model charge leaves no marker either", async () => {
    const f = fakeStore();
    await refusal(once(f, "X", 30, { DEMO_SEGMENT_DAILY_CAP: "1" }).then(() => once(f, "Y", 30, { DEMO_SEGMENT_DAILY_CAP: "1" })));
    expect(f.counters.has(MARKER("Y"))).toBe(false);
    const g = fakeStore();
    await once(g, "X", 30, { DEMO_MODEL_DAILY_CAP: "1" });
    await refusal(once(g, "Y", 30, { DEMO_MODEL_DAILY_CAP: "1" }));
    expect(g.counters.has(MARKER("Y"))).toBe(false);
  });

  it("a damaged marker is never a free pass: the full charge runs", async () => {
    const f = fakeStore();
    await once(f, "seg-1");
    // The Firestore store answers MAX_SAFE_INTEGER to readCounter and null to bumpCounterCount for a damaged doc.
    f.counters.set(MARKER("seg-1"), Number.MAX_SAFE_INTEGER);
    await once(f, "seg-1");
    expect(charges(f)).toEqual([2, 2, 2]);
  });

  it("the marker is per sandbox: the same seg id in another sandbox charges", async () => {
    const f = fakeStore();
    await once(f, "seg-1");
    await once(f, "seg-1", 30, {}, sandboxOutlet("sbx-ffffffffffff"));
    expect(f.counters.get(`segment_sandbox:sbx-ffffffffffff`)).toBe(1);
    expect(f.counters.get(MARKER("seg-1", "sbx-ffffffffffff"))).toBe(1);
  });

  it("mode check ignores once: no marker is read or written", async () => {
    const f = fakeStore();
    await enforceDemoCaps(f.store, { outlet: sandboxOutlet(), now_ms: NOW, key: "segment", mode: "check", once: { id: "seg-1", freeRetries: 30 } });
    expect(f.counters.size).toBe(0);
    expect(f.calls.filter((c) => c === "bumpCounterCount")).toEqual([]);
  });

  it("the marker id carries the sandbox id and the seg id only (no ip, no key, no device id)", async () => {
    const f = fakeStore();
    await once(f, "seg-1");
    expect(f.countBumps.map((b) => b.id)).toEqual([`charge_once:segment:${SBX}:seg-1`]);
    expect(f.bumps.map((b) => b.id)).toEqual([`segment_sandbox:${SBX}`, `segment_day:${utcDay(NOW)}`, `model_day:${utcDay(NOW)}`]);
  });

  it("without once, nothing about markers happens (existing callers are unchanged)", async () => {
    const f = fakeStore();
    await enforceDemoCaps(f.store, { outlet: sandboxOutlet(), now_ms: NOW, key: "segment" });
    expect(f.countBumps).toEqual([]);
  });
});

describe("enforceDemoCaps mode 'check' (QA D1: look without charging)", () => {
  const check = (f: ReturnType<typeof fakeStore>, key: DemoCapKey, env: Record<string, string | undefined> = {}) =>
    enforceDemoCaps(f.store, { outlet: sandboxOutlet(), now_ms: NOW, key, env, mode: "check" });
  const charge = (f: ReturnType<typeof fakeStore>, key: DemoCapKey, env: Record<string, string | undefined> = {}) =>
    enforceDemoCaps(f.store, { outlet: sandboxOutlet(), now_ms: NOW, key, env });

  it("passes below the cap and writes no counter at all", async () => {
    const f = fakeStore();
    await check(f, "fast_forward");
    await check(f, "segment");
    expect(f.bumps).toEqual([]);
    expect(f.counters.size).toBe(0);
  });

  it("refuses at the cap with the same code and Retry-After as a charge would", async () => {
    const f = fakeStore();
    const env = { DEMO_FAST_FORWARD_SANDBOX_CAP: "2" };
    await charge(f, "fast_forward", env);
    await charge(f, "fast_forward", env);
    const err = await refusal(check(f, "fast_forward", env));
    expect(err.code).toBe("demo_fast_forward_cap");
    expect(err.retryAfterSeconds).toBe(Math.ceil((EXPIRES - NOW) / 1000));
    expect(f.counters.get(`fast_forward_sandbox:${SBX}`)).toBe(2);
  });

  it("checks the path's daily cap and the model ceiling too, and honours the kill switches", async () => {
    const f = fakeStore();
    await charge(f, "segment", { DEMO_SEGMENT_DAILY_CAP: "1" });
    expect((await refusal(check(f, "segment", { DEMO_SEGMENT_DAILY_CAP: "1" }))).code).toBe("demo_daily_cap");
    expect((await refusal(check(fakeStore(), "segment", { DEMO_MODEL_DAILY_CAP: "0" }))).code).toBe("demo_model_cap");
    expect((await refusal(check(fakeStore(), "segment", { DEMO_SEGMENT_SANDBOX_CAP: "0" }))).code).toBe("demo_segment_cap");
  });

  it("still fails closed for an outlet without a sandbox object", async () => {
    const f = fakeStore();
    const err = await enforceDemoCaps(f.store, { outlet: plainOutlet(), now_ms: NOW, key: "fast_forward", mode: "check" }).then(() => null, (e) => e);
    expect(err).toMatchObject({ statusCode: 503, code: "demo_not_ready" });
  });
});

describe("L8 the daily sandbox cap stays below the review run's outlet read", () => {
  // A sandbox is live >= 26 h, so two UTC days of sandboxes can coexist: 2 * cap + 50 (real outlets) must fit.
  const maxCap = Math.ceil((OUTLETS_READ_MAX - 50) / 2) - 1;

  it("the outlet read holds 1000 and the default fits two days of sandboxes", () => {
    expect(OUTLETS_READ_MAX).toBe(1000);
    expect(2 * SANDBOX_DAILY + 50).toBeLessThan(OUTLETS_READ_MAX);
    expect(sandboxDailyLimit({})).toBe(SANDBOX_DAILY);
  });

  it("an override with 2n + 50 < limit is used; one at or above falls back to the default (fail closed) and is logged once", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/demo/caps");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(fresh.sandboxDailyLimit({ DEMO_SANDBOX_DAILY_CAP: "50" })).toBe(50);
    expect(fresh.sandboxDailyLimit({ DEMO_SANDBOX_DAILY_CAP: String(maxCap) })).toBe(maxCap);
    expect(err).not.toHaveBeenCalled();
    for (const bad of [String(maxCap + 1), String(OUTLETS_READ_MAX - 1), String(OUTLETS_READ_MAX), "10000"]) {
      expect(fresh.sandboxDailyLimit({ DEMO_SANDBOX_DAILY_CAP: bad })).toBe(SANDBOX_DAILY);
    }
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe("sanity upper bound on every cap override (security L3)", () => {
  it("a value above 100000 falls back to the default, in both parsers and through the specs", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/demo/caps");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const bad of ["100001", "3000000", "99999999999"]) {
      expect(fresh.capFromEnv(bad, 300)).toBe(300);
      expect(fresh.killableCapFromEnv(bad, 300)).toBe(300);
    }
    expect(fresh.modelDailyLimit({ DEMO_MODEL_DAILY_CAP: "3000000" })).toBe(MODEL_DAILY);
    expect(fresh.capSpec("segment", { DEMO_SEGMENT_DAILY_CAP: "3000000" }).daily?.limit).toBe(SEGMENT_DAILY);
    err.mockRestore();
  });

  it("100000 itself is accepted; the kill switch 0 and normal values are unchanged", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/demo/caps");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(fresh.capFromEnv("100000", 300)).toBe(100000);
    expect(fresh.killableCapFromEnv("100000\n", 300)).toBe(100000);
    expect(fresh.killableCapFromEnv("0", 300)).toBe(0);
    expect(fresh.capFromEnv("50", 300)).toBe(50);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("is logged once, with no value in the log", async () => {
    vi.resetModules();
    const fresh = await import("@/lib/demo/caps");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fresh.capFromEnv("3000000", 300);
    fresh.killableCapFromEnv("7654321", 300);
    fresh.capFromEnv("100001", 300);
    expect(err).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(err.mock.calls);
    for (const v of ["3000000", "7654321", "100001"]) expect(logged).not.toContain(v);
    err.mockRestore();
  });
});
