import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "@/lib/http/errors";

/**
 * Same technique as `app/api/v1/constraints/route.test.ts`: the real
 * `requireClaims` guard runs against a mocked `verifyIdToken`; the service and
 * the Firestore stores are mocked (R-09 Task 5.7).
 */
const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));
vi.mock("@/lib/firestore/proposal-review-store", () => ({ firestoreProposalReviewStore: () => ({ store: true }) }));
vi.mock("@/lib/firestore/constraint-store", () => ({ firestoreConstraintStore: () => ({ cstore: true }) }));
vi.mock("@/lib/redact/batch", () => ({ redactBatch: () => async (t: readonly string[]) => [...t] }));
const decideProposal = vi.fn();
vi.mock("@/lib/proposals/review-service", () => ({
  decideProposal: (...args: unknown[]) => decideProposal(...args),
}));

afterEach(() => {
  verifyIdToken.mockReset();
  decideProposal.mockReset();
});

const ID = "33333333-3333-4333-8333-333333333333";
const OUTLET_ID = "proofed";

function claimsFor(role: string) {
  return { uid: `u-${role}`, email: `${role}@t.test`, email_verified: true, claims: { outlet_id: OUTLET_ID, role } };
}

function req(body: unknown, authorization: string | null = "Bearer t", raw = false) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== null) headers.set("authorization", authorization);
  return new NextRequest(`http://localhost/api/v1/proposals/${ID}/approve`, {
    method: "POST",
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const asOwner = () => verifyIdToken.mockResolvedValueOnce(claimsFor("owner"));
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

describe("POST /api/v1/proposals/{id}/approve", () => {
  it("5.R1 every success branch returns exactly 200 with { data: { result, status } }", async () => {
    const cases = [
      { result: "approved", status: "approved" },
      { result: "rejected", status: "rejected" },
      { result: "unchanged", status: "awaiting_owner" },
    ];
    for (const out of cases) {
      asOwner();
      decideProposal.mockResolvedValueOnce(out);
      const res = await POST(req({ decision: "approve" }), params());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: out });
      noStore(res);
    }
  });

  it("5.R2 401 without a token and for a token that does not verify (device)", async () => {
    const res = await POST(req({ decision: "approve" }, null), params());
    expect(res.status).toBe(401);
    noStore(res);
    verifyIdToken.mockRejectedValueOnce(new Error("opaque device token"));
    const res2 = await POST(req({ decision: "approve" }), params());
    expect(res2.status).toBe(401);
    noStore(res2);
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("5.R2 maps service errors: 403, 404, every conflict code as 409, 503, unexpected 500", async () => {
    asOwner();
    decideProposal.mockRejectedValueOnce(new ForbiddenError("no"));
    const r403 = await POST(req({ decision: "approve" }), params());
    expect(r403.status).toBe(403);
    noStore(r403);

    asOwner();
    decideProposal.mockRejectedValueOnce(new NotFoundError("proposal", "proposal"));
    const r404 = await POST(req({ decision: "approve" }), params());
    expect(r404.status).toBe(404);
    noStore(r404);

    for (const code of [
      "NOT_REVIEWABLE",
      "ALREADY_DECIDED",
      "NOT_YET_REVIEWABLE",
      "SUPERSEDED",
      "EVIDENCE_STALE",
      "SOP_CHANGED",
      "CONSTRAINT_ADDED",
      "CONSTRAINT_LIMIT",
      "SOP_STEP_LIMIT",
      "LEGACY_PROPOSAL",
      "STEP_TEXT_TOO_LONG",
    ]) {
      asOwner();
      decideProposal.mockRejectedValueOnce(new ConflictError("x", code));
      const r = await POST(req({ decision: "approve" }), params());
      expect(r.status).toBe(409);
      expect((await r.json()).error.code).toBe(code);
      noStore(r);
    }

    asOwner();
    decideProposal.mockRejectedValueOnce(new ServiceUnavailableError("down", "redact"));
    const r503 = await POST(req({ decision: "reject", reason: "a good reason" }), params());
    expect(r503.status).toBe(503);
    noStore(r503);

    vi.spyOn(console, "error").mockImplementation(() => {});
    asOwner();
    decideProposal.mockRejectedValueOnce(new Error("boom"));
    const r500 = await POST(req({ decision: "approve" }), params());
    expect(r500.status).toBe(500);
    noStore(r500);
  });

  it("5.R2 a non-uuid id is 404 before the body is read", async () => {
    asOwner();
    const res = await POST(req("not json", "Bearer t", true), params("not-a-uuid"));
    expect(res.status).toBe(404);
    noStore(res);
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("5.R2 invalid bodies are 422: missing reason, 2-char reason, wrong decision, extra key", async () => {
    for (const body of [
      { decision: "reject" },
      { decision: "reject", reason: "ok" },
      { decision: "feasible" },
      { decision: "approve", extra: 1 },
      {},
    ]) {
      asOwner();
      const res = await POST(req(body), params());
      expect(res.status).toBe(422);
      noStore(res);
    }
    expect(decideProposal).not.toHaveBeenCalled();
  });

  it("5.R2 a non-JSON body is 400", async () => {
    asOwner();
    const res = await POST(req("{nope", "Bearer t", true), params());
    expect(res.status).toBe(400);
    noStore(res);
  });

  it("5.R4 always passes actor: owner and the parsed body, whatever the client says", async () => {
    asOwner();
    decideProposal.mockResolvedValueOnce({ result: "approved", status: "approved" });
    await POST(req({ decision: "approve" }), params());
    const input = decideProposal.mock.calls[0]![3] as Record<string, unknown>;
    expect(input.actor).toBe("owner");
    expect(input.proposal_id).toBe(ID);
    expect(input.body).toEqual({ decision: "approve", acknowledged_constraint_ids: [] });
    expect(input.claims).toEqual({ outlet_id: OUTLET_ID, role: "owner" });
    expect(typeof input.now_ms).toBe("number");
  });
});
