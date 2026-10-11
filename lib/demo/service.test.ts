import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { AppError, ConflictError, LockedError, NotFoundError } from "@/lib/http/errors";
import type { CustomClaims } from "@/lib/auth/roles";
import { checkGenerateCap, capFromEnv, issueDemoSession, type DemoDeps } from "@/lib/demo/service";
import { DemoSessionResponseSchema, type DemoSessionBody } from "@/lib/demo/contract";
import { ipBucketKey, secondsToUtcMidnight, utcDay } from "@/lib/demo/limits";
import { SANDBOX_TTL_MS, TEMPLATE_OUTLET_ID } from "@/lib/demo/constants";
import { fakeStore } from "@/lib/demo/testing/fake-store";
import { templateSet } from "@/lib/demo/testing/fixtures";

const NOW = Date.UTC(2026, 9, 28, 10, 0, 0);
const SALT = "test-salt";
const IP = "203.0.113.77";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function deps(over: Partial<DemoDeps> = {}) {
  const minted: { uid: string; claims: CustomClaims }[] = [];
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const d: DemoDeps = {
    mintToken: async (uid, claims) => {
      minted.push({ uid, claims });
      return `custom-token-for-${uid}`;
    },
    log: (event, fields) => logs.push({ event, fields }),
    ...over,
  };
  return { d, minted, logs };
}

const input = (body: DemoSessionBody, over: Partial<{ ip: string; now_ms: number; demoMode: boolean; salt: string }> = {}) => ({
  body,
  ip: IP,
  now_ms: NOW,
  demoMode: true,
  salt: SALT,
  ...over,
});

const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
afterEach(() => consoleSpies.forEach((s) => s.mockClear()));

const expectCode = async (p: Promise<unknown>, cls: new (...a: never[]) => Error, code: string) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(cls);
  expect((err as AppError).code).toBe(code);
  return err as AppError;
};

describe("capFromEnv", () => {
  it("uses a positive integer override, otherwise the default", () => {
    expect(capFromEnv("50", 300)).toBe(50);
    expect(capFromEnv(undefined, 300)).toBe(300);
    expect(capFromEnv("", 300)).toBe(300);
    expect(capFromEnv("abc", 300)).toBe(300);
    expect(capFromEnv("-4", 300)).toBe(300);
    expect(capFromEnv("0", 300)).toBe(300);
    expect(capFromEnv("1.5", 300)).toBe(300);
  });
});

describe("issueDemoSession: gates", () => {
  it("6.T1 DEMO_MODE unset -> 404 with zero store calls", async () => {
    const f = fakeStore();
    await expectCode(issueDemoSession(f.store, deps().d, input({ role: "owner" }, { demoMode: false })), NotFoundError, "NOT_FOUND");
    await expectCode(
      issueDemoSession(f.store, deps().d, input({ role: "owner", sandbox_key: "A".repeat(43) }, { demoMode: false })),
      NotFoundError,
      "NOT_FOUND",
    );
    expect(f.calls).toEqual([]);
  });

  it("6.T2 a template outlet that is not project_kind demo -> 404, nothing written, no counter touched", async () => {
    const tpl = templateSet();
    tpl.outlet = { ...tpl.outlet, project_kind: "pilot" };
    const f = fakeStore({ template: tpl });
    await expectCode(issueDemoSession(f.store, deps().d, input({ role: "owner" })), NotFoundError, "NOT_FOUND");
    expect(f.written).toEqual([]);
    expect(f.bumps).toEqual([]);
  });

  it("6.T10 a missing template -> 503 demo_not_ready, nothing written; template too large -> 503 template_too_large", async () => {
    const missing = fakeStore({ template: null });
    const err = await expectCode(issueDemoSession(missing.store, deps().d, input({ role: "owner" })), AppError, "demo_not_ready");
    expect(err.statusCode).toBe(503);
    expect(missing.written).toEqual([]);
    expect(missing.bumps).toEqual([]);

    const big = fakeStore();
    big.state.tooLarge = true;
    const e2 = await expectCode(issueDemoSession(big.store, deps().d, input({ role: "owner" })), AppError, "template_too_large");
    expect(e2.statusCode).toBe(503);
    expect(big.written).toEqual([]);
  });

  it("6.T10 an empty DEMO_IP_SALT -> 503 demo_not_ready before any store call, never an unsalted hash", async () => {
    const f = fakeStore();
    const err = await expectCode(issueDemoSession(f.store, deps().d, input({ role: "owner" }, { salt: "" })), AppError, "demo_not_ready");
    expect(err.statusCode).toBe(503);
    expect(f.calls).toEqual([]);
  });

  it("a template that cannot be cloned (no ended debrief) is 503 demo_not_ready, nothing written", async () => {
    const tpl = templateSet();
    const { last_ended: _drop, ...device } = tpl.device;
    const f = fakeStore({ template: { ...tpl, device } });
    await expectCode(issueDemoSession(f.store, deps().d, input({ role: "owner" })), AppError, "demo_not_ready");
    expect(f.written).toEqual([]);
  });
});

describe("issueDemoSession: new sandbox", () => {
  it("6.T4 supervisor: mints exactly {outlet_id, role, demo_exp_ms} for uid demo-supervisor-<sbx>, writes the clone, returns the key", async () => {
    const f = fakeStore();
    const { d, minted } = deps();
    const res = await issueDemoSession(f.store, d, input({ role: "supervisor" }));
    expect(DemoSessionResponseSchema.safeParse(res).success).toBe(true);
    expect(res.kind).toBe("web");
    if (res.kind !== "web") throw new Error("unreachable");
    const outletId = [...f.sandboxes.keys()][0]!;
    expect(outletId).toMatch(/^sbx-[a-f0-9]{12}$/);
    expect(minted).toEqual([
      { uid: `demo-supervisor-${outletId}`, claims: { outlet_id: outletId, role: "supervisor", demo_exp_ms: NOW + SANDBOX_TTL_MS } },
    ]);
    expect(res.custom_token).toBe(`custom-token-for-demo-supervisor-${outletId}`);
    expect(res.landing_path).toBe("/day");
    expect(res.expires_at_ms).toBe(NOW + SANDBOX_TTL_MS);
    expect(res.sandbox_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const outlet = f.sandboxes.get(outletId)!;
    expect(outlet.sandbox).toMatchObject({ template_outlet_id: TEMPLATE_OUTLET_ID, expires_at_ms: NOW + SANDBOX_TTL_MS, key_sha256: sha(res.sandbox_key) });
    expect(f.written.length).toBe(1 + 2 + 1 + 1 + 3 + 6 + 3);
  });

  it("owner lands on /home", async () => {
    const res = await issueDemoSession(fakeStore().store, deps().d, input({ role: "owner" }));
    expect(res.kind === "web" && res.landing_path).toBe("/home");
  });

  it("6.T4 staff: device credentials whose bcrypt hash is the stored token_hash; the judge device id matches the outlet's hex", async () => {
    const f = fakeStore();
    const res = await issueDemoSession(f.store, deps().d, input({ role: "staff" }));
    expect(DemoSessionResponseSchema.safeParse(res).success).toBe(true);
    if (res.kind !== "device") throw new Error("expected device");
    const outletId = [...f.sandboxes.keys()][0]!;
    expect(res.device_id).toBe(`jdg-${outletId.slice(4)}`);
    expect(res.landing_path).toBe("/capture");
    const deviceDoc = f.written.find((w) => w.collection === COLLECTIONS.devices)!;
    expect(deviceDoc.id).toBe(`${outletId}:${res.device_id}`);
    const stored = (deviceDoc.data as { token_hash: string; expires_at_ms: number }).token_hash;
    expect(await bcrypt.compare(res.device_token, stored)).toBe(true);
    expect((deviceDoc.data as { expires_at_ms: number }).expires_at_ms).toBe(NOW + SANDBOX_TTL_MS);
    expect(f.rotations).toEqual([]); // no rotation on creation
  });

  it("each visit gets a fresh key and fresh ids (E1)", async () => {
    const f = fakeStore();
    const a = await issueDemoSession(f.store, deps().d, input({ role: "owner" }));
    const b = await issueDemoSession(f.store, deps().d, input({ role: "owner" }));
    expect(a.sandbox_key).not.toBe(b.sandbox_key);
    expect(f.sandboxes.size).toBe(2);
    const ids = f.written.map((w) => `${w.collection}/${w.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("6.T7 counts the IP (salted daily hash) then the day; the 11th sandbox from one IP is 429 rate_limited with retryAfterSeconds; another IP passes", async () => {
    const f = fakeStore();
    const { d } = deps();
    for (let i = 0; i < 10; i++) await issueDemoSession(f.store, d, input({ role: "owner" }));
    const err = (await expectCode(issueDemoSession(f.store, d, input({ role: "owner" })), LockedError, "rate_limited")) as LockedError;
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBe(secondsToUtcMidnight(NOW));
    expect(f.sandboxes.size).toBe(10);
    await expect(issueDemoSession(f.store, d, input({ role: "owner" }, { ip: "198.51.100.5" }))).resolves.toBeDefined();
    // the IP counter id is the salted daily hash, never the IP
    const ipBump = f.bumps.find((b) => b.kind === undefined || b.id === ipBucketKey(IP, utcDay(NOW), SALT));
    expect(ipBump?.id).toBe(ipBucketKey(IP, utcDay(NOW), SALT));
    expect(f.bumps.some((b) => b.id.includes(IP))).toBe(false);
  });

  it("6.T7 the daily cap is 429 demo_daily_cap for everyone; an env override lowers it; the IP cap is checked first", async () => {
    const f = fakeStore();
    const { d } = deps({ caps: { sandboxDaily: 2 } });
    await issueDemoSession(f.store, d, input({ role: "owner" }, { ip: "1.1.1.1" }));
    await issueDemoSession(f.store, d, input({ role: "owner" }, { ip: "2.2.2.2" }));
    const err = (await expectCode(issueDemoSession(f.store, d, input({ role: "owner" }, { ip: "3.3.3.3" })), LockedError, "demo_daily_cap")) as LockedError;
    expect(err.retryAfterSeconds).toBe(secondsToUtcMidnight(NOW));
    expect(f.sandboxes.size).toBe(2);
    expect(f.bumps.at(-1)).toMatchObject({ id: `sandbox_day:${utcDay(NOW)}`, limit: 2 });
  });

  it("when the IP limit refuses, the daily counter is not touched and nothing is written", async () => {
    const f = fakeStore();
    const { d } = deps();
    for (let i = 0; i < 10; i++) await issueDemoSession(f.store, d, input({ role: "owner" }));
    const dayBefore = f.counters.get(`sandbox_day:${utcDay(NOW)}`);
    await expectCode(issueDemoSession(f.store, d, input({ role: "owner" })), LockedError, "rate_limited");
    expect(f.counters.get(`sandbox_day:${utcDay(NOW)}`)).toBe(dayBefore);
  });

  it("counters roll over with the UTC day", async () => {
    const f = fakeStore();
    const { d } = deps();
    for (let i = 0; i < 10; i++) await issueDemoSession(f.store, d, input({ role: "owner" }));
    await expectCode(issueDemoSession(f.store, d, input({ role: "owner" })), LockedError, "rate_limited");
    await expect(issueDemoSession(f.store, d, input({ role: "owner" }, { now_ms: NOW + 86_400_000 }))).resolves.toBeDefined();
  });

  it("6.T8 lazy cleanup deletes at most 2 expired sandboxes; a cleanup failure does not fail the request", async () => {
    const f = fakeStore({ expired: ["sbx-old1", "sbx-old2", "sbx-old3"] });
    await issueDemoSession(f.store, deps().d, input({ role: "owner" }));
    expect(f.deleted).toEqual(["sbx-old1", "sbx-old2"]);

    const g = fakeStore({ expired: ["sbx-old1"] });
    g.state.failDelete = true;
    const { d, logs } = deps();
    await expect(issueDemoSession(g.store, d, input({ role: "owner" }))).resolves.toBeDefined();
    expect(logs.some((l) => l.event === "cleanup_failed")).toBe(true);
  });

  it("cleanup runs only when a sandbox is created, not on a role switch", async () => {
    const f = fakeStore({ expired: ["sbx-old1"] });
    const first = await issueDemoSession(f.store, deps().d, input({ role: "owner" }));
    f.calls.length = 0;
    await issueDemoSession(f.store, deps().d, input({ role: "supervisor", sandbox_key: first.sandbox_key }));
    expect(f.calls).not.toContain("listExpiredSandboxes");
  });

  it("a failed write tries to delete the half-built sandbox and rethrows", async () => {
    const f = fakeStore();
    f.state.failWrite = true;
    await expect(issueDemoSession(f.store, deps().d, input({ role: "owner" }))).rejects.toThrow("boom");
    expect(f.deleted).toHaveLength(1);
    expect(f.deleted[0]).toMatch(/^sbx-[a-f0-9]{12}$/);
  });
});

describe("issueDemoSession: role switch with a key", () => {
  async function started(role: DemoSessionBody["role"] = "staff") {
    const f = fakeStore();
    const first = await issueDemoSession(f.store, deps().d, input({ role }));
    return { f, first };
  }

  it("6.T5 issues credentials for the new role in the same sandbox, with no second clone and the same expiry", async () => {
    const { f, first } = await started("staff");
    const writesBefore = f.written.length;
    const { d, minted } = deps();
    const res = await issueDemoSession(f.store, d, input({ role: "owner", sandbox_key: first.sandbox_key }, { now_ms: NOW + 10 * 60_000 }));
    expect(f.written.length).toBe(writesBefore);
    expect(f.sandboxes.size).toBe(1);
    expect(res.kind).toBe("web");
    expect(res.expires_at_ms).toBe(NOW + SANDBOX_TTL_MS);
    expect(res.sandbox_key).toBe(first.sandbox_key);
    expect(minted[0]!.claims).toEqual({ outlet_id: [...f.sandboxes.keys()][0], role: "owner", demo_exp_ms: NOW + SANDBOX_TTL_MS });
  });

  it("switching back to staff rotates the judge device token (hash matches the new token) and keeps the device id", async () => {
    const { f, first } = await started("owner");
    const res = await issueDemoSession(f.store, deps().d, input({ role: "staff", sandbox_key: first.sandbox_key }, { now_ms: NOW + 60_000 }));
    if (res.kind !== "device") throw new Error("expected device");
    const outletId = [...f.sandboxes.keys()][0]!;
    expect(f.rotations).toHaveLength(1);
    expect(f.rotations[0]).toMatchObject({ outletId, deviceId: `jdg-${outletId.slice(4)}`, exp: NOW + SANDBOX_TTL_MS });
    expect(res.device_id).toBe(f.rotations[0]!.deviceId);
    expect(await bcrypt.compare(res.device_token, f.rotations[0]!.hash)).toBe(true);
  });

  it("6.T5 the 31st switch is 429 rate_limited with a Retry-After to the sandbox expiry", async () => {
    const { f, first } = await started("owner");
    const { d } = deps();
    for (let i = 0; i < 30; i++) await issueDemoSession(f.store, d, input({ role: "supervisor", sandbox_key: first.sandbox_key }, { now_ms: NOW + 1000 }));
    const err = (await expectCode(
      issueDemoSession(f.store, d, input({ role: "supervisor", sandbox_key: first.sandbox_key }, { now_ms: NOW + 60_000 })),
      LockedError,
      "rate_limited",
    )) as LockedError;
    expect(err.retryAfterSeconds).toBe(Math.ceil((SANDBOX_TTL_MS - 60_000) / 1000));
  });

  it("6.T5 an unknown key is 404 and issues nothing", async () => {
    const f = fakeStore();
    const { d, minted } = deps();
    await expectCode(issueDemoSession(f.store, d, input({ role: "owner", sandbox_key: "Z".repeat(43) })), NotFoundError, "NOT_FOUND");
    expect(minted).toEqual([]);
    expect(f.bumps).toEqual([]);
  });

  it("6.T6 an expired sandbox is 409 SANDBOX_EXPIRED (at the boundary too) and issues nothing", async () => {
    const { f, first } = await started("owner");
    const { d, minted } = deps();
    for (const at of [NOW + SANDBOX_TTL_MS, NOW + SANDBOX_TTL_MS + 1]) {
      const err = await expectCode(issueDemoSession(f.store, d, input({ role: "supervisor", sandbox_key: first.sandbox_key }, { now_ms: at })), ConflictError, "SANDBOX_EXPIRED");
      expect(err.statusCode).toBe(409);
    }
    expect(minted).toEqual([]);
  });
});

describe("issueDemoSession: secrets and privacy", () => {
  it("6.T9 no raw IP, key, token or hash in any stored doc (except key_sha256 and token_hash) or any console call or service log", async () => {
    const f = fakeStore();
    const { d, logs } = deps();
    const res = await issueDemoSession(f.store, d, input({ role: "staff" }));
    if (res.kind !== "device") throw new Error("expected device");
    const switched = await issueDemoSession(f.store, d, input({ role: "owner", sandbox_key: res.sandbox_key }));
    if (switched.kind !== "web") throw new Error("expected web");

    const secrets = [IP, SALT, res.sandbox_key, res.device_token, switched.custom_token, ipBucketKey(IP, utcDay(NOW), SALT), sha(res.sandbox_key)];
    for (const w of f.written) {
      const data = JSON.parse(JSON.stringify(w.data)) as Record<string, unknown>;
      if (w.collection === COLLECTIONS.outlets) delete (data.sandbox as Record<string, unknown>).key_sha256;
      if (w.collection === COLLECTIONS.devices) delete data.token_hash;
      const text = JSON.stringify(data);
      for (const s of secrets) expect(text, `${w.collection} leaks`).not.toContain(s);
    }
    const allLogs = JSON.stringify([logs, ...consoleSpies.map((s) => s.mock.calls)]);
    for (const s of secrets) expect(allLogs).not.toContain(s);
    // counter ids and kinds carry no ip
    expect(JSON.stringify(f.bumps)).not.toContain(IP);
  });

  it("logs the events with the sandbox id and role only", async () => {
    const f = fakeStore();
    const { d, logs } = deps();
    await issueDemoSession(f.store, d, input({ role: "owner" }));
    const created = logs.find((l) => l.event === "sandbox_created")!;
    expect(Object.keys(created.fields)).toEqual(["sandbox"]);
    const issued = logs.find((l) => l.event === "role_issued")!;
    expect(Object.keys(issued.fields).sort()).toEqual(["role", "sandbox"]);
  });

  it("logs a refusal with its code only", async () => {
    const f = fakeStore();
    const { d, logs } = deps();
    await issueDemoSession(f.store, d, input({ role: "owner", sandbox_key: "Z".repeat(43) })).catch(() => {});
    expect(logs.find((l) => l.event === "refused")?.fields).toEqual({ code: "NOT_FOUND" });
  });

  it("the default logger writes to console without secrets", async () => {
    const f = fakeStore();
    const res = await issueDemoSession(f.store, { mintToken: async () => "tok" }, input({ role: "owner" }));
    const text = JSON.stringify(consoleSpies.map((s) => s.mock.calls));
    expect(text).toContain("[demo]");
    expect(text).not.toContain(res.sandbox_key);
    expect(text).not.toContain(IP);
  });
});

describe("checkGenerateCap", () => {
  const sandboxOutlet = async () => {
    const f = fakeStore();
    await issueDemoSession(f.store, deps().d, input({ role: "owner" }));
    f.bumps.length = 0;
    f.calls.length = 0;
    return { f, outlet: [...f.sandboxes.values()][0]! };
  };

  it("is a no-op (zero store calls) for an outlet without a sandbox", async () => {
    const f = fakeStore();
    const outlet = templateSet().outlet;
    await checkGenerateCap(f.store, { outlet, now_ms: NOW });
    expect(f.calls).toEqual([]);
  });

  it("6.T-gen: five generations per sandbox pass, the sixth is 429 demo_generate_cap", async () => {
    const { f, outlet } = await sandboxOutlet();
    for (let i = 0; i < 5; i++) await checkGenerateCap(f.store, { outlet, now_ms: NOW });
    const err = (await expectCode(checkGenerateCap(f.store, { outlet, now_ms: NOW }), LockedError, "demo_generate_cap")) as LockedError;
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(f.bumps[0]).toMatchObject({ id: `generate_sandbox:${outlet.outlet_id}`, limit: 5 });
  });

  it("the daily cap across sandboxes is 429 demo_daily_cap and is overridable", async () => {
    const { f, outlet } = await sandboxOutlet();
    await checkGenerateCap(f.store, { outlet, now_ms: NOW, caps: { generateDaily: 1 } });
    await expectCode(checkGenerateCap(f.store, { outlet, now_ms: NOW, caps: { generateDaily: 1 } }), LockedError, "demo_daily_cap");
    expect(f.bumps.some((b) => b.id === `generate_day:${utcDay(NOW)}`)).toBe(true);
  });

  it("when the sandbox cap refuses, the daily counter is not consumed", async () => {
    const { f, outlet } = await sandboxOutlet();
    for (let i = 0; i < 5; i++) await checkGenerateCap(f.store, { outlet, now_ms: NOW });
    const day = f.counters.get(`generate_day:${utcDay(NOW)}`);
    await checkGenerateCap(f.store, { outlet, now_ms: NOW }).catch(() => {});
    expect(f.counters.get(`generate_day:${utcDay(NOW)}`)).toBe(day);
  });
});
