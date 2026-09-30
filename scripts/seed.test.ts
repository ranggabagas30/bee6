import { describe, expect, it } from "vitest";
import {
  DEMO_SEED,
  SeedConfigSchema,
  buildSeedDocuments,
} from "@/scripts/seed";
import {
  DeviceSchema,
  OutletSchema,
  StaffSchema,
  UserSchema,
} from "@/lib/firestore/schema";

const NOW = new Date("2026-09-30T12:00:00.000Z");
// Deterministic fake hash so the builder test needs no bcrypt work.
const fakeHash = async (pin: string) => `hash(${pin})`;

describe("SeedConfig / DEMO_SEED", () => {
  it("the built-in demo config is valid and fictional", () => {
    expect(SeedConfigSchema.safeParse(DEMO_SEED).success).toBe(true);
    // sanity: no obviously-real domain leaked into demo data
    expect(DEMO_SEED.owner.email.endsWith("@example.com")).toBe(true);
  });
});

describe("buildSeedDocuments", () => {
  it("produces schema-valid docs with the right project kind", async () => {
    const docs = await buildSeedDocuments(DEMO_SEED, "demo", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });

    expect(OutletSchema.safeParse(docs.outlet).success).toBe(true);
    expect(docs.outlet.project_kind).toBe("demo");
    for (const user of docs.users) expect(UserSchema.safeParse(user).success).toBe(true);
    for (const member of docs.staff) expect(StaffSchema.safeParse(member).success).toBe(true);
    expect(DeviceSchema.safeParse(docs.device).success).toBe(true);
  });

  it("hashes PINs (never stores plaintext) and lowercases emails", async () => {
    const docs = await buildSeedDocuments(DEMO_SEED, "demo", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });
    for (const member of docs.staff) {
      expect(member.pin_hash).toMatch(/^hash\(\d{4}\)$/);
    }
    expect(docs.users[0]?.email).toBe(docs.users[0]?.email.toLowerCase());
  });

  it("stores a normalized name_key alongside the display name", async () => {
    const config = {
      ...DEMO_SEED,
      staff: [
        { staff_id: "s1", name: "  Ari   Demo ", role: "staff" as const, pin: "1234" },
      ],
    };
    const docs = await buildSeedDocuments(config, "demo", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });
    expect(docs.staff[0]?.name).toBe("  Ari   Demo "); // display name kept as-is
    expect(docs.staff[0]?.name_key).toBe("ari demo"); // matched on normalized key
  });

  it("creates one owner user and one user per supervisor", async () => {
    const docs = await buildSeedDocuments(DEMO_SEED, "demo", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });
    const owners = docs.users.filter((u) => u.role === "owner");
    const supervisors = docs.users.filter((u) => u.role === "supervisor");
    expect(owners).toHaveLength(1);
    expect(supervisors).toHaveLength(DEMO_SEED.supervisors.length);
  });

  it("sets the pairing code and a 10-minute expiry on the device", async () => {
    const docs = await buildSeedDocuments(DEMO_SEED, "demo", {
      pairingCode: "654321",
      now: NOW,
      hash: fakeHash,
    });
    expect(docs.device.pairing_code).toBe("654321");
    expect(docs.device.token_hash).toBeNull();
    expect(docs.device.paired_at).toBeNull();
    const expiry = new Date(docs.device.pairing_code_expires_at!).getTime();
    expect(expiry - NOW.getTime()).toBe(10 * 60 * 1000);
  });

  it("rejects a config with a non-4-digit PIN", () => {
    const bad = {
      ...DEMO_SEED,
      staff: [{ staff_id: "x", name: "X", role: "staff", pin: "12" }],
    };
    expect(SeedConfigSchema.safeParse(bad).success).toBe(false);
  });
});
