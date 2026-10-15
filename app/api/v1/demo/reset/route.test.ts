import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "./route";
import * as resetStoreModule from "@/lib/firestore/demo-reset-store";
import { businessDateOf } from "@/lib/capture/calendar";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { cloneTemplate, sandboxIds } from "@/lib/demo/clone";
import { RESET_PER_SANDBOX, SANDBOX_TTL_MS } from "@/lib/demo/constants";
import { fakeResetStore } from "@/lib/demo/testing/fake-reset-store";
import { templateSet } from "@/lib/demo/testing/fixtures";

vi.mock("@/lib/firestore/demo-reset-store");
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: (...a: unknown[]) => verifyIdToken(...a) }));

/**
 * POST /api/v1/demo/reset (R-19 PR-7, plan 8.4). Owner-only, sandbox-only, DEMO_MODE-only: off demo the route is a
 * 404 before the token is read. The rules are `resetSandbox` (tested in lib/demo/service.reset.test.ts); here the
 * route is exercised end to end against the in-memory store: the order of the gates, the status codes and what
 * the body and the headers say.
 */
const IDS = sandboxIds("0123456789ab", "0123456789ab");
const T0 = Date.UTC(2026, 9, 28, 3, 0, 0);
const NOW = T0 + 20 * 60_000;
const KEY = "c".repeat(64);
const HASH = "$2a$10$routejudgehashroutejudge";
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };
const claimsOf = (over: Record<string, unknown> = {}) => ({ claims: { outlet_id: IDS.outlet_id, role: "owner", demo_exp_ms: T0 + SANDBOX_TTL_MS, ...over } });

function world() {
  const tpl = templateSet();
  const docs = cloneTemplate({ tpl, ids: IDS, now_ms: T0, key_sha256: KEY, device_token_hash: HASH, anchor_business_date: businessDateOf(T0, tpl.outlet.timezone) });
  docs.push({ collection: COLLECTIONS.proposals, id: `${IDS.outlet_id}:p1`, data: { outlet_id: IDS.outlet_id, content: { x: 1 } } });
  return fakeResetStore({ docs });
}

function req(body: unknown, headers: Record<string, string> = { authorization: "Bearer t" }, raw = false) {
  return new NextRequest("http://localhost/api/v1/demo/reset", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const wire = (f: ReturnType<typeof world>) => vi.mocked(resetStoreModule.firestoreResetStore).mockReturnValue(f.store);
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");
const GOOD = { confirm: "reset" };

describe("POST /api/v1/demo/reset off demo (DEMO_MODE not exactly 'true')", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("404 before the token is verified, the body read or any store built; every other method too", async () => {
    for (const v of ["", "1", "TRUE", "false"]) {
      vi.stubEnv("DEMO_MODE", v);
      const res = await POST(req(GOOD));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
      noStore(res);
    }
    for (const handler of [GET, PUT, PATCH, DELETE, OPTIONS]) {
      const res = await handler();
      expect(res.status).toBe(404);
      expect(res.headers.get("Allow")).toBeNull();
    }
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(resetStoreModule.firestoreResetStore).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/demo/reset on demo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEMO_MODE", "true");
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    verifyIdToken.mockResolvedValue(claimsOf());
  });
  afterEach(() => vi.unstubAllEnvs());

  it("other methods are 405 with Allow: POST", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("401 with no bearer and when the token does not verify (a device token is not an ID token); nothing is read", async () => {
    const f = world();
    wire(f);
    expect((await POST(req(GOOD, {}))).status).toBe(401);
    verifyIdToken.mockRejectedValue(new Error("not an ID token"));
    expect((await POST(req(GOOD))).status).toBe(401);
    expect(f.calls).toEqual([]);
  });

  it("an owner of the pilot (not a sandbox outlet) gets the same 404 as off demo, with no store read and the body unread", async () => {
    const f = world();
    wire(f);
    verifyIdToken.mockResolvedValue({ claims: { outlet_id: "proud-pilot-outlet", role: "owner" } });
    const res = await POST(req("{nope", undefined, true));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    noStore(res);
    expect(f.calls).toEqual([]);
  });

  it("a supervisor of a sandbox -> 403 before the body is looked at; nothing deleted", async () => {
    const f = world();
    wire(f);
    verifyIdToken.mockResolvedValue(claimsOf({ role: "supervisor" }));
    const res = await POST(req("{nope", undefined, true));
    expect(res.status).toBe(403);
    expect(f.calls).toEqual(["getOutlet"]);
  });

  it("415 without application/json; 400 on non-JSON; 413 over 1 KB; 422 on a bad body (strict), all after the gates and before any spend", async () => {
    const f = world();
    wire(f);
    expect((await POST(req(GOOD, { authorization: "Bearer t", "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(req("{nope", undefined, true))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ ...GOOD, pad: "x".repeat(1100) }), undefined, true))).status).toBe(413);
    for (const bad of [{}, { confirm: "RESET" }, { confirm: true }, { confirm: "reset", outlet_id: "sbx-other" }, [], "reset"]) {
      const res = await POST(req(bad));
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
    expect(f.calls.every((c) => c === "getOutlet")).toBe(true);
    expect(f.world.size).toBeGreaterThan(5);
  });

  it("the owner's reset -> 200 { data: { reset: true } }, private/no-store, the wipe done with the outlet from the claims", async () => {
    const f = world();
    wire(f);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { reset: true } });
    noStore(res);
    expect([...f.world.values()].some((d) => d.collection === COLLECTIONS.proposals)).toBe(false);
    expect(f.bumps[0]!.id).toBe(`reset_sandbox:${IDS.outlet_id}`);
  });

  it("the response never carries the key hash, the token hash or an id", async () => {
    const f = world();
    wire(f);
    const text = await (await POST(req(GOOD))).text();
    for (const secret of [KEY, HASH, IDS.outlet_id, IDS.device_id]) expect(text).not.toContain(secret);
  });

  it("429 with Retry-After once the per-sandbox cap is spent", async () => {
    const f = world();
    wire(f);
    for (let i = 0; i < RESET_PER_SANDBOX; i += 1) expect((await POST(req(GOOD))).status).toBe(200);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    noStore(res);
  });

  it("409 busy while a pipeline lease is held; 503 reset_failed when the wipe fails (no internals in the body)", async () => {
    const busy = world();
    busy.state.leaseHeld = true;
    wire(busy);
    const r1 = await POST(req(GOOD));
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as { error: { code: string } }).error.code).toBe("busy");

    const failing = world();
    failing.state.failWrite = true;
    wire(failing);
    const r2 = await POST(req(GOOD));
    expect(r2.status).toBe(503);
    const body = (await r2.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("reset_failed");
    expect(JSON.stringify(body)).not.toContain("write failed");
    noStore(r2);
  });
});
