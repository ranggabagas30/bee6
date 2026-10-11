// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
const signInWithCustomToken = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...a: unknown[]) => signOut(...a),
  signInWithCustomToken: (...a: unknown[]) => signInWithCustomToken(...a),
}));

import {
  DEMO_STATE_KEY,
  clearDemoState,
  closeEndedDemo,
  endDemo,
  demoSnapshot,
  isDemoExpired,
  parseDemoState,
  readDemoState,
  requestDemoSession,
  subscribeDemoState,
  startDemo,
  writeDemoState,
} from "@/app/demo/demo-client";
import { DEVICE_ID_KEY, DEVICE_TOKEN_KEY } from "@/lib/capture/browser/client";

const KEY = "A".repeat(43);
const KEY2 = "B".repeat(43);
const NOW = 1_800_000_000_000;
const EXPIRES = NOW + 2 * 60 * 60_000;
const AUTH = { kind: "fake-auth" } as never;

const WEB_OK = {
  kind: "web" as const,
  role: "supervisor" as const,
  custom_token: "custom-token-1",
  sandbox_key: KEY,
  expires_at_ms: EXPIRES,
  landing_path: "/day",
};
const DEVICE_OK = {
  kind: "device" as const,
  role: "staff" as const,
  device_id: "jdg-abc",
  device_token: "dev-token-1",
  sandbox_key: KEY,
  expires_at_ms: EXPIRES,
  landing_path: "/capture" as const,
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
const ok = (data: unknown) => jsonResponse(200, { data });
const err = (status: number, code: string, headers: Record<string, string> = {}) =>
  jsonResponse(status, { error: { code, message: "x" } }, headers);

// jsdom's localStorage is not available in this vitest setup (same stand-in as app/pair/page.test.tsx).
const memory = new Map<string, string>();
const fakeLocal = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
};

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", fakeLocal);
  signOut.mockReset().mockResolvedValue(undefined);
  signInWithCustomToken.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("demo state (shared across tabs via localStorage)", () => {
  it("round-trips through localStorage so a second tab of this browser sees the same sandbox", () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" });
    expect(fakeLocal.getItem(DEMO_STATE_KEY)).not.toBeNull();
    expect(readDemoState()).toEqual({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" });
  });

  it("reads null for missing, malformed, wrongly shaped or extra-key values", () => {
    expect(readDemoState()).toBeNull();
    fakeLocal.setItem(DEMO_STATE_KEY, "{not json");
    expect(readDemoState()).toBeNull();
    fakeLocal.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: "short", expires_at_ms: 1, role: "owner" }));
    expect(readDemoState()).toBeNull();
    fakeLocal.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: 1, role: "admin" }));
    expect(readDemoState()).toBeNull();
    expect(parseDemoState(JSON.stringify({ sandbox_key: KEY, expires_at_ms: 1, role: "owner", extra: 1 }))).toBeNull();
  });

  it("does not throw when storage is blocked (private mode)", () => {
    for (const method of ["setItem", "getItem", "removeItem"] as const) {
      vi.spyOn(fakeLocal, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    expect(() => writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" })).not.toThrow();
    expect(readDemoState()).toBeNull();
    expect(() => clearDemoState()).not.toThrow();
  });

  it("clearDemoState removes the state and the judge device keys", () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "t");
    fakeLocal.setItem(DEVICE_ID_KEY, "d");
    clearDemoState();
    expect(readDemoState()).toBeNull();
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    expect(fakeLocal.getItem(DEVICE_ID_KEY)).toBeNull();
  });

  it("subscribeDemoState hears another tab's change (a storage event on the demo key) and stops after unsubscribe", () => {
    const onChange = vi.fn();
    const off = subscribeDemoState(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: DEMO_STATE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: null })); // storage.clear() in another tab
    expect(onChange).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "something.else" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new StorageEvent("storage", { key: DEMO_STATE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("isDemoExpired is true at and after the expiry instant", () => {
    const s = { sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" as const };
    expect(isDemoExpired(s, EXPIRES - 1)).toBe(false);
    expect(isDemoExpired(s, EXPIRES)).toBe(true);
  });

  it("demoSnapshot is a stable string that flips when the clock passes the expiry", () => {
    expect(demoSnapshot(NOW)).toBe("");
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" });
    const live = demoSnapshot(NOW);
    expect(demoSnapshot(NOW + 1)).toBe(live);
    expect(demoSnapshot(EXPIRES)).not.toBe(live);
  });
});

describe("requestDemoSession", () => {
  it("POSTs JSON with only role (and the key when given), no auth header, no cookies", async () => {
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    await requestDemoSession("supervisor", KEY, f as never);
    const [path, init] = f.mock.calls[0]!;
    expect(path).toBe("/api/v1/demo/session");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body)).toEqual({ role: "supervisor", sandbox_key: KEY });

    await requestDemoSession("owner", undefined, f as never);
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({ role: "owner" });
  });

  it("parses both success shapes and rejects a malformed 200", async () => {
    expect(await requestDemoSession("supervisor", undefined, (async () => ok(WEB_OK)) as never)).toEqual({ kind: "ok", data: WEB_OK });
    expect(await requestDemoSession("staff", undefined, (async () => ok(DEVICE_OK)) as never)).toEqual({ kind: "ok", data: DEVICE_OK });
    expect(await requestDemoSession("staff", undefined, (async () => ok({ kind: "web" })) as never)).toEqual({ kind: "error" });
    expect(await requestDemoSession("staff", undefined, (async () => new Response("<html>", { status: 200 })) as never)).toEqual({ kind: "error" });
  });

  it("maps 404 without a key to off (demo mode is not on)", async () => {
    expect(await requestDemoSession("owner", undefined, (async () => err(404, "NOT_FOUND")) as never)).toEqual({ kind: "off" });
  });

  it("maps 404 with a key to a gone sandbox, and 409 SANDBOX_EXPIRED to the same", async () => {
    expect(await requestDemoSession("owner", KEY, (async () => err(404, "NOT_FOUND")) as never)).toEqual({ kind: "sandbox_expired" });
    expect(await requestDemoSession("owner", KEY, (async () => err(409, "SANDBOX_EXPIRED")) as never)).toEqual({ kind: "sandbox_expired" });
  });

  it("maps each 429 code with its Retry-After seconds", async () => {
    const run = (code: string, headers: Record<string, string> = {}) =>
      requestDemoSession("owner", undefined, (async () => err(429, code, headers)) as never);
    expect(await run("rate_limited", { "Retry-After": "3600" })).toEqual({ kind: "rate_limited", retryAfterSeconds: 3600 });
    expect(await run("demo_daily_cap", { "Retry-After": "120" })).toEqual({ kind: "daily_cap", retryAfterSeconds: 120 });
    expect(await run("demo_busy", { "Retry-After": "2" })).toEqual({ kind: "busy", retryAfterSeconds: 2 });
    expect(await run("rate_limited")).toEqual({ kind: "rate_limited", retryAfterSeconds: null });
    expect(await run("demo_busy", { "Retry-After": "soon" })).toEqual({ kind: "busy", retryAfterSeconds: null });
    expect(await run("demo_busy", { "Retry-After": "-5" })).toEqual({ kind: "busy", retryAfterSeconds: null });
  });

  it("does not trust prototype keys or unknown 429 codes: both are a generic error", async () => {
    for (const code of ["constructor", "__proto__", "toString", "LOCKED", "demo_generate_cap"]) {
      expect(await requestDemoSession("owner", undefined, (async () => err(429, code)) as never)).toEqual({ kind: "error" });
    }
  });

  it("maps 503 to not_ready and 413/415/422/500/network failures to error", async () => {
    expect(await requestDemoSession("owner", undefined, (async () => err(503, "demo_not_ready")) as never)).toEqual({ kind: "not_ready" });
    expect(await requestDemoSession("owner", undefined, (async () => err(503, "template_too_large")) as never)).toEqual({ kind: "not_ready" });
    for (const status of [400, 413, 415, 422, 500]) {
      expect(await requestDemoSession("owner", undefined, (async () => err(status, "X")) as never)).toEqual({ kind: "error" });
    }
    expect(await requestDemoSession("owner", undefined, (async () => { throw new Error("offline"); }) as never)).toEqual({ kind: "error" });
  });
});

describe("clock skew: the expiry is corrected to this device's clock", () => {
  const H = 60 * 60_000;
  const SERVER_NOW = 1_800_000_000_000;
  const SERVER_EXPIRES = SERVER_NOW + 2 * H;
  const withDate = (dateMs: number | null) =>
    (async () =>
      new Response(JSON.stringify({ data: { ...WEB_OK, expires_at_ms: SERVER_EXPIRES } }), {
        status: 200,
        headers: dateMs === null ? {} : { Date: new Date(dateMs).toUTCString() },
      })) as never;
  const expiryFor = async (deviceNow: number, dateMs: number | null) => {
    const outcome = await requestDemoSession("supervisor", undefined, withDate(dateMs), () => deviceNow);
    if (outcome.kind !== "ok") throw new Error("expected ok");
    return outcome.data.expires_at_ms;
  };

  it("a device clock 3 h fast still ends the demo 2 h after receipt", async () => {
    const deviceNow = SERVER_NOW + 3 * H;
    expect(await expiryFor(deviceNow, SERVER_NOW)).toBe(deviceNow + 2 * H);
  });

  it("a device clock 3 h slow still ends the demo 2 h after receipt", async () => {
    const deviceNow = SERVER_NOW - 3 * H;
    expect(await expiryFor(deviceNow, SERVER_NOW)).toBe(deviceNow + 2 * H);
  });

  it("an accurate clock keeps the server's instant (to the header's one-second grain)", async () => {
    expect(await expiryFor(SERVER_NOW, SERVER_NOW)).toBe(SERVER_EXPIRES);
  });

  it("falls back to the server's own expiry without a Date header, with an unreadable one, or with a silly one", async () => {
    expect(await expiryFor(SERVER_NOW + 3 * H, null)).toBe(SERVER_EXPIRES);
    const garbage = (async () =>
      new Response(JSON.stringify({ data: { ...WEB_OK, expires_at_ms: SERVER_EXPIRES } }), { status: 200, headers: { Date: "not a date" } })) as never;
    const outcome = await requestDemoSession("supervisor", undefined, garbage, () => SERVER_NOW + 3 * H);
    expect(outcome.kind === "ok" && outcome.data.expires_at_ms).toBe(SERVER_EXPIRES);
    // A Date that would make the session last a week (or already be over) is not a clock reading to trust.
    expect(await expiryFor(SERVER_NOW, SERVER_NOW - 7 * 24 * H)).toBe(SERVER_EXPIRES);
    expect(await expiryFor(SERVER_NOW, SERVER_EXPIRES + H)).toBe(SERVER_EXPIRES);
  });

  it("trusts a Date header only when the time left is within the 2 h sandbox life plus 5 min of margin", async () => {
    const limit = 2 * H + 5 * 60_000;
    const deviceNow = SERVER_NOW + 3 * H;
    // Exactly at the limit: the correction applies.
    expect(await expiryFor(deviceNow, SERVER_EXPIRES - limit)).toBe(deviceNow + limit);
    // One second past it, or a few hours past it: not a clock reading to trust, the server's value stays.
    expect(await expiryFor(deviceNow, SERVER_EXPIRES - limit - 1000)).toBe(SERVER_EXPIRES);
    expect(await expiryFor(deviceNow, SERVER_EXPIRES - 3 * H)).toBe(SERVER_EXPIRES);
    expect(await expiryFor(deviceNow, SERVER_EXPIRES - 23 * H)).toBe(SERVER_EXPIRES);
    // Just inside (1 s left) still corrects; none left does not.
    expect(await expiryFor(deviceNow, SERVER_EXPIRES - 1000)).toBe(deviceNow + 1000);
    expect(await expiryFor(deviceNow, SERVER_EXPIRES)).toBe(SERVER_EXPIRES);
  });

  it("startDemo stores the corrected expiry, so the bar's end time and the expiry check use the device's own clock", async () => {
    const deviceNow = SERVER_NOW + 3 * H;
    const f = vi.fn(withDate(SERVER_NOW));
    await startDemo("supervisor", { auth: AUTH, navigate: vi.fn(), fetchImpl: f as never, now: () => deviceNow, onExpired: "restart" });
    const stored = readDemoState()!;
    expect(stored.expires_at_ms).toBe(deviceNow + 2 * H);
    expect(isDemoExpired(stored, deviceNow + 2 * H - 1)).toBe(false);
    expect(isDemoExpired(stored, deviceNow + 2 * H)).toBe(true);
  });
});

describe("startDemo", () => {
  const navigate = vi.fn();
  beforeEach(() => navigate.mockReset());

  it("web role: signs in with the custom token without a signed-out gap, stores the state, navigates, clears device keys", async () => {
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "old");
    fakeLocal.setItem(DEVICE_ID_KEY, "old");
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    const result = await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "started" });
    expect(signInWithCustomToken).toHaveBeenCalledWith(AUTH, "custom-token-1");
    expect(signOut).not.toHaveBeenCalled(); // the new user replaces the old one in one step
    expect(navigate).toHaveBeenCalledWith("/day");
    expect(readDemoState()).toEqual({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "supervisor" });
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    expect(fakeLocal.getItem(DEVICE_ID_KEY)).toBeNull();
    expect(fakeLocal.getItem(DEMO_STATE_KEY)).not.toContain("custom-token-1");
  });

  it("device role: writes both device keys, signs out Firebase, navigates to /capture", async () => {
    const f = vi.fn().mockResolvedValue(ok(DEVICE_OK));
    const result = await startDemo("staff", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "started" });
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBe("dev-token-1");
    expect(fakeLocal.getItem(DEVICE_ID_KEY)).toBe("jdg-abc");
    expect(signOut).toHaveBeenCalledWith(AUTH);
    expect(signInWithCustomToken).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/capture");
    expect(readDemoState()?.role).toBe("staff");
    expect(fakeLocal.getItem(DEMO_STATE_KEY)).not.toContain("dev-token-1");
  });

  it("by default goes to the landing page with a hard navigation (window.location.assign), never a soft one", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    await startDemo("supervisor", { auth: AUTH, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(assign).toHaveBeenCalledExactlyOnceWith("/day");
  });

  it("only navigates to an allow-listed landing path, falling back to the role's own", async () => {
    const f = vi.fn().mockResolvedValue(ok({ ...WEB_OK, landing_path: "//evil.example" }));
    await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(navigate).toHaveBeenCalledWith("/day");
  });

  it("sends the stored key only while it is unexpired", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(JSON.parse(f.mock.calls[0]![1].body).sandbox_key).toBe(KEY);

    const g = vi.fn().mockResolvedValue(ok({ ...WEB_OK, sandbox_key: KEY2 }));
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: g as never, now: () => EXPIRES + 1, onExpired: "restart" });
    expect(JSON.parse(g.mock.calls[0]![1].body)).toEqual({ role: "supervisor" });
  });

  it("onExpired restart: a 409 clears state and device keys and retries exactly once without a key", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "old");
    fakeLocal.setItem(DEVICE_ID_KEY, "old");
    const f = vi
      .fn()
      .mockResolvedValueOnce(err(409, "SANDBOX_EXPIRED"))
      .mockResolvedValueOnce(ok({ ...WEB_OK, sandbox_key: KEY2 }));
    const result = await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "started" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({ role: "supervisor" });
    expect(readDemoState()?.sandbox_key).toBe(KEY2);
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBeNull();
  });

  it("onExpired restart: a second expiry answer does not loop", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    const f = vi.fn().mockImplementation(async () => err(409, "SANDBOX_EXPIRED"));
    const result = await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "sandbox_expired" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("onExpired stop (the bar): a 409 marks the stored sandbox as ended and does not silently create a new one", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "old");
    const f = vi.fn().mockImplementation(async () => err(409, "SANDBOX_EXPIRED"));
    const result = await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "stop" });
    expect(result).toEqual({ kind: "sandbox_expired" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(readDemoState()).toEqual({ expires_at_ms: NOW, role: "staff" }); // kept, as ended, without the key
    expect(fakeLocal.getItem(DEMO_STATE_KEY)).not.toContain(KEY);
    expect(demoSnapshot(NOW).endsWith("|expired")).toBe(true);
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith(AUTH); // no signed-in web user is left behind a forgotten sandbox
  });

  it("onExpired stop: a stored record past its expiry makes NO request at all (no sandbox is created behind the visitor's back)", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "old");
    fakeLocal.setItem(DEVICE_ID_KEY, "old");
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    // The exact window: the clock is at the expiry instant but the bar's timer has not re-rendered yet.
    const result = await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => EXPIRES, onExpired: "stop" });
    expect(result).toEqual({ kind: "sandbox_expired" });
    expect(f).toHaveBeenCalledTimes(0);
    expect(readDemoState()).toEqual({ expires_at_ms: EXPIRES, role: "staff" }); // kept as ended, same end time, no key
    expect(fakeLocal.getItem(DEMO_STATE_KEY)).not.toContain(KEY);
    expect(demoSnapshot(EXPIRES).endsWith("|expired")).toBe(true);
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    expect(fakeLocal.getItem(DEVICE_ID_KEY)).toBeNull();
    expect(signOut).toHaveBeenCalledWith(AUTH);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("onExpired stop: one millisecond before the expiry the request still goes out with the key", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => EXPIRES - 1, onExpired: "stop" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0]![1].body).sandbox_key).toBe(KEY);
  });

  it("onExpired stop: with no stored record at all there is nothing to switch inside, so no request is made", async () => {
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    const result = await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "stop" });
    expect(result).toEqual({ kind: "sandbox_expired" });
    expect(f).toHaveBeenCalledTimes(0);
    expect(readDemoState()).toBeNull();
  });

  it("onExpired restart: an expired stored record still starts a fresh sandbox with no key", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    const f = vi.fn().mockResolvedValue(ok({ ...WEB_OK, sandbox_key: KEY2 }));
    const result = await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => EXPIRES, onExpired: "restart" });
    expect(result).toEqual({ kind: "started" });
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ role: "owner" });
  });

  it("onExpired restart: when the retry is refused too, the web user is signed out (the sandbox is forgotten)", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" });
    const f = vi
      .fn()
      .mockResolvedValueOnce(err(409, "SANDBOX_EXPIRED"))
      .mockResolvedValueOnce(err(429, "rate_limited"));
    const result = await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "rate_limited", retryAfterSeconds: null });
    expect(readDemoState()).toBeNull();
    expect(signOut).toHaveBeenCalledWith(AUTH);
  });

  it("onExpired restart: when the retry works, there is no extra signed-out moment for web roles", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" });
    const f = vi.fn().mockResolvedValueOnce(err(409, "SANDBOX_EXPIRED")).mockResolvedValueOnce(ok({ ...WEB_OK, sandbox_key: KEY2 }));
    await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("endDemo forgets the sandbox, the device keys and the Firebase web user", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" });
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "t");
    await endDemo(AUTH);
    expect(readDemoState()).toBeNull();
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    expect(signOut).toHaveBeenCalledWith(AUTH);
    signOut.mockRejectedValue(new Error("offline"));
    await expect(endDemo(AUTH)).resolves.toBeUndefined();
    await expect(endDemo(null)).resolves.toBeUndefined();
  });

  it("closeEndedDemo keeps the ended record but drops the sandbox key, and the change reaches other listeners", async () => {
    const ended = Date.now() - 1000;
    writeDemoState({ sandbox_key: KEY, expires_at_ms: ended, role: "owner" });
    const onChange = vi.fn();
    const off = subscribeDemoState(onChange);
    await closeEndedDemo(AUTH);
    off();
    expect(readDemoState()).toEqual({ expires_at_ms: ended, role: "owner" });
    expect(fakeLocal.getItem(DEMO_STATE_KEY)).not.toContain(KEY);
    expect(demoSnapshot(Date.now()).endsWith("|expired")).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it("closeEndedDemo on a record that is still live (a switch learned it is gone) ends it now, without the key", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: "owner" });
    await closeEndedDemo(AUTH);
    const ended = readDemoState();
    expect(ended).not.toHaveProperty("sandbox_key");
    expect(isDemoExpired(ended!, Date.now())).toBe(true);
  });

  it("closeEndedDemo is idempotent: a record already without the key is not rewritten", async () => {
    fakeLocal.setItem(DEMO_STATE_KEY, JSON.stringify({ expires_at_ms: NOW - 1000, role: "owner" }));
    const onChange = vi.fn();
    const off = subscribeDemoState(onChange);
    await closeEndedDemo(AUTH);
    off();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an ended record (no key) round-trips, but a record with an extra field or a bad key is still refused", () => {
    expect(parseDemoState(JSON.stringify({ expires_at_ms: 1, role: "owner" }))).toEqual({ expires_at_ms: 1, role: "owner" });
    expect(parseDemoState(JSON.stringify({ expires_at_ms: 1, role: "owner", extra: 1 }))).toBeNull();
    expect(parseDemoState(JSON.stringify({ sandbox_key: "short", expires_at_ms: 1, role: "owner" }))).toBeNull();
  });

  it("a tampered live record with no key never sends a keyless POST from the bar, and a Try-as button starts fresh", async () => {
    fakeLocal.setItem(DEMO_STATE_KEY, JSON.stringify({ expires_at_ms: EXPIRES, role: "owner" }));
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    const stopped = await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "stop" });
    expect(stopped).toEqual({ kind: "sandbox_expired" });
    expect(f).not.toHaveBeenCalled();
    fakeLocal.setItem(DEMO_STATE_KEY, JSON.stringify({ expires_at_ms: EXPIRES, role: "owner" }));
    await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ role: "supervisor" });
  });

  it("closeEndedDemo without any stored demo record touches nothing (a real paired phone keeps its device keys and user)", async () => {
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "real");
    fakeLocal.setItem(DEVICE_ID_KEY, "real");
    await closeEndedDemo({ currentUser: { uid: "demo-owner-x" }, authStateReady: async () => {} } as never);
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBe("real");
    expect(fakeLocal.getItem(DEVICE_ID_KEY)).toBe("real");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("returns the refusal untouched and changes nothing on 429 / 503 / 404", async () => {
    fakeLocal.setItem(DEVICE_TOKEN_KEY, "keep");
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "staff" });
    for (const [status, code, expected] of [
      [429, "rate_limited", { kind: "rate_limited", retryAfterSeconds: null }],
      [429, "demo_daily_cap", { kind: "daily_cap", retryAfterSeconds: null }],
      [503, "demo_not_ready", { kind: "not_ready" }],
    ] as const) {
      const f = vi.fn().mockResolvedValue(err(status, code));
      expect(await startDemo("owner", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" })).toEqual(expected);
    }
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(fakeLocal.getItem(DEVICE_TOKEN_KEY)).toBe("keep");
    expect(readDemoState()?.sandbox_key).toBe(KEY);
  });

  it("a web role without a Firebase config makes no request at all", async () => {
    const f = vi.fn();
    const result = await startDemo("owner", { auth: null, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "error" });
    expect(f).not.toHaveBeenCalled();
  });

  it("a failed custom-token sign-in keeps the previous state and user: the bar never names a role nobody is signed in as", async () => {
    writeDemoState({ sandbox_key: KEY, expires_at_ms: EXPIRES, role: "owner" });
    signInWithCustomToken.mockRejectedValue(new Error("auth/network-request-failed"));
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    const result = await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "stop" });
    expect(result).toEqual({ kind: "error" });
    expect(signOut).not.toHaveBeenCalled(); // the old user is still signed in...
    expect(readDemoState()?.role).toBe("owner"); // ...and the stored state still says so
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a failed custom-token sign-in is an error and stores no state", async () => {
    signInWithCustomToken.mockRejectedValue(new Error("auth/invalid-custom-token"));
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    const result = await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "error" });
    expect(readDemoState()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a failed device-key write is an error and stores no state", async () => {
    vi.spyOn(fakeLocal, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const f = vi.fn().mockResolvedValue(ok(DEVICE_OK));
    const result = await startDemo("staff", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "error" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a Firebase signOut rejection does not block the device path", async () => {
    signOut.mockRejectedValue(new Error("offline"));
    const f = vi.fn().mockResolvedValue(ok(DEVICE_OK));
    const result = await startDemo("staff", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    expect(result).toEqual({ kind: "started" });
  });

  it("never logs tokens or keys", async () => {
    const spies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m as "log").mockImplementation(() => {}));
    const f = vi.fn().mockResolvedValue(ok(WEB_OK));
    await startDemo("supervisor", { auth: AUTH, navigate, fetchImpl: f as never, now: () => NOW, onExpired: "restart" });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
