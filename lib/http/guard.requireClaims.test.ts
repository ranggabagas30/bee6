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
