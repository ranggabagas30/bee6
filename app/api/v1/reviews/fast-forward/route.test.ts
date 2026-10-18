import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, OPTIONS, PATCH, POST, PUT } from "./route";
import { ConflictError, NotFoundError } from "@/lib/http/errors";
import { readFileSync } from "node:fs";
import { getModelLocation } from "@/config/regions";
import { adkReviewAgent } from "@/lib/agents/review-agent";
import { REVIEW_AGENT_MODEL } from "@/lib/reviews/agent/constants";

const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: (...a: unknown[]) => verifyIdToken(...a) }));
vi.mock("@/lib/firestore/review-store", () => ({ firestoreReviewStore: (id: string) => ({ store: id }) }));
const fastForwardReview = vi.fn();
vi.mock("@/lib/reviews/service", () => ({ fastForwardReview: (...a: unknown[]) => fastForwardReview(...a) }));

afterEach(() => {
  verifyIdToken.mockReset();
  fastForwardReview.mockReset();
  delete process.env.DEMO_MODE;
});

const claimsFor = (role: string) => ({ uid: `u-${role}`, email: `${role}@t.test`, email_verified: true, claims: { outlet_id: "demo", role } });
function req(body: unknown = {}, auth: string | null = "Bearer t", raw = false) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/v1/reviews/fast-forward", {
    method: "POST",
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const asSupervisor = () => verifyIdToken.mockResolvedValueOnce(claimsFor("supervisor"));
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };

describe("POST /api/v1/reviews/fast-forward off-demo (DEMO_MODE not exactly 'true')", () => {
  // 5.R4 / D1 / L2: the 404 is the first thing the route does. No token check, no body read, no
  // role check: nothing a caller sends can tell this route exists on the pilot.
  const cases: [string, () => NextRequest][] = [
    ["no token, empty body", () => req("", null, true)],
    ["owner token, empty body", () => req("", "Bearer t", true)],
    ["owner token, non-JSON body", () => req("{nope", "Bearer t", true)],
    ["owner token, unexpected JSON {\"x\":1}", () => req({ x: 1 })],
    ["device token (opaque, not a JWT), garbage body", () => req("%%garbage%%", "Bearer opaque-device-token", true)],
    ["a garbage bearer", () => req({}, "Bearer not-a-token")],
  ];

  for (const [name, make] of cases) {
    it(`5.R4 ${name} -> 404, token never verified, service never called`, async () => {
      const res = await POST(make());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
      noStore(res);
      expect(verifyIdToken).not.toHaveBeenCalled();
      expect(fastForwardReview).not.toHaveBeenCalled();
    });
  }

  it("5.R4 staff and a pilot owner (valid tokens) get the same 404, not a 403", async () => {
    for (const role of ["staff", "owner"]) {
      verifyIdToken.mockResolvedValueOnce(claimsFor(role));
      const res = await POST(req());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("5.R4 DEMO_MODE='1', 'TRUE' or '' is still off", async () => {
    for (const v of ["1", "TRUE", "", "false"]) {
      process.env.DEMO_MODE = v;
      expect((await POST(req())).status).toBe(404);
    }
    expect(fastForwardReview).not.toHaveBeenCalled();
  });

  it("5.R4 every other method is a 404 too (no 405 or Allow header that reveals the route)", async () => {
    for (const handler of [GET, PUT, PATCH, DELETE, OPTIONS]) {
      const res = await handler();
      expect(res.status).toBe(404);
      expect(res.headers.get("Allow")).toBeNull();
    }
  });
});

describe("POST /api/v1/reviews/fast-forward in demo mode", () => {
  it("5.R4 DEMO_MODE true -> 200 { version }; the service still gets demoMode true", async () => {
    process.env.DEMO_MODE = "true";
    asSupervisor();
    fastForwardReview.mockResolvedValueOnce({ version: 2 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { version: 2 } });
    noStore(res);
    expect(fastForwardReview.mock.calls[0]![0]).toEqual({ store: "demo" });
    expect(fastForwardReview.mock.calls[0]![1]).toMatchObject({ demoMode: true, claims: { outlet_id: "demo", role: "supervisor" } });
  });

  it("passes the ReviewAgent deps: the ADK runner, the process env, the project and a location read from regions.yaml", async () => {
    process.env.DEMO_MODE = "true";
    const prev = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = "bee6-playground";
    try {
      asSupervisor();
      fastForwardReview.mockResolvedValueOnce({ version: 2 });
      const before = Date.now();
      await POST(req());
      const input = fastForwardReview.mock.calls[0]![1] as { reviewAgent: Record<string, unknown> };
      const deps = input.reviewAgent as {
        run: unknown; env: unknown; project: string; now_ms: number; resolveLocation: (m: string) => string;
      };
      expect(deps.run).toBe(adkReviewAgent);
      expect(deps.env).toBe(process.env);
      expect(deps.project).toBe("bee6-playground");
      expect(deps.now_ms).toBeGreaterThanOrEqual(before);
      expect(deps.resolveLocation(REVIEW_AGENT_MODEL)).toBe(getModelLocation(REVIEW_AGENT_MODEL).location);
    } finally {
      if (prev === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
      else process.env.GOOGLE_CLOUD_PROJECT = prev;
    }
  });

  it("the route source names no model location (hard rule 5)", () => {
    const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/asia-southeast|["']global["']|us-central/);
    expect(src).toContain("getModelLocation(m).location");
  });

  it("5.R4 a non-demo outlet with DEMO_MODE on: the service's 404 passes through", async () => {
    process.env.DEMO_MODE = "true";
    asSupervisor();
    fastForwardReview.mockRejectedValueOnce(new NotFoundError("route", "route"));
    expect((await POST(req())).status).toBe(404);
  });

  it("5.R4 409 NOTHING_TO_REVIEW is passed through", async () => {
    process.env.DEMO_MODE = "true";
    asSupervisor();
    fastForwardReview.mockRejectedValueOnce(new ConflictError("Nothing to review", "NOTHING_TO_REVIEW"));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOTHING_TO_REVIEW");
  });

  it("422 for a non-empty body, 400 for non-JSON, 401 without a token", async () => {
    process.env.DEMO_MODE = "true";
    asSupervisor();
    const r1 = await POST(req({ version: 2 }));
    expect(r1.status).toBe(422);
    noStore(r1);
    asSupervisor();
    expect((await POST(req("{nope", "Bearer t", true))).status).toBe(400);
    expect((await POST(req({}, null))).status).toBe(401);
    expect(fastForwardReview).not.toHaveBeenCalled();
  });

  it("other methods are a 405 in demo mode", async () => {
    process.env.DEMO_MODE = "true";
    expect((await GET()).status).toBe(405);
  });
});
