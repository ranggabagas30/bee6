import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  authedGetJson,
  authedPostJson,
  postAuthSession,
} from "@/lib/auth/client/api";

/**
 * R-06 Task 4.3. `authedGetJson` / `authedPostJson` share one private
 * `authedFetch`: no user → signed_out (no fetch); 401 → refresh once, retry;
 * second 401 → signed_out; 403 → forbidden; 422 → invalid; 409 → conflict with
 * `code` from the body (default CONFLICT); anything else, a thrown fetch, or a
 * schema mismatch → error. The bearer token and response body are never logged.
 */

const DataSchema = z.object({ x: z.string() }).strict();

function fakeUser(overrides: { getIdToken: ReturnType<typeof vi.fn> }) {
  return { getIdToken: overrides.getIdToken } as unknown as import("firebase/auth").User;
}

function fakeAuth(user: ReturnType<typeof fakeUser> | null) {
  return { currentUser: user } as unknown as import("firebase/auth").Auth;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  consoleSpies = ["log", "info", "warn", "error"].map((method) =>
    vi.spyOn(console, method as "log").mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authedGetJson", () => {
  it("returns signed_out with no fetch when there is no current user", async () => {
    const fetchImpl = vi.fn();
    const auth = fakeAuth(null);
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "signed_out" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("200 parses body.data with the schema", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok-1");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { x: "ok" } }));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "ok", data: { x: "ok" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(init.cache).toBe("no-store");
  });

  it("401 then 200 refreshes the token once and retries, succeeding", async () => {
    const getIdToken = vi.fn().mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { x: "ok" } }));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "ok", data: { x: "ok" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getIdToken).toHaveBeenCalledTimes(2);
    expect(getIdToken).toHaveBeenNthCalledWith(2, true);
  });

  it("401 twice yields signed_out", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "signed_out" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("403 yields forbidden", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "FORBIDDEN" } }, 403));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "forbidden" });
  });

  it("422 yields invalid", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 422));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "invalid" });
  });

  it("409 yields conflict with the body's error.code", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "GATE_BLOCKED" } }, 409));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "conflict", code: "GATE_BLOCKED" });
  });

  it("409 with no error.code defaults to CONFLICT", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 409));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "conflict", code: "CONFLICT" });
  });

  it("500 yields error", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "error" });
  });

  it("a thrown fetch yields error", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "error" });
  });

  it("non-JSON 200 body yields error", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "error" });
  });

  it("a schema mismatch on 200 yields error", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { wrong: true } }));
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "error" });
  });

  it("a getIdToken rejection yields error", async () => {
    const getIdToken = vi.fn().mockRejectedValue(new Error("boom"));
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn();
    const result = await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "error" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never logs the token or the response body", async () => {
    const getIdToken = vi.fn().mockResolvedValue("super-secret-token");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { x: "ok" } }));
    await authedGetJson(auth, "/api/v1/day/today", DataSchema, fetchImpl);
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("super-secret-token");
      }
    }
  });
});

describe("authedPostJson", () => {
  // Demo feedback 2 item 18: a 429 (a demo cap, a lockout) is still `error`, but now carries the server's code so a
  // caller that cares (the chained Ask) can say "limit reached"; every other error stays exactly `{ kind: "error" }`.
  it("429 yields error carrying the server's error code; a 429 without one is the plain error", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const capped = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "demo_generate_cap" } }, 429));
    expect(await authedPostJson(auth, "/api/v1/proposals/generate", {}, DataSchema, capped)).toEqual({ kind: "error", code: "demo_generate_cap" });
    const bare = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    expect(await authedPostJson(auth, "/api/v1/proposals/generate", {}, DataSchema, bare)).toEqual({ kind: "error" });
  });

  it("sends method POST, JSON content type and a stringified body", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok-1");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { x: "ok" } }));
    const result = await authedPostJson(
      auth,
      "/api/v1/threads/h1/confirm",
      { action: "confirm" },
      DataSchema,
      fetchImpl,
    );
    expect(result).toEqual({ kind: "ok", data: { x: "ok" } });
    const [, init] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(init.body).toBe(JSON.stringify({ action: "confirm" }));
  });

  it("401 then 200 refreshes the token once and retries", async () => {
    const getIdToken = vi.fn().mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { x: "ok" } }));
    const result = await authedPostJson(auth, "/api/v1/x", {}, DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "ok", data: { x: "ok" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getIdToken).toHaveBeenNthCalledWith(2, true);
  });

  it("201 parses body.data with the schema (a route that created a new resource, e.g. proposals/generate)", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok-1");
    const auth = fakeAuth(fakeUser({ getIdToken }));
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { x: "ok" } }, 201));
    const result = await authedPostJson(auth, "/api/v1/proposals/generate", {}, DataSchema, fetchImpl);
    expect(result).toEqual({ kind: "ok", data: { x: "ok" } });
  });
});

describe("postAuthSession", () => {
  function fakeSessionUser(overrides: { getIdToken: ReturnType<typeof vi.fn> }) {
    return { getIdToken: overrides.getIdToken } as unknown as import("firebase/auth").User;
  }

  it("200 force-refreshes the token and returns ok", async () => {
    const getIdToken = vi.fn().mockResolvedValue("fresh");
    const user = fakeSessionUser({ getIdToken });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { outlet_id: "o1", role: "owner" } }));
    const result = await postAuthSession(user, fetchImpl);
    expect(result).toBe("ok");
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it("401 returns denied", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const user = fakeSessionUser({ getIdToken });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401));
    expect(await postAuthSession(user, fetchImpl)).toBe("denied");
  });

  it("403 returns denied", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const user = fakeSessionUser({ getIdToken });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "FORBIDDEN" } }, 403));
    expect(await postAuthSession(user, fetchImpl)).toBe("denied");
  });

  it("a thrown fetch returns network", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const user = fakeSessionUser({ getIdToken });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await postAuthSession(user, fetchImpl)).toBe("network");
  });

  it("anything else returns error", async () => {
    const getIdToken = vi.fn().mockResolvedValue("tok");
    const user = fakeSessionUser({ getIdToken });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500));
    expect(await postAuthSession(user, fetchImpl)).toBe("error");
  });
});
