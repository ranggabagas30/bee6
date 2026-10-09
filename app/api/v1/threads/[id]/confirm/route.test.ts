import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as dayStoreModule from "@/lib/firestore/day-store";
import * as threadHandleModule from "@/lib/day/thread-handle";
import type { DayStore } from "@/lib/day/service";

/**
 * Same mocking technique as `app/api/v1/day/[date]/route.test.ts`: real
 * `requireClaims` guard over a mocked `verifyIdToken`, and a mocked
 * `firestoreDayStore` so no real Firestore is touched. `readThreadHandleKey`
 * is also mocked so each test controls whether the server has a key, and
 * `sealThreadHandle`'s real implementation builds a handle that
 * `confirmThreadLabel` can actually open against that same (fake) key.
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/firestore/day-store");
vi.mock("@/lib/day/thread-handle", async () => {
  const actual = await vi.importActual<typeof threadHandleModule>("@/lib/day/thread-handle");
  return { ...actual, readThreadHandleKey: vi.fn() };
});

const KEY = Buffer.alloc(32, 9);
const OUTLET = "outlet-1";
const THREAD_ID = "unit_dev-1_w1:0";

afterEach(() => {
  verifyIdToken.mockReset();
  vi.clearAllMocks();
});

function supervisorClaims() {
  verifyIdToken.mockResolvedValueOnce({
    uid: "u1",
    email: "supervisor@proofed.test",
    email_verified: true,
    claims: { outlet_id: OUTLET, role: "supervisor" },
  });
}

function ownerClaims() {
  verifyIdToken.mockResolvedValueOnce({
    uid: "u2",
    email: "owner@proofed.test",
    email_verified: true,
    claims: { outlet_id: OUTLET, role: "owner" },
  });
}

function fakeStore(overrides: Partial<DayStore> = {}): DayStore {
  return {
    getOutlet: async () => null,
    listSessions: async () => [],
    listThreads: async () => [],
    getQuestions: async () => new Map(),
    getCorrections: async () => new Map(),
    countPairedDevices: async () => 0,
    transactConfirm: async () => ({ kind: "not_found" }),
    ...overrides,
  };
}

function call(handle: string, body: unknown, authorization?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  const req = new NextRequest(`http://localhost/api/v1/threads/${encodeURIComponent(handle)}/confirm`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: handle }) });
}

function callRaw(handle: string, rawBody: string, authorization?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  const req = new NextRequest(`http://localhost/api/v1/threads/${encodeURIComponent(handle)}/confirm`, {
    method: "POST",
    headers,
    body: rawBody,
  });
  return POST(req, { params: Promise.resolve({ id: handle }) });
}

describe("POST /api/v1/threads/{id}/confirm", () => {
  it("no bearer token -> 401", async () => {
    const response = await call("whatever", { action: "confirm" });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("owner claims -> 403", async () => {
    ownerClaims();
    vi.spyOn(threadHandleModule, "readThreadHandleKey").mockReturnValue(KEY);
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValue(fakeStore());

    const response = await call("whatever", { action: "confirm" }, "Bearer owner.token");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("non-JSON body -> 400", async () => {
    supervisorClaims();
    vi.spyOn(threadHandleModule, "readThreadHandleKey").mockReturnValue(KEY);
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValue(fakeStore());

    const response = await callRaw("whatever", "{not json", "Bearer supervisor.token");
    expect(response.status).toBe(400);
  });

  it("key not configured -> 503", async () => {
    supervisorClaims();
    vi.spyOn(threadHandleModule, "readThreadHandleKey").mockReturnValue(null);
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValue(fakeStore());

    const response = await call("whatever", { action: "confirm" }, "Bearer supervisor.token");
    expect(response.status).toBe(503);
  });

  it("a 409-conflict plan (NOT_REVIEWABLE) surfaces error.code === NOT_REVIEWABLE", async () => {
    supervisorClaims();
    const { sealThreadHandle } = await vi.importActual<typeof threadHandleModule>("@/lib/day/thread-handle");
    const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
    vi.spyOn(threadHandleModule, "readThreadHandleKey").mockReturnValue(KEY);
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValue(
      fakeStore({ transactConfirm: async () => ({ kind: "not_reviewable" }) }),
    );

    const response = await call(handle, { action: "confirm" }, "Bearer supervisor.token");
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_REVIEWABLE");
  });

  it("success -> 200, no-store, and no response body contains the thread id", async () => {
    supervisorClaims();
    const { sealThreadHandle } = await vi.importActual<typeof threadHandleModule>("@/lib/day/thread-handle");
    const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
    vi.spyOn(threadHandleModule, "readThreadHandleKey").mockReturnValue(KEY);
    const store = fakeStore({
      transactConfirm: async () => ({
        kind: "write",
        thread_patch: {},
        audit: {
          actor_role: "supervisor",
          action: "thread.supervisor_confirm",
          target_type: "thread",
          target_id: THREAD_ID,
          details: {},
        },
        response: { result: "confirmed", category: "COMPLAINT", display_status: "fact_supervisor_confirmed" },
      }),
    });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValue(store);

    const response = await call(handle, { action: "confirm" }, "Bearer supervisor.token");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).not.toContain(THREAD_ID);
  });

  it("supervisor reject -> 200, body result: 'rejected', no-store, no response contains the thread id (v4, Task 15)", async () => {
    supervisorClaims();
    const { sealThreadHandle } = await vi.importActual<typeof threadHandleModule>("@/lib/day/thread-handle");
    const handle = sealThreadHandle(THREAD_ID, OUTLET, KEY);
    vi.spyOn(threadHandleModule, "readThreadHandleKey").mockReturnValue(KEY);
    const store = fakeStore({
      transactConfirm: async () => ({
        kind: "write",
        thread_patch: {},
        audit: {
          actor_role: "supervisor",
          action: "thread.supervisor_reject",
          target_type: "thread",
          target_id: THREAD_ID,
          details: {},
        },
        response: { result: "rejected", category: "COMPLAINT", display_status: "rejected_by_supervisor" },
      }),
    });
    vi.spyOn(dayStoreModule, "firestoreDayStore").mockReturnValue(store);

    const response = await call(handle, { action: "reject" }, "Bearer supervisor.token");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.data.result).toBe("rejected");
    expect(JSON.stringify(body)).not.toContain(THREAD_ID);
  });
});
