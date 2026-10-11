import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "@/lib/http/errors";

const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({ verifyIdToken: (...a: unknown[]) => verifyIdToken(...a) }));
vi.mock("@/lib/firestore/review-store", () => ({ firestoreReviewStore: (id: string) => ({ store: id }) }));
vi.mock("@/lib/redact/batch", () => ({ redactBatch: () => async (t: readonly string[]) => [...t] }));
const decideVerdict = vi.fn();
vi.mock("@/lib/reviews/service", () => ({ decideVerdict: (...a: unknown[]) => decideVerdict(...a) }));

afterEach(() => {
  verifyIdToken.mockReset();
  decideVerdict.mockReset();
});

const claimsFor = (role: string) => ({ uid: `u-${role}`, email: `${role}@t.test`, email_verified: true, claims: { outlet_id: "proofed", role } });
function req(body: unknown, auth: string | null = "Bearer t", raw = false) {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/v1/reviews/2/verdict", {
    method: "POST",
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const params = (version = "2") => ({ params: Promise.resolve({ version }) });
const asSupervisor = () => verifyIdToken.mockResolvedValueOnce(claimsFor("supervisor"));
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

describe("POST /api/v1/reviews/{version}/verdict", () => {
  it("5.R3 200 for recorded and unchanged, passing claims, numeric version, parsed body", async () => {
    for (const out of [{ result: "recorded", status: "awaiting_owner" }, { result: "unchanged", status: "awaiting_owner" }]) {
      asSupervisor();
      decideVerdict.mockResolvedValueOnce(out);
      const res = await POST(req({ verdict: "revise", reason: "  needs more days  " }), params());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: out });
      noStore(res);
    }
    const [store, , input] = decideVerdict.mock.calls[0]!;
    expect(store).toEqual({ store: "proofed" });
    expect(input).toMatchObject({ version: 2, body: { verdict: "revise", reason: "needs more days" }, claims: { outlet_id: "proofed", role: "supervisor" } });
    expect(typeof input.now_ms).toBe("number");
  });

  it("5.R3 404 for versions 1, abc and 2.5 before the body is read", async () => {
    for (const v of ["1", "abc", "2.5"]) {
      asSupervisor();
      const res = await POST(req("not json", "Bearer t", true), params(v));
      expect(res.status).toBe(404);
      noStore(res);
    }
    expect(decideVerdict).not.toHaveBeenCalled();
  });

  it("5.R3 400 for a non-JSON body", async () => {
    asSupervisor();
    const res = await POST(req("{not json", "Bearer t", true), params());
    expect(res.status).toBe(400);
    noStore(res);
  });

  it("5.R3 422 invalid_body for a 2-char reason, an unknown verdict and an extra key", async () => {
    for (const bad of [{ verdict: "worked", reason: "ab" }, { verdict: "bogus" }, { verdict: "worked", role: "owner" }, {}]) {
      asSupervisor();
      const res = await POST(req(bad), params());
      expect(res.status).toBe(422);
      expect((await res.json()).error.message).toBe("invalid_body");
      noStore(res);
    }
    expect(decideVerdict).not.toHaveBeenCalled();
  });

  it("5.R3 maps 403, 404, every conflict code as 409, 503 and an unexpected 500", async () => {
    const cases: [Error, number, string?][] = [
      [new ForbiddenError("no"), 403],
      [new NotFoundError("review", "review"), 404],
      [new ConflictError("x", "ALREADY_DECIDED"), 409, "ALREADY_DECIDED"],
      [new ConflictError("x", "NOT_YET_REVIEWABLE"), 409, "NOT_YET_REVIEWABLE"],
      [new ConflictError("x", "EXPIRED"), 409, "EXPIRED"],
      [new ServiceUnavailableError("Redaction unavailable", "redact"), 503],
      [new Error("boom"), 500],
    ];
    for (const [err, status, code] of cases) {
      asSupervisor();
      decideVerdict.mockRejectedValueOnce(err);
      const res = await POST(req({ verdict: "worked" }), params());
      expect(res.status).toBe(status);
      if (code) expect((await res.json()).error.code).toBe(code);
      noStore(res);
    }
  });

  it("5.R3 401 without a token or with a device token", async () => {
    const r1 = await POST(req({ verdict: "worked" }, null), params());
    expect(r1.status).toBe(401);
    noStore(r1);
    verifyIdToken.mockRejectedValueOnce(new Error("opaque"));
    expect((await POST(req({ verdict: "worked" }), params())).status).toBe(401);
    expect(decideVerdict).not.toHaveBeenCalled();
  });
});
