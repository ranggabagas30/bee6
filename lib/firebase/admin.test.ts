import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ verifyIdToken: vi.fn(), getFirestore: vi.fn() }));

vi.mock("firebase-admin/app", () => ({
  applicationDefault: () => ({}),
  getApps: () => [{}],
  initializeApp: () => ({}),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: (...a: unknown[]) => hoisted.verifyIdToken(...a) }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: (...a: unknown[]) => hoisted.getFirestore(...a),
}));

import { adminDb, verifyIdToken } from "@/lib/firebase/admin";

beforeEach(() => {
  hoisted.verifyIdToken.mockReset();
  hoisted.getFirestore.mockReset();
  hoisted.getFirestore.mockReturnValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("adminDb database selection (FIRESTORE_DATABASE_ID)", () => {
  it('opens "(default)" when the variable is unset', () => {
    vi.stubEnv("FIRESTORE_DATABASE_ID", undefined);
    adminDb();
    expect(hoisted.getFirestore).toHaveBeenCalledTimes(1);
    expect(hoisted.getFirestore.mock.calls[0]![1]).toBe("(default)");
  });

  it('opens "(default)" when the variable is an empty string', () => {
    vi.stubEnv("FIRESTORE_DATABASE_ID", "");
    adminDb();
    expect(hoisted.getFirestore.mock.calls[0]![1]).toBe("(default)");
  });

  it("opens the named database when the variable is set", () => {
    vi.stubEnv("FIRESTORE_DATABASE_ID", "staging");
    adminDb();
    expect(hoisted.getFirestore.mock.calls[0]![1]).toBe("staging");
  });

  it("reads the variable on each call, not at import time", () => {
    vi.stubEnv("FIRESTORE_DATABASE_ID", "staging");
    adminDb();
    vi.stubEnv("FIRESTORE_DATABASE_ID", "");
    adminDb();
    expect(hoisted.getFirestore.mock.calls.map((c) => c[1])).toEqual(["staging", "(default)"]);
  });
});

describe("verifyIdToken claims (R-12 demo_exp_ms)", () => {
  it("passes demo_exp_ms through to claims", async () => {
    hoisted.verifyIdToken.mockResolvedValue({
      uid: "demo-owner-sbx-1",
      outlet_id: "sbx-1",
      role: "owner",
      demo_exp_ms: 1_700_000_000_000,
    });
    const v = await verifyIdToken("t");
    expect(v.claims).toEqual({ outlet_id: "sbx-1", role: "owner", demo_exp_ms: 1_700_000_000_000 });
  });

  it("real tokens without demo_exp_ms are unchanged", async () => {
    hoisted.verifyIdToken.mockResolvedValue({ uid: "u1", outlet_id: "o1", role: "supervisor" });
    const v = await verifyIdToken("t");
    expect(v.claims).toEqual({ outlet_id: "o1", role: "supervisor" });
  });
});
