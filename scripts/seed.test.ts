import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";

// Wraps real node:fs so the SOP-separation guard test can spy on
// readFileSync/existsSync without hitting vitest's "cannot redefine a
// readonly ESM export" limitation — every other test in this file uses the
// real implementation underneath (vi.fn(actual.fn) still calls through).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync), existsSync: vi.fn(actual.existsSync) };
});

import {
  DEMO_SEED,
  DEMO_TEMPLATE_SEED,
  SeedConfigSchema,
  parseTemplateArg,
  selectSeedConfig,
  assertProjectMatchesEnv,
  buildSeedDocuments,
  buildSopVersionDoc,
  loadConfig,
  writeSopVersionIfAbsent,
  seedPairingCode,
} from "@/scripts/seed";
import {
  DeviceSchema,
  OutletSchema,
  SopVersionSchema,
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

describe("R-08 Task 2.3: sop_v1", () => {
  it("DEMO_SEED parses with the SOP block", () => {
    expect(SeedConfigSchema.safeParse(DEMO_SEED).success).toBe(true);
    expect(DEMO_SEED.sop_v1?.steps.length).toBeGreaterThan(0);
  });

  it("buildSeedDocuments writes an sop doc that parses with SopVersionSchema", async () => {
    const docs = await buildSeedDocuments(DEMO_SEED, "demo", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });
    expect(docs.sopVersion).not.toBeNull();
    expect(SopVersionSchema.safeParse(docs.sopVersion).success).toBe(true);
    expect(docs.sopVersion?.sop_version_id).toBe(`${docs.outlet.outlet_id}:v1`);
    expect(docs.sopVersion?.source).toBe("seed");
    expect(docs.sopVersion?.source_proposal_id).toBeNull();
  });

  it("a config with no sop_v1 builds sopVersion: null", async () => {
    const { sop_v1: _drop, ...withoutSop } = DEMO_SEED;
    const docs = await buildSeedDocuments(withoutSop, "demo", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });
    expect(docs.sopVersion).toBeNull();
  });

  function fakeDb(existingIds: Set<string>) {
    const written: Array<{ id: string; doc: unknown }> = [];
    const db = {
      collection: () => ({
        doc: (id: string) => ({
          get: async () => ({ exists: existingIds.has(id) }),
          set: async (doc: unknown) => {
            written.push({ id, doc });
          },
        }),
      }),
    };
    return { db, written };
  }

  it("does not overwrite an existing :v1 doc", async () => {
    const sopVersion = buildSopVersionDoc("demo-outlet", DEMO_SEED.sop_v1!, NOW.getTime());
    const { db, written } = fakeDb(new Set(["demo-outlet:v1"]));
    const wroteIt = await writeSopVersionIfAbsent(db as never, sopVersion);
    expect(wroteIt).toBe(false);
    expect(written).toHaveLength(0);
  });

  it("writes the doc when absent", async () => {
    const sopVersion = buildSopVersionDoc("demo-outlet", DEMO_SEED.sop_v1!, NOW.getTime());
    const { db, written } = fakeDb(new Set());
    const wroteIt = await writeSopVersionIfAbsent(db as never, sopVersion);
    expect(wroteIt).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]?.id).toBe("demo-outlet:v1");
  });

  it("a pilot config without sop_v1 still seeds", async () => {
    const { sop_v1: _drop, ...pilotLike } = DEMO_SEED;
    const docs = await buildSeedDocuments(pilotLike, "pilot", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });
    expect(docs.sopVersion).toBeNull();
    expect(OutletSchema.safeParse(docs.outlet).success).toBe(true);
  });

  it("a pilot config WITH sop_v1 (fictional steps) writes sop_versions/<pilot outlet>:v1", async () => {
    const pilotConfig = { ...DEMO_SEED, outlet: { ...DEMO_SEED.outlet, outlet_id: "pilot-outlet" } };
    const docs = await buildSeedDocuments(pilotConfig, "pilot", {
      pairingCode: "123456",
      now: NOW,
      hash: fakeHash,
    });
    expect(docs.sopVersion?.sop_version_id).toBe("pilot-outlet:v1");
  });
});

describe("R-08 §0 item 5: SOP separation guards", () => {
  it('loadConfig("demo") returns DEMO_SEED.sop_v1 verbatim and never touches fs', () => {
    vi.mocked(fs.readFileSync).mockClear();
    vi.mocked(fs.existsSync).mockClear();
    const config = loadConfig("demo");
    expect(config.sop_v1?.steps).toEqual(DEMO_SEED.sop_v1?.steps);
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.existsSync).not.toHaveBeenCalled();
  });

  it("assertProjectMatchesEnv(pilot) with DEMO_MODE=true throws", () => {
    const prev = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "true";
    try {
      expect(() => assertProjectMatchesEnv("pilot")).toThrow();
    } finally {
      if (prev === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = prev;
    }
  });
});

describe("R-12 Task 3.1: --template seed", () => {
  it("DEMO_TEMPLATE_SEED is a valid fictional config with the template ids and the same SOP and staff as the demo", () => {
    expect(SeedConfigSchema.safeParse(DEMO_TEMPLATE_SEED).success).toBe(true);
    expect(DEMO_TEMPLATE_SEED.outlet.outlet_id).toBe("demo-tpl-outlet");
    expect(DEMO_TEMPLATE_SEED.outlet.name).toBe("Demo Bakehouse");
    expect(DEMO_TEMPLATE_SEED.device).toEqual({ device_id: "demo-tpl-phone", label: "Demo shop phone" });
    expect(DEMO_TEMPLATE_SEED.staff).toEqual(DEMO_SEED.staff);
    expect(DEMO_TEMPLATE_SEED.sop_v1).toEqual(DEMO_SEED.sop_v1);
    expect(DEMO_TEMPLATE_SEED.owner.email.endsWith("@example.com")).toBe(true);
    // distinct sign-in emails from demo-outlet so findByEmail never matches two outlets
    expect(DEMO_TEMPLATE_SEED.owner.email).not.toBe(DEMO_SEED.owner.email);
    for (const s of DEMO_TEMPLATE_SEED.supervisors) {
      expect(s.email.endsWith("@example.com")).toBe(true);
      expect(DEMO_SEED.supervisors.map((d) => d.email)).not.toContain(s.email);
    }
  });

  it("selectSeedConfig(demo, template) picks the template config; without the flag the demo one", () => {
    expect(selectSeedConfig("demo", { template: true }).outlet.outlet_id).toBe("demo-tpl-outlet");
    expect(selectSeedConfig("demo", { template: false }).outlet.outlet_id).toBe("demo-outlet");
  });

  it("selectSeedConfig refuses --template on the pilot project", () => {
    expect(() => selectSeedConfig("pilot", { template: true })).toThrow(/template/i);
  });

  it("parseTemplateArg reads the --template flag", () => {
    expect(parseTemplateArg(["--project", "demo", "--template"])).toBe(true);
    expect(parseTemplateArg(["--project", "demo"])).toBe(false);
  });

  it("the template config never touches fs (a literal, like the demo one)", () => {
    vi.mocked(fs.readFileSync).mockClear();
    vi.mocked(fs.existsSync).mockClear();
    selectSeedConfig("demo", { template: true });
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.existsSync).not.toHaveBeenCalled();
  });
});

describe("R-18 2.T3: the pairing code the seed prints is never reserved", () => {
  it("a draw of 0 first (000000) is redrawn: the seed's code is 000042, not the published demo staff code", () => {
    const draws = [0, 42];
    const draw = vi.fn(() => draws.shift() ?? 7);
    expect(seedPairingCode(draw)).toBe("000042");
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("main gets its code only through seedPairingCode (no second, unguarded generator in the seed)", () => {
    const src = fs.readFileSync(new URL("./seed.ts", import.meta.url), "utf8");
    expect(src).toContain("pairingCode: seedPairingCode()");
    expect(src.match(/generatePairingCode\(/g)?.length).toBe(1); // only inside seedPairingCode
  });
});
