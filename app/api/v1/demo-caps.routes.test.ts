import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { firestoreDemoStore } from "@/lib/firestore/demo-store";
import type { Outlet } from "@/lib/firestore/schema";
import { fakeStore } from "@/lib/demo/testing/fake-store";
import { templateSet } from "@/lib/demo/testing/fixtures";
import { POST as approvePOST } from "./proposals/[id]/approve/route";
import { POST as reviewPOST } from "./proposals/[id]/review/route";
import { POST as verdictPOST } from "./reviews/[version]/verdict/route";
import { POST as constraintsPOST } from "./constraints/route";
import { POST as fastForwardPOST } from "./reviews/fast-forward/route";
import { POST as answerPOST } from "./questions/[id]/answer/route";
import { ConflictError, UnauthorizedError } from "@/lib/http/errors";
import * as guardModule from "@/lib/http/guard";

/**
 * R-12 H2: every sandbox route that spends Sensitive Data Protection money (typed text) or writes
 * simulated time takes the shared cap check AFTER auth, permission and body validation and BEFORE the
 * service. One table, one set of properties, so no path is capped "ad hoc".
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: (...a: unknown[]) => verifyIdToken(...a) }));
vi.mock("@/lib/http/guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http/guard")>()),
  requireDevice: vi.fn(),
}));
vi.mock("@/lib/firestore/demo-store");
vi.mock("@/lib/firestore/proposal-review-store", () => ({ firestoreProposalReviewStore: () => ({}) }));
vi.mock("@/lib/firestore/constraint-store", () => ({ firestoreConstraintStore: () => ({}) }));
vi.mock("@/lib/firestore/review-store", () => ({ firestoreReviewStore: () => ({}) }));
vi.mock("@/lib/firestore/debrief-store", () => ({ firestoreDebriefStore: () => ({}) }));
vi.mock("@/lib/redact/batch", () => ({ redactBatch: () => async (t: readonly string[]) => [...t] }));
vi.mock("@/lib/redact/dlp", () => ({ dlpRedactor: () => ({ redact: async (t: string) => t }) }));
const decideProposal = vi.fn();
vi.mock("@/lib/proposals/review-service", () => ({ decideProposal: (...a: unknown[]) => decideProposal(...a) }));
const decideVerdict = vi.fn();
const ffRefuses = vi.hoisted(() => ({ value: false }));
const fastForwardReview = vi.fn();
vi.mock("@/lib/reviews/service", () => ({
  decideVerdict: (...a: unknown[]) => decideVerdict(...a),
  // The real service calls beforeCreate (the cap check) once its own pre-checks pass and afterCreate (the cap
  // charge) once the review was created; ffRefuses models a skip that cannot run.
  fastForwardReview: async (store: unknown, input: { beforeCreate?: () => Promise<void>; afterCreate?: () => Promise<void> }) => {
    if (ffRefuses.value) throw new ConflictError("Nothing to review", "NOTHING_TO_REVIEW");
    await input.beforeCreate?.();
    const result = await fastForwardReview(store, input);
    await input.afterCreate?.();
    return result;
  },
}));
const createConstraint = vi.fn();
vi.mock("@/lib/constraints/service", () => ({ createConstraint: (...a: unknown[]) => createConstraint(...a), listConstraintViews: vi.fn() }));
const submitAnswer = vi.fn();
vi.mock("@/lib/debrief/service", () => ({ submitAnswer: (...a: unknown[]) => submitAnswer(...a) }));

const SBX = "sbx-0123456789ab";
const PROPOSAL = "33333333-3333-4333-8333-333333333333";
const sandboxOutlet = (): Outlet => ({
  ...templateSet().outlet,
  outlet_id: SBX,
  sandbox: { template_outlet_id: "demo-tpl-outlet", created_at_ms: Date.now(), expires_at_ms: Date.now() + 3_600_000, key_sha256: "a".repeat(64) },
});

interface Case {
  name: string;
  role: "owner" | "supervisor" | "device";
  wrongRole: "staff" | "owner" | "supervisor";
  capEnv: string;
  capCode: string;
  service: ReturnType<typeof vi.fn>;
  serviceResult: unknown;
  call: (headers: Headers, body: string) => Promise<Response>;
  body: unknown;
  badBody: string;
}
const ctx = (extra: object = {}) => ({ params: Promise.resolve({ id: PROPOSAL, version: "2", ...extra }) });
const url = "http://localhost/api/v1/x";
const mk = (headers: Headers, body: string) => new NextRequest(url, { method: "POST", headers, body });

const CASES: Case[] = [
  {
    name: "proposal approve",
    role: "owner",
    wrongRole: "supervisor",
    capEnv: "DEMO_REDACT_SANDBOX_CAP",
    capCode: "demo_redact_cap",
    service: decideProposal,
    serviceResult: { result: "approved", status: "approved" },
    body: { decision: "reject", reason: "Not now" },
    badBody: '{"decision":"maybe"}',
    call: (h, b) => approvePOST(mk(h, b), ctx()),
  },
  {
    name: "proposal review",
    role: "supervisor",
    wrongRole: "owner",
    capEnv: "DEMO_REDACT_SANDBOX_CAP",
    capCode: "demo_redact_cap",
    service: decideProposal,
    serviceResult: { result: "rejected", status: "rejected" },
    body: { decision: "reject", reason: "Not feasible" },
    badBody: '{"decision":"reject"}',
    call: (h, b) => reviewPOST(mk(h, b), ctx()),
  },
  {
    name: "review verdict",
    role: "owner",
    wrongRole: "staff",
    capEnv: "DEMO_REDACT_SANDBOX_CAP",
    capCode: "demo_redact_cap",
    service: decideVerdict,
    serviceResult: { result: "recorded", status: "confirmed" },
    body: { verdict: "worked", reason: "Worked well" },
    badBody: '{"verdict":"nope"}',
    call: (h, b) => verdictPOST(mk(h, b), ctx()),
  },
  {
    name: "constraint create",
    role: "supervisor",
    wrongRole: "staff",
    capEnv: "DEMO_REDACT_SANDBOX_CAP",
    capCode: "demo_redact_cap",
    service: createConstraint,
    serviceResult: {
      constraint: { constraint_id: "44444444-4444-4444-8444-444444444444", text: "No night shifts", source: "manual", created_at_ms: 1 },
      duplicate: false,
    },
    body: { text: "No night shifts at all" },
    badBody: '{"text":"x"}',
    call: (h, b) => constraintsPOST(mk(h, b)),
  },
  {
    name: "review fast-forward",
    role: "owner",
    wrongRole: "staff",
    capEnv: "DEMO_FAST_FORWARD_SANDBOX_CAP",
    capCode: "demo_fast_forward_cap",
    service: fastForwardReview,
    serviceResult: { version: 2 },
    body: {},
    badBody: '{"x":1}',
    call: (h, b) => fastForwardPOST(mk(h, b)),
  },
  {
    name: "debrief answer (device)",
    role: "device",
    wrongRole: "owner",
    capEnv: "DEMO_REDACT_SANDBOX_CAP",
    capCode: "demo_redact_cap",
    service: submitAnswer,
    serviceResult: { status: "answered" },
    body: { question_id: "q_abc", debrief_business_date: "2026-10-19", answer: "yes", reason: "ok", answered_at_ms: 1 },
    badBody: '{"question_id":1}',
    call: (h, b) => answerPOST(mk(h, b), ctx({ id: "q_abc" })),
  },
];

let f: ReturnType<typeof fakeStore>;
beforeEach(() => {
  f = fakeStore();
  f.sandboxes.set(SBX, sandboxOutlet());
  vi.mocked(firestoreDemoStore).mockReturnValue(f.store);
  vi.stubEnv("DEMO_MODE", "true");
  ffRefuses.value = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  verifyIdToken.mockReset();
});

function principal(c: Case, outlet_id: string, role: string = c.role) {
  if (c.role === "device" && role === "device") {
    vi.mocked(guardModule.requireDevice).mockResolvedValue({ outlet_id, device_id: "jdg-0123456789ab", role: "device" });
    return;
  }
  if (c.role === "device") {
    // a web principal hitting the device-only route: requireDevice refuses it
    vi.mocked(guardModule.requireDevice).mockRejectedValue(new UnauthorizedError("A device credential is required"));
    return;
  }
  const claims = { outlet_id, role, ...(outlet_id.startsWith("sbx-") ? { demo_exp_ms: Date.now() + 3_600_000 } : {}) };
  verifyIdToken.mockResolvedValue({ uid: "u", email: undefined, email_verified: false, claims });
}
function headers() {
  return new Headers({ "content-type": "application/json", authorization: "Bearer t", "x-device-id": "jdg-0123456789ab" });
}

describe.each(CASES)("sandbox caps on $name", (c) => {
  it("past its per-sandbox cap: 429 with Retry-After and the service is never reached", async () => {
    vi.stubEnv(c.capEnv, "1");
    principal(c, SBX);
    c.service.mockResolvedValue(c.serviceResult);
    const first = await c.call(headers(), JSON.stringify(c.body));
    expect(first.status).toBeLessThan(400);
    expect(c.service).toHaveBeenCalledTimes(1);

    const res = await c.call(headers(), JSON.stringify(c.body));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe(c.capCode);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(c.service).toHaveBeenCalledTimes(1);
  });

  it("a malformed body burns no cap", async () => {
    principal(c, SBX);
    const res = await c.call(headers(), c.badBody);
    expect(res.status).not.toBe(429);
    expect(f.bumps).toEqual([]);
  });

  it("the wrong role, no token and an expired demo token burn no cap", async () => {
    principal(c, SBX, c.wrongRole);
    const wrong = await c.call(headers(), JSON.stringify(c.body));
    expect([401, 403]).toContain(wrong.status);

    if (c.role !== "device") {
      verifyIdToken.mockResolvedValue({ uid: "u", email: undefined, email_verified: false, claims: { outlet_id: SBX, role: c.role, demo_exp_ms: Date.now() - 1 } });
      expect((await c.call(headers(), JSON.stringify(c.body))).status).toBe(401);
    }
    const noAuth = new Headers({ "content-type": "application/json" });
    verifyIdToken.mockReset();
    vi.mocked(guardModule.requireDevice).mockRejectedValue(new UnauthorizedError("Missing bearer token"));
    expect((await c.call(noAuth, JSON.stringify(c.body))).status).toBe(401);
    expect(f.bumps).toEqual([]);
  });

  it("a non-sandbox outlet (pilot, shared demo outlet) is unaffected: no demo store, zero extra reads", async () => {
    vi.stubEnv(c.capEnv, "1");
    principal(c, "demo-outlet");
    c.service.mockResolvedValue(c.serviceResult);
    for (let i = 0; i < 3; i++) expect((await c.call(headers(), JSON.stringify(c.body))).status).toBeLessThan(400);
    expect(firestoreDemoStore).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
  });

  it("off-demo (DEMO_MODE unset): no demo store even for an sbx- outlet", async () => {
    vi.stubEnv("DEMO_MODE", "");
    if (c.name === "review fast-forward") return; // off-demo this route is a 404 before anything (its own tests)
    principal(c, SBX);
    c.service.mockResolvedValue(c.serviceResult);
    expect((await c.call(headers(), JSON.stringify(c.body))).status).toBeLessThan(400);
    expect(firestoreDemoStore).not.toHaveBeenCalled();
  });
});

describe("fast-forward: a skip that cannot run spends no cap slot", () => {
  it("a 409 NOTHING_TO_REVIEW from the service burns no per-sandbox slot", async () => {
    const c = CASES.find((x) => x.name === "review fast-forward")!;
    vi.stubEnv(c.capEnv, "1");
    principal(c, SBX);
    ffRefuses.value = true;
    for (let i = 0; i < 3; i++) expect((await c.call(headers(), JSON.stringify(c.body))).status).toBe(409);
    expect(f.bumps).toEqual([]);
    ffRefuses.value = false;
    c.service.mockResolvedValue(c.serviceResult);
    expect((await c.call(headers(), JSON.stringify(c.body))).status).toBe(200); // the single slot is still there
    expect(f.bumps).toHaveLength(1);
  });
});

describe("fast-forward: the slot is charged only after the review was created", () => {
  it("a skip that fails after the cap check (e.g. the source proposal is gone) burns no slot", async () => {
    const c = CASES.find((x) => x.name === "review fast-forward")!;
    principal(c, SBX);
    c.service.mockRejectedValue(new Error("createReview: source proposal missing"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await c.call(headers(), JSON.stringify(c.body))).status).toBe(500);
    expect(f.bumps).toEqual([]);
  });

  it("a successful skip burns exactly one slot", async () => {
    const c = CASES.find((x) => x.name === "review fast-forward")!;
    principal(c, SBX);
    c.service.mockResolvedValue(c.serviceResult);
    expect((await c.call(headers(), JSON.stringify(c.body))).status).toBe(200);
    expect(f.bumps).toHaveLength(1);
  });
});

describe("redact cap: charged only when text that will reach Sensitive Data Protection is present", () => {
  const byName = (n: string) => CASES.find((x) => x.name === n)!;
  const burn = async (name: string, body: unknown, ctxId?: string) => {
    const c = byName(name);
    principal(c, SBX);
    c.service.mockResolvedValue(c.serviceResult);
    const res = ctxId ? await answerPOST(mk(headers(), JSON.stringify(body)), ctx({ id: ctxId })) : await c.call(headers(), JSON.stringify(body));
    return { res, bumps: f.bumps.length, service: c.service };
  };

  it("approving or marking feasible (no reason) spends no slot, a rejection with a reason spends one", async () => {
    for (const [name, body] of [
      ["proposal approve", { decision: "approve" }],
      ["proposal review", { decision: "feasible" }],
    ] as const) {
      const r = await burn(name, body);
      expect(r.res.status).toBe(200);
      expect(r.bumps).toBe(0);
    }
    const rej = await burn("proposal approve", { decision: "reject", reason: "Not now" });
    expect(rej.bumps).toBeGreaterThan(0);
  });

  it("a verdict with no reason spends no slot, with a reason it does", async () => {
    expect((await burn("review verdict", { verdict: "worked" })).bumps).toBe(0);
    expect((await burn("review verdict", { verdict: "worked", reason: "Worked well" })).bumps).toBeGreaterThan(0);
  });

  const ANSWER = { question_id: "q_abc", debrief_business_date: "2026-10-19", answer: "yes", reason: "ok", answered_at_ms: 1 };
  it("an answer with no text (empty or blank reason), or a path id that does not match the body, spends no slot", async () => {
    expect((await burn("debrief answer (device)", { ...ANSWER, reason: "" }, "q_abc")).bumps).toBe(0);
    expect((await burn("debrief answer (device)", { ...ANSWER, reason: "   " }, "q_abc")).bumps).toBe(0);
    expect((await burn("debrief answer (device)", ANSWER, "q_other")).bumps).toBe(0);
    expect((await burn("debrief answer (device)", { ...ANSWER, reason: "x".repeat(20_000) }, "q_abc")).bumps).toBe(0); // over the reason bound: the service refuses before SDP
  });

  it("an answer with text and a matching path id spends a slot", async () => {
    expect((await burn("debrief answer (device)", ANSWER, "q_abc")).bumps).toBeGreaterThan(0);
  });
});

describe("a sbx- outlet whose doc has no sandbox object fails closed", () => {
  it("503 demo_not_ready and the service is never reached", async () => {
    const c = CASES.find((x) => x.name === "proposal approve")!;
    f.sandboxes.set(SBX, { ...templateSet().outlet, outlet_id: SBX });
    principal(c, SBX);
    c.service.mockResolvedValue(c.serviceResult);
    const res = await c.call(headers(), JSON.stringify(c.body));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("demo_not_ready");
    expect(c.service).not.toHaveBeenCalled();
    expect(f.bumps).toEqual([]);
  });
});
