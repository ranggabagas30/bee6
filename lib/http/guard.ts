import type { NextRequest } from "next/server";
import { CustomClaimsSchema, type CustomClaims } from "@/lib/auth/roles";
import { ForbiddenError, UnauthorizedError } from "@/lib/http/errors";
import { authorize, type Permission } from "@/lib/auth/rbac";
import { verifyIdToken } from "@/lib/firebase/admin";
import { authenticateDeviceToken } from "@/lib/auth/services";
import { DUMMY_DEVICE_TOKEN_HASH, verifyDeviceToken } from "@/lib/auth/pairing";
import { firestoreDeviceStore } from "@/lib/firestore/stores";

/**
 * Request guards used by every API route. They turn an incoming credential into
 * verified `CustomClaims`; routes then call `authorize` (or the guard's
 * `requirePermission`) to enforce role + outlet before any read/write. This is
 * the server-side gate (web spec §2) — the UI is never trusted.
 */

const DEVICE_ID_HEADER = "x-device-id";

/** Extracts a `Bearer <token>` credential. Pure — unit-tested. */
export function extractBearerToken(req: {
  headers: { get(name: string): string | null };
}): string {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) throw new UnauthorizedError("Missing bearer token");
  return token;
}

/**
 * Verifies a Firebase ID token (owner / supervisor / staff sessions) and returns
 * complete claims. Rejects a token that has not been linked to an outlet + role.
 */
export async function requireClaims(req: NextRequest): Promise<CustomClaims> {
  const idToken = extractBearerToken(req);
  let verified: Awaited<ReturnType<typeof verifyIdToken>>;
  try {
    verified = await verifyIdToken(idToken);
  } catch {
    // Expired, revoked, malformed, wrong project, or an opaque device token: all
    // 401, so the browser refreshes its token once and retries. Never log the
    // token.
    throw new UnauthorizedError("Invalid or expired token");
  }
  const parsed = CustomClaimsSchema.safeParse(verified.claims);
  if (!parsed.success) {
    throw new UnauthorizedError("Token is missing outlet/role claims");
  }
  return parsed.data;
}

/** As `requireClaims`, then enforces a permission against a target outlet. */
export async function requirePermission(
  req: NextRequest,
  params: { permission: Permission; outletId: string },
): Promise<CustomClaims> {
  const claims = await requireClaims(req);
  return authorize(claims, params);
}

/**
 * True when the bearer is a Firebase ID token that verifies (owner / supervisor /
 * staff session). Any verification failure, including the opaque device token
 * (which is not a JWT), returns false.
 */
async function isVerifiedUserToken(token: string): Promise<boolean> {
  try {
    await verifyIdToken(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticates the shop device (web spec §6.6.1). Order matters:
 * 1. The bearer is checked first. A verified Firebase ID token is a non-device
 *    principal → 403. A bad or missing bearer → 401.
 * 2. Only then is the opaque device token checked against the device named by
 *    `X-Device-Id`. The device token is stored as a bcrypt hash, so it cannot be
 *    verified without its device id: a missing header yields the same 401 as a
 *    bad token.
 * Returns device claims. Used by the staff PIN route, the capture session routes,
 * the config and heartbeat routes, and segment uploads.
 */
export async function requireDevice(req: NextRequest): Promise<CustomClaims> {
  const token = extractBearerToken(req);
  if (await isVerifiedUserToken(token)) {
    throw new ForbiddenError("A device credential is required");
  }
  const deviceId = req.headers.get(DEVICE_ID_HEADER)?.trim();
  if (!deviceId) {
    // Same cost as every other device-auth failure: one compare, then the same 401.
    await verifyDeviceToken(token, DUMMY_DEVICE_TOKEN_HASH);
    throw new UnauthorizedError("Invalid device token");
  }
  return authenticateDeviceToken(
    { devices: firestoreDeviceStore() },
    { device_id: deviceId, token },
  );
}
