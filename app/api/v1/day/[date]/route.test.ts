import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import * as dayStoreModule from "@/lib/firestore/day-store";
import type { DayStore } from "@/lib/day/service";

/**
 * Mocks Firebase Admin's `verifyIdToken` (the same technique as
 * `lib/http/guard.requireClaims.test.ts`) so the route is exercised through
 * the real `requireClaims` guard, not a stubbed one — and mocks
 * `firestoreDayStore` so no real Firestore is touched.
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/firestore/day-store");

afterEach(() => {
  verifyIdToken.mockReset();
  vi.clearAllMocks();
});

function fakeStore(overrides: Partial<DayStore> = {}): DayStore {
  return {
    getOutlet: async () => ({
      outlet_id: "outlet-1",
      name: "Test Outlet",
      project_kind: "demo",
      timezone: "Asia/Jakarta",
      opening_time: "09:30",
      closing_time: "01:00",
      retention_days: 14,
      created_at: "2026-09-01T00:00:00.000Z",
    }),
    listSessions: async () => [],
    listThreads: async () => [],
    getQuestions: async () => new Map(),
    getCorrections: async () => new Map(),
    countPairedDevices: async () => 0,
    ...overrides,
  };
}

function getRequest(date: string, authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest(`http://localhost/api/v1/day/${date}`, { method: "GET", headers });
}

function call(date: string, authorization?: string) {
  return GET(getRequest(date, authorization), { params: Promise.resolve({ date }) });
}

describe("GET /api/v1/day/{date}", () => {
  it("no bearer token -> 401", async () => {
    const response = await call("today");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  // Skipped on THIS branch only: `requireClaims` on `origin/develop` does not
  // yet catch a rejecting `verifyIdToken` (it maps to 500, not 401) — that
  // fix is PR-1's Task 1 (`lib/http/guard.ts`), built in parallel on a
  // sibling branch, not landed here. The route itself needs no change once
  // Task 1 merges: un-skip this to confirm. See R-06 plan §0 item 2 / Task 1.
  it.skip("verifyIdToken throws -> 401 (never 500) — needs PR-1 Task 1 merged", async () => {
    verifyIdToken.mockRejectedValueOnce(new Error("auth/id-token-expired"));
    const response = await call("today", "Bearer bad.token");
    expect(response.status).toBe(401);
  });

  it("a token with no outlet/role claims (never linked) -> 401", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u1",
      email: "nobody@proofed.test",
      email_verified: true,
      claims: {},
    });
    const response = await call("today", "Bearer unlinked.token");
    expect(response.status).toBe(401);
  });

  it("device-role claims -> 403", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u2",
      email: undefined,
      email_verified: false,
      claims: { outlet_id: "outlet-1", role: "device", device_id: "dev-1" },
    });
    const response = await call("today", "Bearer device.token");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("owner claims -> 200 with Cache-Control: private, no-store", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u3",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-1", role: "owner" },
    });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeStore());

    const response = await call("today", "Bearer owner.token");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.view).toBe("owner");
  });

  it("an impossible calendar date -> 422 VALIDATION_ERROR, with no-store", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u4",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-1", role: "owner" },
    });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeStore());

    const response = await call("2026-02-30", "Bearer owner.token");
    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("firestoreDayStore is constructed with the caller's own outlet_id", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u5",
      email: "sup@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-9", role: "supervisor" },
    });
    const spy = vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(
      fakeStore({ getOutlet: async () => null }),
    );
    await call("today", "Bearer sup.token");
    expect(spy).toHaveBeenCalledWith("outlet-9");
  });
});
