import { describe, expect, it } from "vitest";
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
import { hashDeviceToken } from "@/lib/auth/pairing";
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
