import { afterEach, describe, expect, it, vi } from "vitest";
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

  describe("M1: the client never learns why (generic 401), the server log names the cause", () => {
    const rejection = async (
      req: ReturnType<typeof fakeReq>,
      opts: { issuerEmail: string; audience: string; audienceEnvName?: string },
      verifyIdToken: ReturnType<typeof vi.fn> = vi.fn(),
    ) => {
      const err = await verifyInternalOidcToken(req, opts, { verifyIdToken }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
      return err as UnauthorizedError;
    };

    afterEach(() => vi.restoreAllMocks());

    it("every failure path throws exactly 'Unauthorized'", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const good = { issuerEmail: INVOKER_SA, audience: CONFIGURED_AUDIENCE };
      const messages = [
        (await rejection(fakeReq("Bearer t"), { issuerEmail: "", audience: CONFIGURED_AUDIENCE })).message,
        (await rejection(fakeReq("Bearer t"), { issuerEmail: INVOKER_SA, audience: "" })).message,
        (await rejection(fakeReq(null), good)).message,
        (await rejection(fakeReq("Bearer t"), good, vi.fn().mockRejectedValue(new Error("Wrong recipient")))).message,
        (await rejection(fakeReq("Bearer t"), good, vi.fn().mockResolvedValue({ email: "x@y.z", email_verified: true }))).message,
      ];
      expect(messages).toEqual(Array(5).fill("Unauthorized"));
    });

    it("a missing audience is logged server-side with the env var the caller named, not PIPELINE_TICK_AUDIENCE", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await rejection(fakeReq("Bearer t"), { issuerEmail: INVOKER_SA, audience: "", audienceEnvName: "REVIEW_RUN_AUDIENCE" });
      expect(error).toHaveBeenCalledWith("[oidc] misconfigured", { var: "REVIEW_RUN_AUDIENCE" });
    });

    it("a missing invoker SA is logged as misconfigured", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await rejection(fakeReq("Bearer t"), { issuerEmail: "", audience: CONFIGURED_AUDIENCE });
      expect(error).toHaveBeenCalledWith("[oidc] misconfigured", { var: "TASKS_INVOKER_SA" });
    });

    it("a rejected token is logged with a reason but never the token, the audience or the email", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const verifyIdToken = vi.fn().mockRejectedValue(new Error("Wrong recipient"));
      await rejection(fakeReq("Bearer secret-token-123"), { issuerEmail: INVOKER_SA, audience: CONFIGURED_AUDIENCE }, verifyIdToken);
      expect(warn).toHaveBeenCalledWith("[oidc] rejected", { reason: "token_invalid" });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token-123");
    });
  });
});
