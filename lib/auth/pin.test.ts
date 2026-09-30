import { describe, expect, it } from "vitest";
import {
  LOCK_DURATION_MS,
  MAX_PIN_ATTEMPTS,
  assertValidPinFormat,
  hashPin,
  isLocked,
  lockRemainingSeconds,
  registerFailedAttempt,
  resetAttempts,
  verifyPin,
  type LockoutState,
} from "@/lib/auth/pin";
import { ValidationError } from "@/lib/http/errors";

describe("PIN format", () => {
  it("accepts a 4-digit PIN", () => {
    expect(() => assertValidPinFormat("0429")).not.toThrow();
  });

  it("rejects non-4-digit PINs", () => {
    for (const bad of ["123", "12345", "abcd", "12a4", "", " 123"]) {
      expect(() => assertValidPinFormat(bad)).toThrow(ValidationError);
    }
  });
});

describe("hash / verify", () => {
  it("round-trips a correct PIN and rejects a wrong one", async () => {
    const hash = await hashPin("4821");
    expect(hash).not.toContain("4821"); // not stored in the clear
    expect(await verifyPin("4821", hash)).toBe(true);
    expect(await verifyPin("4822", hash)).toBe(false);
  });

  it("verify returns false for a malformed PIN without throwing", async () => {
    const hash = await hashPin("4821");
    expect(await verifyPin("48", hash)).toBe(false);
  });

  it("hashPin rejects a malformed PIN", async () => {
    await expect(hashPin("12")).rejects.toThrow(ValidationError);
  });
});

describe("lockout transitions", () => {
  const start: LockoutState = { failed_attempts: 0, locked_until: null };
  const now = new Date("2026-09-30T12:00:00.000Z");

  it("increments attempts on each wrong PIN below the threshold", () => {
    let state = start;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      state = registerFailedAttempt(state, now);
      expect(state.failed_attempts).toBe(i);
      expect(isLocked(state, now)).toBe(false);
    }
  });

  it("locks for 15 minutes on the 5th wrong PIN", () => {
    let state = start;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      state = registerFailedAttempt(state, now);
    }
    expect(isLocked(state, now)).toBe(true);
    // counter resets so the lock is the only gate now
    expect(state.failed_attempts).toBe(0);
    const expectedUnlock = new Date(now.getTime() + LOCK_DURATION_MS);
    expect(state.locked_until).toBe(expectedUnlock.toISOString());
  });

  it("lock lifts exactly at locked_until", () => {
    let state = start;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) state = registerFailedAttempt(state, now);
    const justBefore = new Date(now.getTime() + LOCK_DURATION_MS - 1);
    const atUnlock = new Date(now.getTime() + LOCK_DURATION_MS);
    expect(isLocked(state, justBefore)).toBe(true);
    expect(isLocked(state, atUnlock)).toBe(false);
    expect(lockRemainingSeconds(state, now)).toBe(LOCK_DURATION_MS / 1000);
    expect(lockRemainingSeconds(state, atUnlock)).toBe(0);
  });

  it("a correct PIN resets the counter", () => {
    let state = registerFailedAttempt(start, now);
    state = registerFailedAttempt(state, now);
    expect(state.failed_attempts).toBe(2);
    const cleared = resetAttempts();
    expect(cleared.failed_attempts).toBe(0);
    expect(cleared.locked_until).toBeNull();
  });

  it("is not locked when locked_until is null", () => {
    expect(isLocked({ failed_attempts: 2, locked_until: null }, now)).toBe(false);
    expect(lockRemainingSeconds({ failed_attempts: 2, locked_until: null }, now)).toBe(0);
  });
});
