import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "./route";
import * as progressStoreModule from "@/lib/firestore/demo-progress-store";
import type { ProgressStore } from "@/lib/demo/progress";
import type { Outlet } from "@/lib/firestore/schema";

/**
 * GET /api/v1/demo/progress (R-19 PR-5, plan section 2.3). Demo only: off DEMO_MODE every request is the same 404
 * before the token is verified. On the demo: the real `requireClaims` guard (Firebase Admin's verifyIdToken is
 * mocked), then the plain-code service against a mocked store. The answer is counts only.
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/firestore/demo-progress-store");

const SBX = "sbx-0123456789ab";
const NOW_EXP = Date.now() + 3_600_000;
const sandboxOutlet: Outlet = {
  outlet_id: SBX,
  name: "Demo bakery",
  project_kind: "demo",
  timezone: "Asia/Jakarta",
  opening_time: "08:00",
  closing_time: "22:00",
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: 1, expires_at_ms: NOW_EXP, key_sha256: "a".repeat(64), next_day_count: 1 },
  created_at: "2026-10-14T00:00:00.000Z",
};
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };

function claims(role: string, outlet_id = SBX) {
  verifyIdToken.mockResolvedValueOnce({
    uid: `demo-${role}-x`,
    email: null,
    email_verified: false,
    claims: { outlet_id, role, demo_exp_ms: NOW_EXP },
  });
}
function wire(store: Partial<ProgressStore> = {}) {
  const full: ProgressStore = {
    getOutlet: async () => sandboxOutlet,
    listProposalRows: async () => [
      { has_content: true, supervisor_decision: "feasible", owner_decision: null },
      { has_content: false, supervisor_decision: null, owner_decision: null },
    ],
    listDeviceLastEnded: async () => [],
    listReviewStatuses: async () => [],
    ...store,
  };
  return vi.mocked(progressStoreModule.firestoreProgressStore).mockReturnValue(full);
}
function req(authorization: string | null = "Bearer t") {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return new NextRequest("http://localhost/api/v1/demo/progress", { method: "GET", headers });
}

afterEach(() => {
  vi.clearAllMocks();
  verifyIdToken.mockReset();
  delete process.env.DEMO_MODE;
});

describe("GET /api/v1/demo/progress off-demo", () => {
  it("DEMO_MODE unset, '1', 'TRUE' or 'false': 404 before the token is verified or anything is read", async () => {
    wire();
    for (const v of [undefined, "1", "TRUE", "false"]) {
      if (v === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = v;
      const res = await GET(req());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(progressStoreModule.firestoreProgressStore).not.toHaveBeenCalled();
  });

  it("every other method is a 404 off-demo and a 405 (Allow: GET) on the demo", async () => {
    for (const handler of [POST, PUT, PATCH, DELETE, OPTIONS]) expect((await handler()).status).toBe(404);
    process.env.DEMO_MODE = "true";
    for (const handler of [POST, PUT, PATCH, DELETE, OPTIONS]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET");
    }
  });
});

describe("GET /api/v1/demo/progress on the demo (DEMO_MODE=true)", () => {
  const demo = () => { process.env.DEMO_MODE = "true"; };

  it("no bearer: 401; a non-sandbox outlet: the same 404 body as off-demo, nothing read", async () => {
    demo();
    const getOutlet = vi.fn(async () => sandboxOutlet);
    wire({ getOutlet });
    expect((await GET(req(null))).status).toBe(401);
    verifyIdToken.mockResolvedValueOnce({ uid: "u", email: "o@x.test", email_verified: true, claims: { outlet_id: "outlet-1", role: "owner" } });
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(getOutlet).not.toHaveBeenCalled();
  });

  it("a staff principal is 403", async () => {
    demo();
    wire();
    claims("staff");
    expect((await GET(req())).status).toBe(403);
  });

  it("supervisor and owner: 200 with the five counts, no-store, nothing but counts in the body", async () => {
    demo();
    for (const role of ["supervisor", "owner"]) {
      const built = wire();
      claims(role);
      const res = await GET(req());
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await res.json()).toEqual({ data: { day: 2, days_done: 1, proposals_with_content: 1, feasible: 1, owner_decided: 0, approved: 0, reviews_open: 0, reviews_confirmed: 0 } });
      expect(built).toHaveBeenCalledTimes(1);
      vi.clearAllMocks();
    }
  });

  it("a sandbox id whose doc is missing: 404 with the off-demo body", async () => {
    demo();
    wire({ getOutlet: async () => null });
    claims("owner");
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
  });
});
