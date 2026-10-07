import {
  ForbiddenError,
  UnauthorizedError,
  LockedError,
} from "@/lib/http/errors";
import type { CustomClaims, GoogleUserRole, UserRole } from "@/lib/auth/roles";
import {
  assertValidPinFormat,
  isLocked,
  lockRemainingSeconds,
  registerFailedAttempt,
  resetAttempts,
  verifyPin,
  type LockoutState,
} from "@/lib/auth/pin";
import {
  DUMMY_DEVICE_TOKEN_HASH,
  generateDeviceToken,
  hashDeviceToken,
  isPairingCodeExpired,
  verifyDeviceToken,
} from "@/lib/auth/pairing";

/**
 * Auth services (web spec §3). Pure orchestration over injected stores + a token
 * minter, so every branch is unit-testable without Firestore or Firebase. The
 * Firestore-backed stores live in lib/firestore/stores.ts; the routes wire the
 * two together.
 *
 * Failure messages are deliberately non-committal ("Invalid name or PIN") so a
 * caller can't enumerate valid names, codes or PINs.
 */

// ── record shapes (the subset each service reads) ────────────────────────────
export interface DeviceRecord {
  outlet_id: string;
  device_id: string;
  token_hash: string | null;
  revoked: boolean;
  pairing_code: string | null;
  pairing_code_expires_at: string | null;
}

export interface StaffRecord {
  outlet_id: string;
  staff_id: string;
  name: string;
  role: UserRole;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | null;
}

export interface UserRecord {
  outlet_id: string;
  uid: string | null;
  email: string;
  role: GoogleUserRole;
}

// ── store interfaces ─────────────────────────────────────────────────────────
export interface DeviceStore {
  findByPairingCode(code: string): Promise<DeviceRecord | null>;
  findById(deviceId: string): Promise<DeviceRecord | null>;
  /** Persist a successful pair: store the token hash and clear the used code. */
  savePairing(
    deviceId: string,
    patch: { token_hash: string; paired_at: string },
  ): Promise<void>;
}

export interface StaffStore {
  findByName(outletId: string, name: string): Promise<StaffRecord | null>;
  saveLockout(
    outletId: string,
    staffId: string,
    state: LockoutState,
  ): Promise<void>;
}

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  saveUid(outletId: string, email: string, uid: string): Promise<void>;
}

type Clock = () => Date;
const systemClock: Clock = () => new Date();

// ── pairDevice ───────────────────────────────────────────────────────────────
export interface PairDeviceDeps {
  devices: DeviceStore;
  now?: Clock;
}

export interface PairDeviceResult {
  device_id: string;
  outlet_id: string;
  /** The long-lived opaque device token — returned once, never re-derivable. */
  device_token: string;
}

/**
 * Exchange a 6-digit pairing code for a device token. The code must exist, be
 * unexpired, and belong to a device that isn't revoked. Single-use: the store
 * clears the code on save, so replaying the same code fails.
 */
export async function pairDevice(
  deps: PairDeviceDeps,
  input: { code: string },
): Promise<PairDeviceResult> {
  const now = (deps.now ?? systemClock)();
  const device = await deps.devices.findByPairingCode(input.code);
  if (!device || device.revoked) {
    throw new UnauthorizedError("Invalid or expired pairing code");
  }
  if (isPairingCodeExpired(device.pairing_code_expires_at, now)) {
    throw new UnauthorizedError("Invalid or expired pairing code");
  }

  const token = generateDeviceToken();
  const token_hash = await hashDeviceToken(token);
  await deps.devices.savePairing(device.device_id, {
    token_hash,
    paired_at: now.toISOString(),
  });

  return {
    device_id: device.device_id,
    outlet_id: device.outlet_id,
    device_token: token,
  };
}

// ── authenticateDeviceToken ──────────────────────────────────────────────────
export interface DeviceAuthDeps {
  devices: DeviceStore;
}

/**
 * Verify an opaque device token against the stored hash and return device
 * claims. Used by the device guard for segment/heartbeat uploads (R-03/R-04).
 */
export async function authenticateDeviceToken(
  deps: DeviceAuthDeps,
  input: { device_id: string; token: string },
): Promise<CustomClaims> {
  // One message for every failure (unknown id, revoked, unpaired, wrong token),
  // so a caller cannot tell whether a device id exists. Every failure also runs
  // one bcrypt compare, so the timing does not reveal it either.
  const device = await deps.devices.findById(input.device_id);
  if (!device || device.revoked || !device.token_hash) {
    await verifyDeviceToken(input.token, DUMMY_DEVICE_TOKEN_HASH);
    throw new UnauthorizedError("Invalid device token");
  }
  const ok = await verifyDeviceToken(input.token, device.token_hash);
  if (!ok) throw new UnauthorizedError("Invalid device token");
  return {
    outlet_id: device.outlet_id,
    role: "device",
    device_id: device.device_id,
  };
}

// ── staffPinLogin ────────────────────────────────────────────────────────────
export interface StaffPinLoginDeps {
  staff: StaffStore;
  /** Mints a Firebase custom token carrying the staff claims. */
  mintToken: (uid: string, claims: CustomClaims) => Promise<string>;
  now?: Clock;
}

export interface StaffPinLoginResult {
  custom_token: string;
  staff_id: string;
}

/**
 * Name + 4-digit PIN on a paired device → a staff session (Firebase custom
 * token). Enforces the 5-wrong → 15-min lockout. `outlet_id`/`device_id` come
 * from the already-authenticated device principal, so a staff session is always
 * tied to the outlet's paired phone.
 */
export async function staffPinLogin(
  deps: StaffPinLoginDeps,
  input: { outlet_id: string; device_id: string; name: string; pin: string },
): Promise<StaffPinLoginResult> {
  assertValidPinFormat(input.pin);
  const now = (deps.now ?? systemClock)();

  const staff = await deps.staff.findByName(input.outlet_id, input.name);
  if (!staff) {
    // Do not reveal whether the name or the PIN was wrong.
    throw new UnauthorizedError("Invalid name or PIN");
  }

  const state: LockoutState = {
    failed_attempts: staff.failed_attempts,
    locked_until: staff.locked_until,
  };
  if (isLocked(state, now)) {
    throw new LockedError(
      lockRemainingSeconds(state, now),
      "Too many attempts. Try again later.",
    );
  }

  const pinOk = await verifyPin(input.pin, staff.pin_hash);
  if (!pinOk) {
    const next = registerFailedAttempt(state, now);
    await deps.staff.saveLockout(input.outlet_id, staff.staff_id, next);
    if (isLocked(next, now)) {
      throw new LockedError(
        lockRemainingSeconds(next, now),
        "Too many attempts. Try again later.",
      );
    }
    throw new UnauthorizedError("Invalid name or PIN");
  }

  await deps.staff.saveLockout(input.outlet_id, staff.staff_id, resetAttempts());

  const claims: CustomClaims = {
    outlet_id: input.outlet_id,
    role: "staff",
    staff_id: staff.staff_id,
    device_id: input.device_id,
  };
  const custom_token = await deps.mintToken(staff.staff_id, claims);
  return { custom_token, staff_id: staff.staff_id };
}

// ── linkGoogleUser ───────────────────────────────────────────────────────────
export interface LinkGoogleUserDeps {
  users: UserStore;
  /** Sets Firebase custom claims on the signed-in uid. */
  setClaims: (uid: string, claims: CustomClaims) => Promise<void>;
}

export interface LinkGoogleUserResult {
  outlet_id: string;
  role: GoogleUserRole;
}

/**
 * After a verified Google sign-in, link the account's role by matching the
 * verified email to a seeded `users` doc, then set custom claims. Rejects an
 * unverified email (never grant access on one) and an email that isn't seeded
 * for any outlet (no self-serve access).
 */
export async function linkGoogleUser(
  deps: LinkGoogleUserDeps,
  input: { uid: string; email: string; email_verified: boolean },
): Promise<LinkGoogleUserResult> {
  if (!input.email_verified) {
    throw new UnauthorizedError("Google account email is not verified");
  }
  const email = input.email.toLowerCase();
  const user = await deps.users.findByEmail(email);
  if (!user) {
    throw new ForbiddenError(
      "This Google account is not authorised for any outlet.",
    );
  }
  const claims: CustomClaims = { outlet_id: user.outlet_id, role: user.role };
  await deps.setClaims(input.uid, claims);
  if (user.uid !== input.uid) {
    await deps.users.saveUid(user.outlet_id, email, input.uid);
  }
  return { outlet_id: user.outlet_id, role: user.role };
}
