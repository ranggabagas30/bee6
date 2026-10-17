import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import * as homeStoreModule from "@/lib/home/store";
import type { HomeStore } from "@/lib/home/service";

/**
 * Same technique as `app/api/v1/day/[date]/route.test.ts`: mocks Firebase
 * Admin's `verifyIdToken` so the route is exercised through the real
 * `requireClaims` guard, and mocks `firestoreHomeStore` (R-19 PR-8) so no
 * real Firestore is touched.
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/home/store");

afterEach(() => {
  verifyIdToken.mockReset();
  vi.clearAllMocks();
});

function fakeStore(overrides: Partial<HomeStore> = {}): HomeStore {
  const store: HomeStore = {
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
    listUnlabelledQuestions: async () => [],
    countPairedDevices: async () => 0,
    // Not exercised by GET /home (Task 13's own review-queue route owns these).
    listAnsweredGateQuestions: async () => [],
    getThreads: async () => new Map(),
    // R-19 PR-8
    listDecidedProposals: async () => [],
    listAwaitingOwnerProposals: async () => [],
    listSopVersions: async () => [],
    ...overrides,
  };
  return store;
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
    vi.spyOn(homeStoreModule, "firestoreHomeStore").mockReturnValueOnce(fakeStore());

    const response = await call("Bearer owner.token");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.lines).toEqual([]);
    expect(body.data.more).toBe(0);
    // R-19 PR-8: the W4 slices are always present, zero/empty when there is nothing.
    const zero = { approved: 0, rejected: 0 };
    expect(body.data.progress).toEqual({ week: zero, month: zero, since_start: zero });
    expect(body.data.waiting_approval).toEqual({ count: 0, items: [] });
    expect(body.data.next_review).toEqual({ date: null, change_title: null });
  });

  it("owner claims -> the PR-8 slices reflect the store (feasible + approved counted, awaiting_owner listed)", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u2",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-1", role: "owner" },
    });
    const now = Date.now();
    vi.spyOn(homeStoreModule, "firestoreHomeStore").mockReturnValueOnce(
      fakeStore({
        listDecidedProposals: async () => [
          { proposal_id: "11111111-1111-4111-8111-111111111111", status: "approved", supervisor_decision: "feasible", owner_decision: { decision: "approved", decided_at_ms: now }, change_title: "A", created_at_ms: now, updated_at_ms: now },
        ],
        listAwaitingOwnerProposals: async () => [
          { proposal_id: "22222222-2222-4222-8222-222222222222", status: "awaiting_owner", supervisor_decision: "feasible", owner_decision: null, change_title: "Read the order back", created_at_ms: now, updated_at_ms: now },
        ],
        listSopVersions: async () => [{ review_date: "2999-01-01", change_title: "A" }],
      }),
    );
    const response = await call("Bearer owner.token");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.progress.since_start).toEqual({ approved: 1, rejected: 0 });
    expect(body.data.waiting_approval).toEqual({ count: 1, items: [{ proposal_id: "22222222-2222-4222-8222-222222222222", change_title: "Read the order back" }] });
    expect(body.data.next_review).toEqual({ date: "2999-01-01", change_title: "A" });
  });

  it("firestoreHomeStore is constructed with the caller's own outlet_id", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "u3",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "outlet-9", role: "owner" },
    });
    const spy = vi
      .spyOn(homeStoreModule, "firestoreHomeStore")
      .mockReturnValueOnce(fakeStore({ getOutlet: async () => null }));
    const response = await call("Bearer owner.token");
    expect(spy).toHaveBeenCalledWith("outlet-9");
    expect(response.status).toBe(404);
  });
});
