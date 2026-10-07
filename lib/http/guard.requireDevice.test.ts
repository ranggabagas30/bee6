import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/http/errors";
import { hashDeviceToken } from "@/lib/auth/pairing";

/**
 * Device guard (web spec §6.6.1). Mocks the two external seams only:
 * - Firebase Admin `verifyIdToken` (the seam `requireClaims` uses), and
 * - the Firestore device store (`firestoreDeviceStore`).
 * The real `authenticateDeviceToken` and the real bcrypt check run unmodified.
 *
 * Rules under test:
 * - the bearer token is verified first; a bad or missing bearer gets the token error;
 * - a verified Firebase ID token (owner / supervisor) is a non-device principal → 403;
 * - a bad token still → 401; a missing X-Device-Id is checked only after the token.
 */

const hoisted = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  findById: vi.fn(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (...args: unknown[]) => hoisted.verifyIdToken(...args),
}));

vi.mock("@/lib/firestore/stores", () => ({
  firestoreDeviceStore: () => ({
    findById: (...args: unknown[]) => hoisted.findById(...args),
    findByPairingCode: vi.fn(),
    savePairing: vi.fn(),
  }),
}));

function fakeRequest(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

afterEach(() => {
  hoisted.verifyIdToken.mockReset();
  hoisted.findById.mockReset();
});

describe("requireDevice: token is verified before the device header", () => {
  it("a bad bearer with no X-Device-Id gets the token error, not 'Missing device id'", async () => {
    const { requireDevice } = await import("@/lib/http/guard");
    hoisted.verifyIdToken.mockRejectedValueOnce(new Error("argument-error"));

    const err = await requireDevice(
      fakeRequest({ authorization: "Bearer not-a-real-token" }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).message).toBe("Invalid device token");
    expect(hoisted.verifyIdToken).toHaveBeenCalledWith("not-a-real-token");
  });

  it("a missing bearer is a 401 'Missing bearer token' and never reaches the verifier", async () => {
    const { requireDevice } = await import("@/lib/http/guard");

    const err = await requireDevice(fakeRequest({})).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).message).toBe("Missing bearer token");
    expect(hoisted.verifyIdToken).not.toHaveBeenCalled();
  });
});

describe("requireDevice: non-device principals get 403 (§6.6.1)", () => {
  it("a verified supervisor ID token gets 403", async () => {
    const { requireDevice } = await import("@/lib/http/guard");
    hoisted.verifyIdToken.mockResolvedValueOnce({
      uid: "sup-1",
      email: "sup@proofed.test",
      email_verified: true,
      claims: { outlet_id: "proofed", role: "supervisor" },
    });

    const err = await requireDevice(
      fakeRequest({ authorization: "Bearer sup.id.token", "x-device-id": "dev-1" }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
    expect(hoisted.findById).not.toHaveBeenCalled();
  });

  it("a verified owner ID token gets 403 even without X-Device-Id", async () => {
    const { requireDevice } = await import("@/lib/http/guard");
    hoisted.verifyIdToken.mockResolvedValueOnce({
      uid: "own-1",
      email: "owner@proofed.test",
      email_verified: true,
      claims: { outlet_id: "proofed", role: "owner" },
    });

    const err = await requireDevice(
      fakeRequest({ authorization: "Bearer owner.id.token" }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenError);
  });
});

describe("requireDevice: device credential path", () => {
  it("a bad token with a device id that is unknown is a 401", async () => {
    const { requireDevice } = await import("@/lib/http/guard");
    hoisted.verifyIdToken.mockRejectedValueOnce(new Error("argument-error"));
    hoisted.findById.mockResolvedValueOnce(null);

    const err = await requireDevice(
      fakeRequest({ authorization: "Bearer junk", "x-device-id": "dev-1" }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err).not.toBeInstanceOf(ForbiddenError);
  });

  it("a valid device token for a paired device returns device claims", async () => {
    const { requireDevice } = await import("@/lib/http/guard");
    hoisted.verifyIdToken.mockRejectedValueOnce(new Error("argument-error"));
    hoisted.findById.mockResolvedValueOnce({
      outlet_id: "proofed",
      device_id: "dev-1",
      token_hash: await hashDeviceToken("good-device-token"),
      revoked: false,
      pairing_code: null,
      pairing_code_expires_at: null,
    });

    const claims = await requireDevice(
      fakeRequest({ authorization: "Bearer good-device-token", "x-device-id": "dev-1" }),
    );

    expect(claims).toEqual({ outlet_id: "proofed", role: "device", device_id: "dev-1" });
  });

  it("a wrong device token for a paired device is a 401", async () => {
    const { requireDevice } = await import("@/lib/http/guard");
    hoisted.verifyIdToken.mockRejectedValueOnce(new Error("argument-error"));
    hoisted.findById.mockResolvedValueOnce({
      outlet_id: "proofed",
      device_id: "dev-1",
      token_hash: await hashDeviceToken("good-device-token"),
      revoked: false,
      pairing_code: null,
      pairing_code_expires_at: null,
    });

    const err = await requireDevice(
      fakeRequest({ authorization: "Bearer wrong-token", "x-device-id": "dev-1" }),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedError);
    expect((err as UnauthorizedError).message).toBe("Invalid device token");
  });
});
