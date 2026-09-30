import type { NextRequest } from "next/server";
import { CustomClaimsSchema, type CustomClaims } from "@/lib/auth/roles";
import { UnauthorizedError } from "@/lib/http/errors";
import { authorize, type Permission } from "@/lib/auth/rbac";
import { verifyIdToken } from "@/lib/firebase/admin";
import { authenticateDeviceToken } from "@/lib/auth/services";
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
  const { claims } = await verifyIdToken(idToken);
  const parsed = CustomClaimsSchema.safeParse(claims);
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
 * Authenticates the shop device via its opaque token (`Authorization: Bearer`)
 * plus the `X-Device-Id` header. Returns device claims. Used by the staff PIN
 * route and, later, segment/heartbeat uploads.
 */
export async function requireDevice(req: NextRequest): Promise<CustomClaims> {
  const token = extractBearerToken(req);
  const deviceId = req.headers.get(DEVICE_ID_HEADER)?.trim();
  if (!deviceId) throw new UnauthorizedError("Missing device id");
  return authenticateDeviceToken(
    { devices: firestoreDeviceStore() },
    { device_id: deviceId, token },
  );
}
