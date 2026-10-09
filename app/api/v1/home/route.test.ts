import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import * as dayStoreModule from "@/lib/firestore/day-store";
import type { ConfirmStore, DayStore } from "@/lib/day/service";

/**
 * Same technique as `app/api/v1/day/[date]/route.test.ts`: mocks Firebase
 * Admin's `verifyIdToken` so the route is exercised through the real
 * `requireClaims` guard, and mocks `firestoreDayStore` so no real Firestore
 * is touched.
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

// This fake only needs `DayStore` — the GET /home route never calls
// `transactConfirm`. It is cast to `DayStore & ConfirmStore` solely because
// `firestoreDayStore` (the function this mocks) implements both; the real
// `transactConfirm` test double lives in the confirm route's own test file.
function fakeStore(overrides: Partial<DayStore> = {}): DayStore & ConfirmStore {
  const store: DayStore = {
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
  return store as DayStore & ConfirmStore;
}

function getRequest(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/home", { method: "GET", headers });
}

function call(authorization?: string) {
  return GET(getRequest(authorization));
}

describe("GET /api/v1/home", () => {
  it("no bearer token -> 401", async () => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("supervisor claims -> 403", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u1",
      email: "sup@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-1", role: "supervisor" },
    });
    const response = await call("Bearer sup.token");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("owner claims -> 200 with Cache-Control: private, no-store", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u2",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-1", role: "owner" },
    });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValueOnce(fakeStore());

    const response = await call("Bearer owner.token");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.lines).toEqual([]);
    expect(body.data.more).toBe(0);
  });

  it("firestoreDayStore is constructed with the caller's own outlet_id", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u3",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-9", role: "owner" },
    });
    const spy = vi
      .spyOn(dayStoreModule, "firestoreDayStore")
      .mockReturnValueOnce(fakeStore({ getOutlet: async () => null }));
    await call("Bearer owner.token");
    expect(spy).toHaveBeenCalledWith("outlet-9");
  });
});
