import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import type { ConstraintStore } from "@/lib/constraints/service";
import type { Constraint, Outlet } from "@/lib/firestore/schema";

/**
 * Mocks Firebase Admin's `verifyIdToken` (same technique as
 * `app/api/v1/proposals/generate/route.test.ts`) so the route is exercised
 * through the real `requireClaims` guard; mocks the Firestore store and the
 * redactor so no real Firestore/DLP call is ever made.
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));

vi.mock("@/lib/firestore/constraint-store");

const redactFn = vi.fn(async (texts: readonly string[]) => [...texts]);
vi.mock("@/lib/redact/batch", () => ({
  redactBatch: () => (...args: unknown[]) => redactFn(...(args as [readonly string[]])),
}));

import { firestoreConstraintStore } from "@/lib/firestore/constraint-store";

afterEach(() => {
  verifyIdToken.mockReset();
  redactFn.mockClear();
  vi.clearAllMocks();
});

const OUTLET_ID = "proofed";

function outlet(overrides: Partial<Outlet> = {}): Outlet {
  return {
    outlet_id: OUTLET_ID,
    name: "Test Outlet",
    project_kind: "demo",
    timezone: "Asia/Jakarta",
    opening_time: "07:00",
    closing_time: "21:45",
    retention_days: 14,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    outlet_id: OUTLET_ID,
    constraint_id: "11111111-1111-4111-8111-111111111111",
    text: "an existing constraint",
    source: "manual",
    source_proposal_id: null,
    created_by_role: "supervisor",
    created_at_ms: 1,
    ...overrides,
  };
}

function baseStore(initial: Constraint[] = []): ConstraintStore {
  const docs = [...initial];
  return {
    getOutlet: async () => outlet(),
    list: async () => [...docs].sort((a, b) => a.created_at_ms - b.created_at_ms),
    listStaffScrubNames: async () => [],
    createInTransaction: async (decide) => {
      const existing = [...docs].sort((a, b) => a.created_at_ms - b.created_at_ms);
      const result = decide(existing);
      if (result.kind === "create") {
        docs.push(result.constraint);
        return { kind: "create" as const, constraint: result.constraint };
      }
      return result;
    },
  };
}

function claimsFor(token: string, role: string) {
  return {
    uid: `u-${token}`,
    email: `${role}@proofed.test`,
    email_verified: true,
    claims: { outlet_id: OUTLET_ID, role },
  };
}

function getRequest(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/constraints", { method: "GET", headers });
}

function postRequest(body: unknown, authorization?: string, bodyIsRaw = false) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/constraints", {
    method: "POST",
    headers,
    body: bodyIsRaw ? (body as string) : JSON.stringify(body),
  });
}

describe("GET /api/v1/constraints", () => {
  it("no bearer -> 401", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("owner -> 200 with the list", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "owner"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(baseStore([makeConstraint()]));
    const res = await GET(getRequest("Bearer t"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.data.constraints).toHaveLength(1);
    expect(Object.keys(body.data.constraints[0]).sort()).toEqual([
      "constraint_id",
      "created_at_ms",
      "source",
      "text",
    ]);
  });

  it("supervisor -> 200", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(baseStore([]));
    const res = await GET(getRequest("Bearer t"));
    expect(res.status).toBe(200);
  });

  it("staff -> 403", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "staff"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(baseStore([]));
    const res = await GET(getRequest("Bearer t"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/v1/constraints", () => {
  it("no bearer -> 401", async () => {
    const res = await POST(postRequest({ text: "a valid constraint" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("owner, valid body -> 201 (Q-11 b)", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "owner"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(baseStore([]));
    const res = await POST(postRequest({ text: "a brand new constraint" }, "Bearer t"));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.duplicate).toBe(false);
    expect(body.data.constraint.text).toBe("a brand new constraint");
  });

  it("supervisor, valid body -> 201", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(baseStore([]));
    const res = await POST(postRequest({ text: "a brand new constraint" }, "Bearer t"));
    expect(res.status).toBe(201);
  });

  it("staff -> 403", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "staff"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(baseStore([]));
    const res = await POST(postRequest({ text: "a valid constraint" }, "Bearer t"));
    expect(res.status).toBe(403);
  });

  it("duplicate -> 200 duplicate: true", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(
      baseStore([makeConstraint({ text: "the oven holds 2.5 kg" })]),
    );
    const res = await POST(postRequest({ text: "  The  Oven Holds 2.5 KG " }, "Bearer t"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.duplicate).toBe(true);
  });

  it('a body with source: "supervisor_rejection" -> 422 (the route only ever passes source: "manual")', async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const res = await POST(
      postRequest({ text: "a valid constraint", source: "supervisor_rejection" }, "Bearer t"),
    );
    expect(res.status).toBe(422);
  });

  it("empty body {} -> 422", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const res = await POST(postRequest({}, "Bearer t"));
    expect(res.status).toBe(422);
  });

  it("301 chars -> 422", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const res = await POST(postRequest({ text: "a".repeat(301) }, "Bearer t"));
    expect(res.status).toBe(422);
  });

  it("non-JSON body -> 400", async () => {
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "supervisor"));
    const res = await POST(postRequest("not json", "Bearer t", true));
    expect(res.status).toBe(400);
  });

  it("every response has Cache-Control: private, no-store; no response or log contains the submitted text on any error path", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    verifyIdToken.mockResolvedValueOnce(claimsFor("1", "staff"));
    vi.mocked(firestoreConstraintStore).mockReturnValueOnce(baseStore([]));
    const secret = "SENTINEL-TEXT-NEVER-LOGGED";
    const res = await POST(postRequest({ text: secret }, "Bearer t"));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await res.text();
    expect(text).not.toContain(secret);
    for (const spy of [infoSpy, errorSpy]) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(secret);
    }
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
