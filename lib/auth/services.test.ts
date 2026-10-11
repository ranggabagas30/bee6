import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import {
  authenticateDeviceToken,
  linkGoogleUser,
  pairDevice,
  staffPinLogin,
  type DeviceRecord,
  type DeviceStore,
  type StaffRecord,
  type StaffStore,
  type UserRecord,
  type UserStore,
} from "@/lib/auth/services";
import { hashPin } from "@/lib/auth/pin";
import { DUMMY_DEVICE_TOKEN_HASH, hashDeviceToken } from "@/lib/auth/pairing";
import {
  ForbiddenError,
  LockedError,
  UnauthorizedError,
} from "@/lib/http/errors";
import type { CustomClaims } from "@/lib/auth/roles";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const clock = () => NOW;

// ── in-memory fakes ──────────────────────────────────────────────────────────
function makeDeviceStore(devices: DeviceRecord[]): DeviceStore & {
  saved: { deviceId: string; token_hash: string; paired_at: string }[];
} {
  const saved: { deviceId: string; token_hash: string; paired_at: string }[] = [];
  return {
    saved,
    async findByPairingCode(code) {
      return devices.find((d) => d.pairing_code === code) ?? null;
    },
    async findById(id) {
      return devices.find((d) => d.device_id === id) ?? null;
    },
    async savePairing(deviceId, patch) {
      saved.push({ deviceId, ...patch });
      const d = devices.find((x) => x.device_id === deviceId);
      if (d) {
        d.token_hash = patch.token_hash;
        d.pairing_code = null; // single-use
        d.pairing_code_expires_at = null;
      }
    },
  };
}

function makeStaffStore(staff: StaffRecord[]): StaffStore & {
  locks: { staffId: string; failed_attempts: number; locked_until: string | null }[];
} {
  const locks: {
    staffId: string;
    failed_attempts: number;
    locked_until: string | null;
  }[] = [];
  return {
    locks,
    async findByName(outletId, name) {
      return staff.find((s) => s.outlet_id === outletId && s.name === name) ?? null;
    },
    async saveLockout(_outletId, staffId, state) {
      locks.push({ staffId, ...state });
      const s = staff.find((x) => x.staff_id === staffId);
      if (s) {
        s.failed_attempts = state.failed_attempts;
        s.locked_until = state.locked_until;
      }
    },
  };
}

function makeUserStore(users: UserRecord[]): UserStore & { savedUids: string[] } {
  const savedUids: string[] = [];
  return {
    savedUids,
    async findByEmail(email) {
      return users.find((u) => u.email === email) ?? null;
    },
    async saveUid(_outletId, email, uid) {
      savedUids.push(uid);
      const u = users.find((x) => x.email === email);
      if (u) u.uid = uid;
    },
  };
}

function device(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    outlet_id: "proofed",
    device_id: "d1",
    token_hash: null,
    revoked: false,
    pairing_code: "123456",
    pairing_code_expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

async function staffMember(overrides: Partial<StaffRecord> = {}): Promise<StaffRecord> {
  return {
    outlet_id: "proofed",
    staff_id: "s1",
    name: "Fictional Barista",
    role: "staff",
    pin_hash: await hashPin("4821"),
    failed_attempts: 0,
    locked_until: null,
    ...overrides,
  };
}

// ── pairDevice ───────────────────────────────────────────────────────────────
describe("pairDevice", () => {
  it("issues a device token for a valid code and clears the code", async () => {
    const store = makeDeviceStore([device()]);
    const result = await pairDevice({ devices: store, now: clock }, { code: "123456" });
    expect(result.device_id).toBe("d1");
    expect(result.outlet_id).toBe("proofed");
    expect(result.device_token.length).toBeGreaterThan(20);
    expect(store.saved).toHaveLength(1);
    // code is now single-use — a replay fails
    await expect(
      pairDevice({ devices: store, now: clock }, { code: "123456" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects an unknown code", async () => {
    const store = makeDeviceStore([device()]);
    await expect(
      pairDevice({ devices: store, now: clock }, { code: "000000" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("2.T2 refuses a reserved code before any store lookup, with the same error as an unknown code", async () => {
    const store = makeDeviceStore([device({ pairing_code: "000000" })]);
    let lookups = 0;
    const findByPairingCode = store.findByPairingCode.bind(store);
    store.findByPairingCode = async (code) => {
      lookups += 1;
      return findByPairingCode(code);
    };
    const reserved = await pairDevice({ devices: store, now: clock }, { code: "000000" }).catch((e: unknown) => e);
    const unknown = await pairDevice({ devices: store, now: clock }, { code: "999999" }).catch((e: unknown) => e);
    expect(reserved).toBeInstanceOf(UnauthorizedError);
    expect((reserved as Error).message).toBe((unknown as Error).message);
    expect(lookups).toBe(1); // only the unknown code reached the store
    expect(store.saved).toHaveLength(0);
  });

  it("rejects an expired code", async () => {
    const store = makeDeviceStore([
      device({ pairing_code_expires_at: new Date(NOW.getTime() - 1).toISOString() }),
    ]);
    await expect(
      pairDevice({ devices: store, now: clock }, { code: "123456" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a revoked device", async () => {
    const store = makeDeviceStore([device({ revoked: true })]);
    await expect(
      pairDevice({ devices: store, now: clock }, { code: "123456" }),
    ).rejects.toThrow(UnauthorizedError);
  });
});

// ── authenticateDeviceToken ──────────────────────────────────────────────────
describe("authenticateDeviceToken", () => {
  it("returns device claims for a valid token", async () => {
    const token = "raw-device-token-xyz";
    const store = makeDeviceStore([device({ token_hash: await hashDeviceToken(token) })]);
    const claims = await authenticateDeviceToken({ devices: store }, {
      device_id: "d1",
      token,
    });
    expect(claims).toEqual({ outlet_id: "proofed", role: "device", device_id: "d1" });
  });

  it("rejects an unpaired device", async () => {
    const store = makeDeviceStore([device({ token_hash: null })]);
    await expect(
      authenticateDeviceToken({ devices: store }, { device_id: "d1", token: "x" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects a wrong token", async () => {
    const store = makeDeviceStore([
      device({ token_hash: await hashDeviceToken("correct") }),
    ]);
    await expect(
      authenticateDeviceToken({ devices: store }, { device_id: "d1", token: "wrong" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("answers an unknown device id and a wrong token for a known id identically", async () => {
    const store = makeDeviceStore([
      device({ token_hash: await hashDeviceToken("correct") }),
    ]);
    const captureError = async (input: { device_id: string; token: string }) => {
      try {
        await authenticateDeviceToken({ devices: store }, input);
      } catch (err) {
        return err;
      }
      throw new Error("expected authenticateDeviceToken to throw");
    };
    const unknownId = await captureError({ device_id: "no-such-device", token: "correct" });
    const wrongToken = await captureError({ device_id: "d1", token: "wrong" });
    expect(unknownId).toBeInstanceOf(UnauthorizedError);
    expect(wrongToken).toBeInstanceOf(UnauthorizedError);
    const u = unknownId as UnauthorizedError;
    const w = wrongToken as UnauthorizedError;
    expect(u.statusCode).toBe(w.statusCode);
    expect(u.code).toBe(w.code);
    expect(u.message).toBe(w.message);
    expect(u.message).toBe("Invalid device token");
  });
});

describe("authenticateDeviceToken expiry (R-12)", () => {
  const nowMs = NOW.getTime();

  it("2.T3 a judge device past expires_at_ms is the same 401 as a bad token", async () => {
    const token = "judge-token";
    const store = makeDeviceStore([
      device({ token_hash: await hashDeviceToken(token), expires_at_ms: nowMs - 1 }),
    ]);
    const expired = await authenticateDeviceToken({ devices: store, now: clock }, { device_id: "d1", token }).catch((e) => e);
    const bad = await authenticateDeviceToken({ devices: store, now: clock }, { device_id: "d1", token: "wrong" }).catch((e) => e);
    expect(expired).toBeInstanceOf(UnauthorizedError);
    expect(expired.statusCode).toBe(bad.statusCode);
    expect(expired.code).toBe(bad.code);
    expect(expired.message).toBe(bad.message);
    expect(expired.message).toBe("Invalid device token");
  });

  it("2.T3b expiring exactly now is expired (>=)", async () => {
    const token = "judge-token";
    const store = makeDeviceStore([device({ token_hash: await hashDeviceToken(token), expires_at_ms: nowMs })]);
    await expect(
      authenticateDeviceToken({ devices: store, now: clock }, { device_id: "d1", token }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("2.T4 a judge device before expires_at_ms authenticates", async () => {
    const token = "judge-token";
    const store = makeDeviceStore([device({ token_hash: await hashDeviceToken(token), expires_at_ms: nowMs + 1 })]);
    expect(await authenticateDeviceToken({ devices: store, now: clock }, { device_id: "d1", token })).toEqual({
      outlet_id: "proofed",
      role: "device",
      device_id: "d1",
    });
  });

  it("2.T5 a device without expires_at_ms never expires (no now needed)", async () => {
    const token = "real-token";
    const store = makeDeviceStore([device({ token_hash: await hashDeviceToken(token) })]);
    expect(await authenticateDeviceToken({ devices: store }, { device_id: "d1", token })).toMatchObject({ role: "device" });
  });
});

// ── staffPinLogin ────────────────────────────────────────────────────────────
describe("staffPinLogin", () => {
  const mintToken = async (uid: string, claims: CustomClaims) =>
    `custom.${uid}.${claims.role}.${claims.device_id}`;

  it("mints a staff session for the right name + PIN", async () => {
    const store = makeStaffStore([await staffMember()]);
    const result = await staffPinLogin(
      { staff: store, mintToken, now: clock },
      { outlet_id: "proofed", device_id: "d1", name: "Fictional Barista", pin: "4821" },
    );
    expect(result.staff_id).toBe("s1");
    expect(result.custom_token).toBe("custom.s1.staff.d1");
    // attempts reset on success
    expect(store.locks.at(-1)).toMatchObject({ failed_attempts: 0, locked_until: null });
  });

  it("rejects an unknown name without revealing which field was wrong", async () => {
    const store = makeStaffStore([await staffMember()]);
    await expect(
      staffPinLogin(
        { staff: store, mintToken, now: clock },
        { outlet_id: "proofed", device_id: "d1", name: "Nobody", pin: "4821" },
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("counts a wrong PIN and locks after 5 tries for 15 minutes", async () => {
    const store = makeStaffStore([await staffMember()]);
    const attempt = () =>
      staffPinLogin(
        { staff: store, mintToken, now: clock },
        { outlet_id: "proofed", device_id: "d1", name: "Fictional Barista", pin: "0000" },
      );
    for (let i = 0; i < 4; i++) {
      await expect(attempt()).rejects.toThrow(UnauthorizedError);
    }
    // 5th wrong try locks
    await expect(attempt()).rejects.toThrow(LockedError);
    // subsequent attempts (even correct) are locked out
    await expect(
      staffPinLogin(
        { staff: store, mintToken, now: clock },
        { outlet_id: "proofed", device_id: "d1", name: "Fictional Barista", pin: "4821" },
      ),
    ).rejects.toThrow(LockedError);
  });

  it("rejects a malformed PIN", async () => {
    const store = makeStaffStore([await staffMember()]);
    await expect(
      staffPinLogin(
        { staff: store, mintToken, now: clock },
        { outlet_id: "proofed", device_id: "d1", name: "Fictional Barista", pin: "12" },
      ),
    ).rejects.toThrow();
  });
});

// ── linkGoogleUser ───────────────────────────────────────────────────────────
describe("linkGoogleUser", () => {
  function user(overrides: Partial<UserRecord> = {}): UserRecord {
    return {
      outlet_id: "proofed",
      uid: null,
      email: "owner@example.com",
      role: "owner",
      ...overrides,
    };
  }

  it("links a seeded verified email, sets claims, and saves the uid", async () => {
    const store = makeUserStore([user()]);
    const setClaims: { uid: string; claims: CustomClaims }[] = [];
    const result = await linkGoogleUser(
      {
        users: store,
        setClaims: async (uid, claims) => {
          setClaims.push({ uid, claims });
        },
      },
      { uid: "firebase-uid-1", email: "Owner@Example.com", email_verified: true },
    );
    expect(result).toEqual({ outlet_id: "proofed", role: "owner" });
    expect(setClaims[0]).toEqual({
      uid: "firebase-uid-1",
      claims: { outlet_id: "proofed", role: "owner" },
    });
    expect(store.savedUids).toEqual(["firebase-uid-1"]);
  });

  it("rejects an unverified email before any lookup", async () => {
    const store = makeUserStore([user()]);
    let looked = false;
    await expect(
      linkGoogleUser(
        {
          users: {
            ...store,
            findByEmail: async (email) => {
              looked = true;
              return store.findByEmail(email);
            },
          },
          setClaims: async () => {},
        },
        { uid: "firebase-uid-1", email: "owner@example.com", email_verified: false },
      ),
    ).rejects.toThrow(UnauthorizedError);
    expect(looked).toBe(false);
  });

  it("rejects a verified email that is not seeded for any outlet", async () => {
    const store = makeUserStore([user()]);
    await expect(
      linkGoogleUser(
        { users: store, setClaims: async () => {} },
        { uid: "x", email: "stranger@example.com", email_verified: true },
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ── authenticateDeviceToken: bcrypt parity on every failure branch ───────────
// Every failure must run exactly one bcrypt compare, so response time does not
// reveal whether a device id exists or is active. Spying on bcrypt.compare
// checks the work done without measuring wall-clock time.
describe("authenticateDeviceToken bcrypt parity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runAuth(
    store: DeviceStore,
    input: { device_id: string; token: string },
  ) {
    const spy = vi.spyOn(bcrypt, "compare");
    let error: unknown;
    try {
      await authenticateDeviceToken({ devices: store }, input);
    } catch (err) {
      error = err;
    }
    return { error, spy };
  }

  function expectSameUnauthorized(error: unknown) {
    expect(error).toBeInstanceOf(UnauthorizedError);
    const e = error as UnauthorizedError;
    expect(e.statusCode).toBe(401);
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("Invalid device token");
  }

  it("the dummy hash is a real bcrypt hash at the production cost (10) and matches nothing", async () => {
    expect(DUMMY_DEVICE_TOKEN_HASH).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare("any-token", DUMMY_DEVICE_TOKEN_HASH)).toBe(false);
  });

  it("unknown device id runs one compare against the dummy hash", async () => {
    const store = makeDeviceStore([
      device({ token_hash: await hashDeviceToken("correct") }),
    ]);
    const { error, spy } = await runAuth(store, { device_id: "no-such", token: "x" });
    expectSameUnauthorized(error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(DUMMY_DEVICE_TOKEN_HASH);
  });

  it("revoked device runs one compare against the dummy hash", async () => {
    const store = makeDeviceStore([
      device({ revoked: true, token_hash: await hashDeviceToken("correct") }),
    ]);
    const { error, spy } = await runAuth(store, { device_id: "d1", token: "correct" });
    expectSameUnauthorized(error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(DUMMY_DEVICE_TOKEN_HASH);
  });

  it("unpaired device (missing hash) runs one compare against the dummy hash", async () => {
    const store = makeDeviceStore([device({ token_hash: null })]);
    const { error, spy } = await runAuth(store, { device_id: "d1", token: "x" });
    expectSameUnauthorized(error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(DUMMY_DEVICE_TOKEN_HASH);
  });

  it("active device with a wrong token runs one compare against its own hash", async () => {
    const realHash = await hashDeviceToken("correct");
    const store = makeDeviceStore([device({ token_hash: realHash })]);
    const { error, spy } = await runAuth(store, { device_id: "d1", token: "wrong" });
    expectSameUnauthorized(error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(realHash);
  });

  it("active device with an empty token still runs one compare (no short-circuit)", async () => {
    const realHash = await hashDeviceToken("correct");
    const store = makeDeviceStore([device({ token_hash: realHash })]);
    const { error, spy } = await runAuth(store, { device_id: "d1", token: "" });
    expectSameUnauthorized(error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(realHash);
  });

  it("unknown device id with an empty token also runs one compare", async () => {
    const store = makeDeviceStore([
      device({ token_hash: await hashDeviceToken("correct") }),
    ]);
    const { error, spy } = await runAuth(store, { device_id: "no-such", token: "" });
    expectSameUnauthorized(error);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
