import { describe, expect, it, vi } from "vitest";
import { verifyInternalOidcToken } from "@/lib/http/oidc";
import { UnauthorizedError } from "@/lib/http/errors";

/**
 * R-05b Task 6: every internal route verifies the Cloud Scheduler OIDC
 * token (`google-auth-library`'s `verifyIdToken`), audience =
 * `PIPELINE_TICK_AUDIENCE` (configured, never derived from the request —
 * tech-lead review round 2, finding 1), issuer email = `TASKS_INVOKER_SA`.
 * Never trusts a bare request (CLAUDE.md hard rule #6's spirit, applied
 * service-to-service).
 */
function fakeReq(authHeader: string | null, headerOverrides: Record<string, string> = {}) {
  return {
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "authorization") return authHeader;
        return headerOverrides[name.toLowerCase()] ?? null;
      },
    },
  };
}

const CONFIGURED_AUDIENCE = "https://web-abc.a.run.app/api/internal/pipeline/tick";
const INVOKER_SA = "tasks-invoker@my-project.iam.gserviceaccount.com";

describe("verifyInternalOidcToken", () => {
  it("rejects a request with no bearer token", async () => {
    const req = fakeReq(null);
    await expect(
      verifyInternalOidcToken(req, { issuerEmail: INVOKER_SA, audience: CONFIGURED_AUDIENCE }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("accepts a token whose audience matches the configured audience and email matches TASKS_INVOKER_SA", async () => {
    const verifyIdToken = vi.fn().mockResolvedValueOnce({
      email: INVOKER_SA,
      email_verified: true,
    });
    const req = fakeReq("Bearer good-token");

    await expect(
      verifyInternalOidcToken(
        req,
        { issuerEmail: INVOKER_SA, audience: CONFIGURED_AUDIENCE },
        { verifyIdToken },
      ),
    ).resolves.toBeUndefined();

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "good-token",
      audience: CONFIGURED_AUDIENCE,
    });
  });

  it("[blocking-fix] uses the configured PIPELINE_TICK_AUDIENCE as the verification audience, never anything derived from the request — not req.url, not Host, not x-forwarded-host", async () => {
    const verifyIdToken = vi.fn().mockResolvedValueOnce({ email: INVOKER_SA, email_verified: true });
    // A request whose Host/x-forwarded-host headers claim a DIFFERENT
    // origin than the configured audience — a caller controls these
    // headers, so they must never influence the audience passed to
    // verifyIdToken.
    const req = fakeReq("Bearer good-token", {
      host: "attacker-controlled.example.com",
      "x-forwarded-host": "also-attacker-controlled.example.com",
    });

    await verifyInternalOidcToken(
      req,
      { issuerEmail: INVOKER_SA, audience: CONFIGURED_AUDIENCE },
      { verifyIdToken },
    );

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "good-token",
      audience: CONFIGURED_AUDIENCE,
    });
  });

  it("rejects when the token's email does not match TASKS_INVOKER_SA", async () => {
    const verifyIdToken = vi.fn().mockResolvedValueOnce({
      email: "someone-else@my-project.iam.gserviceaccount.com",
      email_verified: true,
    });
    const req = fakeReq("Bearer good-token");

    await expect(
      verifyInternalOidcToken(
        req,
        { issuerEmail: INVOKER_SA, audience: CONFIGURED_AUDIENCE },
        { verifyIdToken },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects when verifyIdToken itself throws (bad signature, wrong audience, expired)", async () => {
    const verifyIdToken = vi.fn().mockRejectedValueOnce(new Error("Wrong recipient"));
    const req = fakeReq("Bearer bad-token");

    await expect(
      verifyInternalOidcToken(
        req,
        { issuerEmail: INVOKER_SA, audience: CONFIGURED_AUDIENCE },
        { verifyIdToken },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects when TASKS_INVOKER_SA itself is not configured (never silently allows)", async () => {
    const verifyIdToken = vi.fn();
    const req = fakeReq("Bearer good-token");

    await expect(
      verifyInternalOidcToken(req, { issuerEmail: "", audience: CONFIGURED_AUDIENCE }, { verifyIdToken }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("[blocking-fix] rejects when PIPELINE_TICK_AUDIENCE itself is not configured (fails closed, same discipline as TASKS_INVOKER_SA)", async () => {
    const verifyIdToken = vi.fn();
    const req = fakeReq("Bearer good-token");

    await expect(
      verifyInternalOidcToken(req, { issuerEmail: INVOKER_SA, audience: "" }, { verifyIdToken }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
