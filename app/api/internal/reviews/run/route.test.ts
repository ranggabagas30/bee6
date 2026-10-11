import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

/**
 * 5.R1 / 5.R5 / 5.R6. The real `verifyInternalOidcToken` runs against a mocked
 * google-auth-library client, so audience and issuer handling are exercised,
 * not assumed. The run itself and the Firestore store are mocked.
 */
const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken(params: unknown) {
      return verifyIdToken(params);
    }
  },
}));
const runDueReviews = vi.fn();
vi.mock("@/lib/reviews/service", () => ({ runDueReviews: (...a: unknown[]) => runDueReviews(...a) }));
const store = { store: true };
vi.mock("@/lib/firestore/review-store", () => ({
  firestoreReviewStore: () => store,
  listAllOutlets: async () => [{ outlet_id: "o1" }],
}));

const SA = "invoker@project.iam.gserviceaccount.com";
const AUD = "https://web.example.run.app/api/internal/reviews/run";
const SUMMARY = { outlets: 1, created: 1, expired: 0, errors: 0 };

function req(headers: Record<string, string> = { authorization: "Bearer tok" }, host = "web.example.run.app") {
  return new NextRequest(`https://${host}/api/internal/reviews/run`, { method: "POST", headers });
}
const noStore = (res: Response) => expect(res.headers.get("Cache-Control")).toBe("private, no-store");

beforeEach(() => {
  process.env.TASKS_INVOKER_SA = SA;
  process.env.REVIEW_RUN_AUDIENCE = AUD;
  verifyIdToken.mockResolvedValue({ getPayload: () => ({ email: SA, email_verified: true }) });
  runDueReviews.mockResolvedValue(SUMMARY);
});
afterEach(() => {
  verifyIdToken.mockReset();
  runDueReviews.mockReset();
  delete process.env.TASKS_INVOKER_SA;
  delete process.env.REVIEW_RUN_AUDIENCE;
});

describe("POST /api/internal/reviews/run", () => {
  it("5.R1 no token -> 401 and the run never starts", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    noStore(res);
    expect(runDueReviews).not.toHaveBeenCalled();
  });

  it("5.R1 a token the verifier rejects (bad audience / signature) -> 401", async () => {
    verifyIdToken.mockRejectedValueOnce(new Error("Wrong recipient"));
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runDueReviews).not.toHaveBeenCalled();
  });

  it("5.R1 a valid token from a different issuer -> 401", async () => {
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: "someone@else.test", email_verified: true }) });
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(runDueReviews).not.toHaveBeenCalled();
  });

  it("5.R1 REVIEW_RUN_AUDIENCE unset or empty -> 401 (fails closed)", async () => {
    delete process.env.REVIEW_RUN_AUDIENCE;
    expect((await POST(req())).status).toBe(401);
    process.env.REVIEW_RUN_AUDIENCE = "";
    expect((await POST(req())).status).toBe(401);
    expect(runDueReviews).not.toHaveBeenCalled();
  });

  it("5.R1 M1 every 401 body is the same generic message and never names an env var", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies: unknown[] = [];
    bodies.push(await (await POST(req({}))).json());
    delete process.env.REVIEW_RUN_AUDIENCE;
    bodies.push(await (await POST(req())).json());
    process.env.REVIEW_RUN_AUDIENCE = AUD;
    verifyIdToken.mockRejectedValueOnce(new Error("Wrong recipient"));
    bodies.push(await (await POST(req())).json());
    for (const b of bodies) expect(b).toEqual({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    vi.restoreAllMocks();
  });

  it("5.R1 the audience is the env value even when the request Host differs", async () => {
    const res = await POST(req({ authorization: "Bearer tok", "x-forwarded-host": "evil.test" }, "evil.test"));
    expect(res.status).toBe(200);
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: "tok", audience: AUD });
  });

  it("5.R1 success -> 200 with the summary, store wired and the server clock", async () => {
    const before = Date.now();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: SUMMARY });
    noStore(res);
    const call = runDueReviews.mock.calls[0]![0];
    expect(call.outlets).toEqual([{ outlet_id: "o1" }]);
    expect(call.storeFor("o1")).toBe(store);
    expect(call.now_ms).toBeGreaterThanOrEqual(before);
  });

  it("an unexpected failure maps to the 500 envelope", async () => {
    runDueReviews.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(req());
    expect(res.status).toBe(500);
    noStore(res);
  });

  it("5.R6 the audience is read per request, not at module load", async () => {
    process.env.REVIEW_RUN_AUDIENCE = "https://other.example/run";
    await POST(req());
    expect(verifyIdToken).toHaveBeenLastCalledWith({ idToken: "tok", audience: "https://other.example/run" });
    process.env.REVIEW_RUN_AUDIENCE = AUD;
    await POST(req());
    expect(verifyIdToken).toHaveBeenLastCalledWith({ idToken: "tok", audience: AUD });
  });
});
