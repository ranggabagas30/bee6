import { describe, expect, it } from "vitest";
import {
  PAIRING_CODE_TTL_MS,
  RESERVED_PAIRING_CODES,
  generateDeviceToken,
  generatePairingCode,
  hashDeviceToken,
  isPairingCodeExpired,
  pairingCodeExpiry,
  verifyDeviceToken,
} from "@/lib/auth/pairing";

describe("pairing code", () => {
  it("is always exactly 6 digits", () => {
    for (let i = 0; i < 500; i++) {
      expect(generatePairingCode()).toMatch(/^\d{6}$/);
    }
  });

  it("2.T1 never returns a reserved code: a draw of 0 is redrawn", () => {
    const draws = [0, 0, 42];
    const draw = (): number => draws.shift() ?? 7;
    expect(generatePairingCode(draw)).toBe("000042");
    expect(draws).toHaveLength(0);
  });

  it("reserves exactly the published demo staff code", () => {
    expect([...RESERVED_PAIRING_CODES]).toEqual(["000000"]);
  });

  it("expires 10 minutes from now", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const expiry = pairingCodeExpiry(now);
    expect(new Date(expiry).getTime() - now.getTime()).toBe(PAIRING_CODE_TTL_MS);
  });

  it("treats a null expiry as expired", () => {
    expect(isPairingCodeExpired(null)).toBe(true);
  });

  it("is valid before expiry and expired at/after it", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    const expiry = pairingCodeExpiry(now);
    const justBefore = new Date(now.getTime() + PAIRING_CODE_TTL_MS - 1);
    const atExpiry = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
    expect(isPairingCodeExpired(expiry, justBefore)).toBe(false);
    expect(isPairingCodeExpired(expiry, atExpiry)).toBe(true);
  });
});

describe("device token", () => {
  it("generates distinct high-entropy url-safe tokens", () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes and verifies (raw token never equals its hash)", async () => {
    const token = generateDeviceToken();
    const hash = await hashDeviceToken(token);
    expect(hash).not.toBe(token);
    expect(await verifyDeviceToken(token, hash)).toBe(true);
    expect(await verifyDeviceToken(generateDeviceToken(), hash)).toBe(false);
  });

  it("verify returns false for an empty token", async () => {
    const hash = await hashDeviceToken(generateDeviceToken());
    expect(await verifyDeviceToken("", hash)).toBe(false);
  });
});
