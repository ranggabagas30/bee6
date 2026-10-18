import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "./route";
import * as servicesModule from "@/lib/auth/services";
import * as demoStoreModule from "@/lib/firestore/demo-store";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { UnauthorizedError } from "@/lib/http/errors";
import { fakeNextDayStore } from "@/lib/demo/testing/fake-next-day-store";
import { NEXT_DAY_REFUSALS } from "@/lib/demo/contract";
import { businessDateOf } from "@/lib/capture/calendar";
import type { Outlet } from "@/lib/firestore/schema";
import { NEXT_DAY_PER_SANDBOX } from "@/lib/demo/constants";

vi.mock("@/lib/auth/services");
vi.mock("@/lib/firestore/stores", () => ({ firestoreDeviceStore: () => ({}) }));
vi.mock("@/lib/firestore/demo-store");
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: (...a: unknown[]) => verifyIdToken(...a) }));

/**
 * POST /api/v1/demo/next-day (R-19 PR-2, plan section 4). Device-only, sandbox-only, DEMO_MODE-only: off demo
 * the route is a 404 before the token is read. The guards and the shift are `runNextDay` (tested in
 * lib/demo/next-day.test.ts); here the route is exercised end to end against the in-memory store.
 */
const SBX = "sbx-0123456789ab";
const JDG = "jdg-0123456789ab";
const T0 = Date.UTC(2026, 9, 14, 3, 0, 0);
const TZ = "Asia/Jakarta";
const S1 = "11111111-1111-4111-8111-111111111111";
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };

const outlet = (over: Partial<Outlet> = {}): Outlet => ({
  outlet_id: SBX, name: "Sandbox", project_kind: "demo", timezone: TZ, opening_time: "07:00", closing_time: "21:45", created_at: "2026-10-01T00:00:00.000Z",
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: T0 - 1, expires_at_ms: T0 + 7_200_000, key_sha256: "a".repeat(64) },
  ...over,
});
const endedToday = { business_date: businessDateOf(T0, TZ), end_reason: "selesai" as const, ended_at_ms: T0 - 10 * 60_000, debrief_ends_at_ms: T0 + 50 * 60_000 };

function req(body: unknown, headers: Record<string, string> = { authorization: "Bearer t", "x-device-id": JDG }, raw = false) {
  return new NextRequest("http://localhost/api/v1/demo/next-day", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function wire(f: ReturnType<typeof fakeNextDayStore>, outletId = SBX) {
  verifyIdToken.mockRejectedValue(new Error("not an ID token"));
  vi.mocked(servicesModule.authenticateDeviceToken).mockResolvedValue({ outlet_id: outletId, role: "device", device_id: JDG } as never);
  vi.mocked(demoStoreModule.firestoreNextDayStore).mockReturnValue(f.store);
}
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

describe("POST /api/v1/demo/next-day off demo (DEMO_MODE not exactly 'true')", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("404 before the token is verified, the body read or any store built; every other method too", async () => {
    for (const v of ["", "1", "TRUE", "false"]) {
      vi.stubEnv("DEMO_MODE", v);
      const res = await POST(req({ expected_day: 1, confirm_unanswered: true }));
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
    expect(servicesModule.authenticateDeviceToken).not.toHaveBeenCalled();
    expect(demoStoreModule.firestoreNextDayStore).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/demo/next-day on demo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEMO_MODE", "true");
    vi.spyOn(Date, "now").mockReturnValue(T0);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("other methods are 405 with Allow: POST", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("401 with no bearer; 401 when the device token does not verify; 403 for a supervisor ID token (G2)", async () => {
    expect((await POST(req({ expected_day: 1, confirm_unanswered: true }, {}))).status).toBe(401);
    verifyIdToken.mockRejectedValue(new Error("not an ID token"));
    vi.mocked(servicesModule.authenticateDeviceToken).mockRejectedValue(new UnauthorizedError("Invalid device token"));
    expect((await POST(req({ expected_day: 1, confirm_unanswered: true }))).status).toBe(401);
    verifyIdToken.mockResolvedValue({ claims: { outlet_id: SBX, role: "supervisor", demo_exp_ms: T0 + 1 } });
    expect((await POST(req({ expected_day: 1, confirm_unanswered: true }))).status).toBe(403);
    expect(demoStoreModule.firestoreNextDayStore).not.toHaveBeenCalled();
  });

  it("404 for a device whose outlet is not a sandbox (G1), after auth, with no guard read", async () => {
    const f = fakeNextDayStore({ outlet: { ...outlet({ outlet_id: "outlet-1" }), sandbox: undefined } });
    wire(f, "outlet-1");
    const res = await POST(req({ expected_day: 1, confirm_unanswered: true }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(f.calls).toEqual(["getOutlet:outlet-1"]);
  });

  it("415 without application/json; 400 on non-JSON; 413 over 1 KB; 422 on a bad body (strict), before any store read", async () => {
    const f = fakeNextDayStore({ outlet: outlet(), last_ended: endedToday });
    wire(f);
    expect((await POST(req({ expected_day: 1, confirm_unanswered: true }, { authorization: "Bearer t", "x-device-id": JDG, "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(req("{nope", undefined, true))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ expected_day: 1, confirm_unanswered: true, pad: "x".repeat(1100) }), undefined, true))).status).toBe(413);
    for (const bad of [{}, { expected_day: 5, confirm_unanswered: true }, { expected_day: 1 }, { expected_day: 1, confirm_unanswered: true, extra: 1 }, { expected_day: "1", confirm_unanswered: true }]) {
      const res = await POST(req(bad));
      expect(res.status, JSON.stringify(bad)).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
    expect(f.calls).toEqual([]);
  });

  it("each refusal is a 409 {error:{code, message, details?}} with a NextDayRefusal code", async () => {
    const seen = new Set<string>();
    const cases: [string, ReturnType<typeof fakeNextDayStore>, unknown][] = [
      ["session_open", fakeNextDayStore({ outlet: outlet(), last_ended: endedToday, docs: { [COLLECTIONS.captureSessions]: { s: { outlet_id: SBX, device_id: JDG, ended_at_ms: null } } } }), { expected_day: 1, confirm_unanswered: true }],
      ["day_not_ended", fakeNextDayStore({ outlet: outlet(), last_ended: null }), { expected_day: 1, confirm_unanswered: true }],
      ["preparing", fakeNextDayStore({ outlet: outlet(), last_ended: { ...endedToday, ended_at_ms: T0 - 1000 }, docs: { [COLLECTIONS.captureSessions]: { s: { outlet_id: SBX, device_id: JDG, session_id: S1, ended_at_ms: T0 - 1000, end_reason: "selesai" } }, [COLLECTIONS.segments]: { a: { outlet_id: SBX, device_id: JDG, seg_id: "seg1", session_id: S1, lines: [{ text: "x" }] } } } }), { expected_day: 1, confirm_unanswered: true }],
      ["unanswered_questions", fakeNextDayStore({ outlet: outlet(), last_ended: endedToday, docs: { [COLLECTIONS.questions]: { q: { outlet_id: SBX, device_id: JDG, status: "open", created_at_ms: T0 } } } }), { expected_day: 1, confirm_unanswered: false }],
      ["proposal_exists", fakeNextDayStore({ outlet: outlet(), last_ended: endedToday, docs: { [COLLECTIONS.proposals]: { p: { outlet_id: SBX, content: {} } } } }), { expected_day: 1, confirm_unanswered: true }],
      ["shift_incomplete", fakeNextDayStore({ outlet: outlet({ sandbox: { ...outlet().sandbox!, shift_started_at_ms: T0 - 600_000 } }), last_ended: endedToday }), { expected_day: 1, confirm_unanswered: true }],
      ["busy", fakeNextDayStore({ outlet: outlet(), last_ended: endedToday, proposal_lock_expires_at_ms: T0 + 1 }), { expected_day: 1, confirm_unanswered: true }],
      // The after days (review-agent plan D3/D4): day 3 -> 4 needs an approved change and no review yet.
      ["approve_first", fakeNextDayStore({ outlet: outlet({ sandbox: { ...outlet().sandbox!, next_day_count: 2 } }), last_ended: endedToday, docs: { [COLLECTIONS.proposals]: { p: { outlet_id: SBX, status: "awaiting_owner", content: {} } } } }), { expected_day: 3, confirm_unanswered: true }],
      ["review_exists", fakeNextDayStore({ outlet: outlet({ sandbox: { ...outlet().sandbox!, next_day_count: 2 } }), last_ended: endedToday, docs: { [COLLECTIONS.sopVersions]: { v2: { outlet_id: SBX, source: "proposal" } }, [COLLECTIONS.reviews]: { r: { outlet_id: SBX, status: "awaiting_supervisor" } } } }), { expected_day: 3, confirm_unanswered: true }],
    ];
    for (const [code, f, body] of cases) {
      wire(f);
      const res = await POST(req(body));
      const json = (await res.json()) as { error: { code: string; message: string; details?: unknown } };
      expect(res.status, code).toBe(409);
      expect(json.error.code, code).toBe(code);
      expect(typeof json.error.message).toBe("string");
      noStore(res);
      if (code === "unanswered_questions") expect(json.error.details).toEqual({ unanswered: 1 });
      else expect(json.error).not.toHaveProperty("details");
      expect(JSON.stringify(json)).not.toContain(JDG);
      seen.add(code);
    }
    // max_days is unreachable through the 1..4 contract (day 5 taps are stale 200s, tested below); the copy key stays as a defence.
    expect([...seen].sort()).toEqual(NEXT_DAY_REFUSALS.filter((c) => c !== "max_days").sort());
  });

  it("on day 3 a tap (expected_day 2, e.g. a retry after a lost 200) is 200 {day: 3}, not a refusal, and writes nothing", async () => {
    const f = fakeNextDayStore({ outlet: outlet({ sandbox: { ...outlet().sandbox!, next_day_count: 2 } }), last_ended: endedToday });
    wire(f);
    const res = await POST(req({ expected_day: 2, confirm_unanswered: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { day: 3 } });
    expect(f.state.written).toEqual([]);
    expect(f.calls).not.toContain("takeShiftMarker");
  });

  it("on day 5 a tap (expected_day 4, a retry after a lost 200) is 200 {day: 5}, not max_days, and writes nothing", async () => {
    const f = fakeNextDayStore({ outlet: outlet({ sandbox: { ...outlet().sandbox!, next_day_count: 4 } }), last_ended: endedToday });
    wire(f);
    const res = await POST(req({ expected_day: 4, confirm_unanswered: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { day: 5 } });
    expect(f.state.written).toEqual([]);
    expect(f.calls).not.toContain("takeShiftMarker");
  });

  it("200 {day: 2}: the sandbox's next_day_count is written, the day's docs move back a day; a double tap is 200 {day: 2} with no second shift", async () => {
    const f = fakeNextDayStore({
      outlet: outlet(),
      last_ended: endedToday,
      docs: { [COLLECTIONS.captureSessions]: { [`${JDG}:${S1}`]: { outlet_id: SBX, device_id: JDG, session_id: S1, started_at_ms: T0 - 900_000, ended_at_ms: T0 - 600_000, end_reason: "selesai", local_date: endedToday.business_date } } },
    });
    wire(f);
    const res = await POST(req({ expected_day: 1, confirm_unanswered: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { day: 2 } });
    noStore(res);
    expect(f.state.outlet?.sandbox).toMatchObject({ next_day_count: 1, shift_started_at_ms: null });
    expect(f.cols.get(COLLECTIONS.captureSessions)!.get(`${JDG}:${S1}`)!.local_date).toBe("2026-10-13");
    expect(f.state.last_ended?.business_date).toBe("2026-10-13");

    const writesBefore = f.state.written.length;
    const again = await POST(req({ expected_day: 1, confirm_unanswered: true }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ data: { day: 2 } });
    expect(f.state.written).toHaveLength(writesBefore);
    expect(f.state.outlet?.sandbox?.next_day_count).toBe(1);
  });

  it("stale tap: 200 {day} after one outlet read, with no guard-state read; stale taps count against the per-sandbox cap", async () => {
    const f = fakeNextDayStore({ outlet: outlet({ sandbox: { ...outlet().sandbox!, next_day_count: 1 } }), last_ended: endedToday });
    wire(f);
    const res = await POST(req({ expected_day: 1, confirm_unanswered: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { day: 2 } });
    expect(f.calls).toEqual([`getOutlet:${SBX}`, "bumpCounter"]);
  });

  it("429 demo_next_day_cap with Retry-After once the sandbox used its calls; nothing else is read or written", async () => {
    const f = fakeNextDayStore({ outlet: outlet(), last_ended: endedToday, counters: { [`next_day_sandbox:${SBX}`]: NEXT_DAY_PER_SANDBOX } });
    wire(f);
    const res = await POST(req({ expected_day: 1, confirm_unanswered: true }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7200");
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("demo_next_day_cap");
    expect(typeof json.error.message).toBe("string");
    noStore(res);
    expect(f.calls).toEqual([`getOutlet:${SBX}`, "bumpCounter"]);
    expect(f.state.written).toEqual([]);
  });

  it("the cap is checked after auth and body validation: a bad body at the cap is still 422 and spends nothing", async () => {
    const f = fakeNextDayStore({ outlet: outlet(), last_ended: endedToday, counters: { [`next_day_sandbox:${SBX}`]: NEXT_DAY_PER_SANDBOX } });
    wire(f);
    expect((await POST(req({ expected_day: 5, confirm_unanswered: true }))).status).toBe(422);
    expect(f.calls).toEqual([]);
  });
});
