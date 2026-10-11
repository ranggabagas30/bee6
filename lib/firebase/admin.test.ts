import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));

vi.mock("firebase-admin/app", () => ({
  applicationDefault: () => ({}),
  getApps: () => [{}],
  initializeApp: () => ({}),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: (...a: unknown[]) => hoisted.verifyIdToken(...a) }),
}));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));

import { verifyIdToken } from "@/lib/firebase/admin";

beforeEach(() => hoisted.verifyIdToken.mockReset());

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
