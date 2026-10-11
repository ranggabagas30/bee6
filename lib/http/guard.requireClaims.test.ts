import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * QA verification (R-02): proves the wrong-outlet / wrong-role rejection through
 * the actual `requireClaims`/`requirePermission` guard functions that routes call
 * — not just through the pure `authorize`/`assertOutlet` functions in
 * rbac.test.ts. Mocks Firebase Admin's `verifyIdToken` (the only external
 * dependency) so the guard's own wiring (token → claims → authorize) is
 * exercised end-to-end.
 */

const verifyIdToken = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => verifyIdToken(...args),
}));

function fakeRequest(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return { headers } as unknown as NextRequest;
}

afterEach(() => {
  verifyIdToken.mockReset();
});

describe("requireClaims (end-to-end through the guard, not just the pure fns)", () => {
  it("maps a verifyIdToken failure (expired/revoked/malformed token) to 401, not 500", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const { UnauthorizedError } = await import("@/lib/http/errors");
    verifyIdToken.mockRejectedValueOnce(new Error("auth/id-token-expired"));
    await expect(
      requireClaims(fakeRequest("Bearer expired.token")),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("handleApiError of a verifyIdToken failure responds 401 UNAUTHORIZED", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const { handleApiError } = await import("@/lib/http/errors");
    verifyIdToken.mockRejectedValueOnce(new Error("auth/id-token-expired"));
    let caught: unknown;
    try {
      await requireClaims(fakeRequest("Bearer expired.token"));
    } catch (error) {
      caught = error;
    }
    const res = handleApiError(caught);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("never includes the bearer token string in the thrown error's message", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    verifyIdToken.mockRejectedValueOnce(new Error("auth/id-token-expired"));
    const secretToken = "expired.secret.token.value";
    let caught: unknown;
    try {
      await requireClaims(fakeRequest(`Bearer ${secretToken}`));
    } catch (error) {
      caught = error;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).not.toContain(secretToken);
  });

  it("returns full claims for a token carrying outlet_id + role", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    verifyIdToken.mockResolvedValueOnce({
      uid: "u1",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "proofed", role: "owner" },
    });
    const claims = await requireClaims(fakeRequest("Bearer good.token"));
    expect(claims).toEqual({ outlet_id: "proofed", role: "owner" });
  });

  it("rejects a token that has not been linked to an outlet/role yet", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const { UnauthorizedError } = await import("@/lib/http/errors");
    verifyIdToken.mockResolvedValueOnce({
      uid: "u2",
      email: "nobody@proofed.test",
      email_verified: true,
      claims: {}, // signed in with Google, but linkGoogleUser never ran
    });
    await expect(
      requireClaims(fakeRequest("Bearer unlinked.token")),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects when the bearer token is missing entirely", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const { UnauthorizedError } = await import("@/lib/http/errors");
    await expect(requireClaims(fakeRequest())).rejects.toThrow(UnauthorizedError);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});

describe("requireClaims demo session expiry (R-12)", () => {
  const verified = (claims: Record<string, unknown>) => ({
    uid: "demo-owner-sbx-1",
    email: undefined,
    email_verified: false,
    claims,
  });

  it("2.T1 a token with a past demo_exp_ms is 401 demo_session_expired", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const { UnauthorizedError } = await import("@/lib/http/errors");
    verifyIdToken.mockResolvedValueOnce(
      verified({ outlet_id: "sbx-1", role: "owner", demo_exp_ms: Date.now() - 1 }),
    );
    const err = await requireClaims(fakeRequest("Bearer demo.token")).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("demo_session_expired");
  });

  it("2.T1b a token expiring exactly now is expired (>=)", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const now = 1_800_000_000_000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      verifyIdToken.mockResolvedValueOnce(verified({ outlet_id: "sbx-1", role: "owner", demo_exp_ms: now }));
      await expect(requireClaims(fakeRequest("Bearer demo.token"))).rejects.toMatchObject({ code: "demo_session_expired" });
    } finally {
      spy.mockRestore();
    }
  });

  it("2.T2 a token with a future demo_exp_ms passes and keeps the claim", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const exp = Date.now() + 60_000;
    verifyIdToken.mockResolvedValueOnce(verified({ outlet_id: "sbx-1", role: "supervisor", demo_exp_ms: exp }));
    expect(await requireClaims(fakeRequest("Bearer demo.token"))).toEqual({
      outlet_id: "sbx-1",
      role: "supervisor",
      demo_exp_ms: exp,
    });
  });

  it("2.T5 a real token without the claim is unchanged", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    verifyIdToken.mockResolvedValueOnce(verified({ outlet_id: "proofed", role: "owner" }));
    expect(await requireClaims(fakeRequest("Bearer real.token"))).toEqual({ outlet_id: "proofed", role: "owner" });
  });
});

describe("requireClaims demo claim consistency (R-12 L1, fail closed)", () => {
  const verified = (claims: Record<string, unknown>) => ({ uid: "u", email: undefined, email_verified: false, claims });

  it("L1 an sbx- outlet token WITHOUT demo_exp_ms is 401 (a sandbox principal always expires)", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const { UnauthorizedError } = await import("@/lib/http/errors");
    verifyIdToken.mockResolvedValueOnce(verified({ outlet_id: "sbx-0123456789ab", role: "owner" }));
    const err = await requireClaims(fakeRequest("Bearer t")).catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.statusCode).toBe(401);
  });

  it("L1 a demo_exp_ms on an outlet that is not sbx- is 401, even a future one (a sandbox claim never belongs to a real shop)", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const { UnauthorizedError } = await import("@/lib/http/errors");
    for (const outlet_id of ["proofed", "demo-outlet", "demo-tpl-outlet", "xsbx-1"]) {
      verifyIdToken.mockResolvedValueOnce(verified({ outlet_id, role: "owner", demo_exp_ms: Date.now() + 60_000 }));
      const err = await requireClaims(fakeRequest("Bearer t")).catch((e) => e);
      expect(err, outlet_id).toBeInstanceOf(UnauthorizedError);
    }
  });

  it("L1 a well-formed sandbox token (sbx- outlet + future demo_exp_ms) still passes", async () => {
    const { requireClaims } = await import("@/lib/http/guard");
    const exp = Date.now() + 60_000;
    verifyIdToken.mockResolvedValueOnce(verified({ outlet_id: "sbx-0123456789ab", role: "owner", demo_exp_ms: exp }));
    expect(await requireClaims(fakeRequest("Bearer t"))).toEqual({ outlet_id: "sbx-0123456789ab", role: "owner", demo_exp_ms: exp });
  });
});

describe("requirePermission (the guard a resource route would call)", () => {
  it("passes when the token's outlet matches the requested resource's outlet", async () => {
    const { requirePermission } = await import("@/lib/http/guard");
    verifyIdToken.mockResolvedValueOnce({
      uid: "u3",
      email: "sup@proofed.test",
      email_verified: true,
      claims: { outlet_id: "proofed", role: "supervisor" },
    });
    const claims = await requirePermission(fakeRequest("Bearer sup.token"), {
      permission: "day:read:evidence",
      outletId: "proofed",
    });
    expect(claims.outlet_id).toBe("proofed");
  });

  it("rejects a wrong outlet ID even with a role that holds the permission — server-side, not UI", async () => {
    const { requirePermission } = await import("@/lib/http/guard");
    const { ForbiddenError } = await import("@/lib/http/errors");
    verifyIdToken.mockResolvedValueOnce({
      uid: "u4",
      email: "sup@proofed.test",
      email_verified: true,
      claims: { outlet_id: "proofed", role: "supervisor" }, // token says "proofed"
    });
    // ...but the request asks for a different outlet's resource.
    await expect(
      requirePermission(fakeRequest("Bearer sup.token"), {
        permission: "day:read:evidence",
        outletId: "demo-outlet",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects a role that does not hold the permission, even on the caller's own outlet", async () => {
    const { requirePermission } = await import("@/lib/http/guard");
    const { ForbiddenError } = await import("@/lib/http/errors");
    verifyIdToken.mockResolvedValueOnce({
      uid: "u5",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "proofed", role: "owner" }, // owner may not read quoted evidence
    });
    await expect(
      requirePermission(fakeRequest("Bearer owner.token"), {
        permission: "day:read:evidence",
        outletId: "proofed",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});
