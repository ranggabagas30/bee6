import { describe, expect, it, vi } from "vitest";
import { verifyInternalOidcToken } from "@/lib/http/oidc";
import { UnauthorizedError } from "@/lib/http/errors";

/**
 * R-05b Task 6: every internal route verifies the Cloud Scheduler OIDC
 * token (`google-auth-library`'s `verifyIdToken`), audience = the exact
 * URL the caller hit, issuer email = `TASKS_INVOKER_SA`. Never trusts a
 * bare request (CLAUDE.md hard rule #6's spirit, applied service-to-service).
 */
function fakeReq(url: string, authHeader: string | null) {
  return {
    url,
    headers: {
      get: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : null),
    },
  };
}

const AUDIENCE_URL = "https://web-abc.a.run.app/api/internal/pipeline/tick";
const INVOKER_SA = "tasks-invoker@my-project.iam.gserviceaccount.com";

describe("verifyInternalOidcToken", () => {
  it("rejects a request with no bearer token", async () => {
    const req = fakeReq(AUDIENCE_URL, null);
    await expect(
      verifyInternalOidcToken(req, { issuerEmail: INVOKER_SA }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("accepts a token whose audience matches the request URL and email matches TASKS_INVOKER_SA", async () => {
    const verifyIdToken = vi.fn().mockResolvedValueOnce({
      email: INVOKER_SA,
      email_verified: true,
    });
    const req = fakeReq(AUDIENCE_URL, "Bearer good-token");

    await expect(
      verifyInternalOidcToken(req, { issuerEmail: INVOKER_SA }, { verifyIdToken }),
    ).resolves.toBeUndefined();

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "good-token",
      audience: AUDIENCE_URL,
    });
  });

  it("strips a query string from the request URL before using it as the audience", async () => {
    const verifyIdToken = vi.fn().mockResolvedValueOnce({ email: INVOKER_SA, email_verified: true });
    const req = fakeReq(`${AUDIENCE_URL}?x=1`, "Bearer good-token");

    await verifyInternalOidcToken(req, { issuerEmail: INVOKER_SA }, { verifyIdToken });

    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: "good-token", audience: AUDIENCE_URL });
  });

  it("rejects when the token's email does not match TASKS_INVOKER_SA", async () => {
    const verifyIdToken = vi.fn().mockResolvedValueOnce({
      email: "someone-else@my-project.iam.gserviceaccount.com",
      email_verified: true,
    });
    const req = fakeReq(AUDIENCE_URL, "Bearer good-token");

    await expect(
      verifyInternalOidcToken(req, { issuerEmail: INVOKER_SA }, { verifyIdToken }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects when verifyIdToken itself throws (bad signature, wrong audience, expired)", async () => {
    const verifyIdToken = vi.fn().mockRejectedValueOnce(new Error("Wrong recipient"));
    const req = fakeReq(AUDIENCE_URL, "Bearer bad-token");

    await expect(
      verifyInternalOidcToken(req, { issuerEmail: INVOKER_SA }, { verifyIdToken }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects when TASKS_INVOKER_SA itself is not configured (never silently allows)", async () => {
    const verifyIdToken = vi.fn();
    const req = fakeReq(AUDIENCE_URL, "Bearer good-token");

    await expect(
      verifyInternalOidcToken(req, { issuerEmail: "" }, { verifyIdToken }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
