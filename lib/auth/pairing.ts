import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Shop-device pairing (web spec §3). The seed script prints a 6-digit code valid
 * 10 minutes; the phone types it at `/pair` and receives a long-lived, opaque
 * device token. The token is stored HASHED on the device doc and presented as a
 * Bearer credential on segment/heartbeat uploads. Revoke = set `revoked:true`.
 *
 * The pairing code is low-entropy by design (typed by hand), so it is protected
 * by a short TTL + single use rather than by hashing (hashing would also block
 * the equality lookup used to find the device). The device TOKEN, by contrast,
 * is high-entropy and stored hashed.
 */

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const DEVICE_TOKEN_BYTES = 32;
const BCRYPT_ROUNDS = 10;

/**
 * Codes that are never a real pairing code (R-18). `000000` is the published demo staff code, so it must not be
 * able to pair a device into a real shop: it is never generated, and `pairDevice` refuses it before any lookup.
 */
export const RESERVED_PAIRING_CODES: ReadonlySet<string> = new Set(["000000"]);

/**
 * A cryptographically-random 6-digit pairing code (leading zeros allowed), never a reserved one (redrawn;
 * the expected number of draws stays about 1). `draw` is a test seam for the random source.
 */
export function generatePairingCode(draw: (min: number, max: number) => number = randomInt): string {
  for (;;) {
    const code = String(draw(0, 1_000_000)).padStart(6, "0");
    if (!RESERVED_PAIRING_CODES.has(code)) return code;
  }
}

/** ISO expiry `PAIRING_CODE_TTL_MS` from `now`. */
export function pairingCodeExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();
}

/** True if `expiresAt` is null or already in the past. */
export function isPairingCodeExpired(
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  return now.getTime() >= new Date(expiresAt).getTime();
}

/** A high-entropy opaque device token (URL-safe). Returned once, never stored raw. */
export function generateDeviceToken(): string {
  return randomBytes(DEVICE_TOKEN_BYTES).toString("base64url");
}

export async function hashDeviceToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_ROUNDS);
}

/**
 * A real bcrypt hash (cost `BCRYPT_ROUNDS`) of a random throwaway string that
 * was discarded at creation. It matches no token. `authenticateDeviceToken`
 * compares against it on failure branches with no real hash (unknown id,
 * revoked, unpaired), so those branches cost one bcrypt compare, the same as a
 * wrong token on a real device. Without it, response time would reveal whether
 * a device id exists and is active.
 */
export const DUMMY_DEVICE_TOKEN_HASH =
  "$2b$10$Uoc3KESv6chAwuWYGUtqdufCNwR0HlMTLvI15p6QCErRBHgFKFbnS";

/**
 * Always runs one bcrypt compare, including for an empty token, so the cost of
 * a check does not depend on the input.
 */
export async function verifyDeviceToken(
  token: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(token, hash);
}
