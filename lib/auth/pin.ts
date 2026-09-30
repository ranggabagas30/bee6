import bcrypt from "bcryptjs";
import { z } from "zod";
import { ValidationError } from "@/lib/http/errors";

/**
 * Staff PIN handling (web spec §3, §6.5). PINs are hashed with bcrypt (bcryptjs,
 * a pure-JS implementation — no native build, so it runs under Cloud Run
 * buildpacks and the test sandbox). A PIN is a person's shared secret; only its
 * hash is stored, in the `staff` collection.
 *
 * Lockout: 5 wrong PINs → locked 15 minutes. The lockout STATE lives on the
 * staff document (`failed_attempts`, `locked_until`); the transitions below are
 * pure functions so they can be unit-tested without Firestore.
 */

export const MAX_PIN_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

/** A PIN is exactly four digits. */
export const PinSchema = z.string().regex(/^\d{4}$/, "PIN must be 4 digits");

/** Throws ValidationError unless `pin` is exactly four digits. */
export function assertValidPinFormat(pin: string): void {
  const result = PinSchema.safeParse(pin);
  if (!result.success) {
    throw new ValidationError("PIN must be exactly 4 digits");
  }
}

export async function hashPin(pin: string): Promise<string> {
  assertValidPinFormat(pin);
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!PinSchema.safeParse(pin).success) return false;
  return bcrypt.compare(pin, hash);
}

/** The subset of a staff doc the lockout logic reads/writes. */
export interface LockoutState {
  failed_attempts: number;
  locked_until: string | null; // ISO
}

/** True if the account is currently locked (now < locked_until). */
export function isLocked(state: LockoutState, now: Date = new Date()): boolean {
  if (!state.locked_until) return false;
  return now.getTime() < new Date(state.locked_until).getTime();
}

/** Seconds until the lock lifts (0 if not locked). */
export function lockRemainingSeconds(
  state: LockoutState,
  now: Date = new Date(),
): number {
  if (!state.locked_until) return 0;
  const ms = new Date(state.locked_until).getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * Next lockout state after a wrong PIN. When the attempt count reaches
 * MAX_PIN_ATTEMPTS the account locks for LOCK_DURATION_MS and the counter resets
 * (so the next 5 wrong tries after the lock lifts trigger another lock).
 */
export function registerFailedAttempt(
  state: LockoutState,
  now: Date = new Date(),
): LockoutState {
  const attempts = state.failed_attempts + 1;
  if (attempts >= MAX_PIN_ATTEMPTS) {
    return {
      failed_attempts: 0,
      locked_until: new Date(now.getTime() + LOCK_DURATION_MS).toISOString(),
    };
  }
  return { failed_attempts: attempts, locked_until: null };
}

/** State after a correct PIN: counter cleared, no lock. */
export function resetAttempts(): LockoutState {
  return { failed_attempts: 0, locked_until: null };
}
