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
  type SopVersion,
} from "@/lib/firestore/schema";
import { addDays, businessDateOf, localDateOf, localHmOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { cloneTemplate, shiftDeep, type TemplateSet } from "@/lib/demo/clone";
import { TEMPLATE_OUTLET_ID } from "@/lib/demo/constants";
import { DAYS, templateSet } from "@/lib/demo/testing/fixtures";
import { shortDate } from "@/app/sop/versions";

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
    const sopVersion = buildSopVersionDoc("demo-outlet", DEMO_SEED.sop_v1!, NOW.getTime(), "Asia/Jakarta");
    const { db, written } = fakeDb(new Set(["demo-outlet:v1"]));
    const wroteIt = await writeSopVersionIfAbsent(db as never, sopVersion);
    expect(wroteIt).toBe(false);
    expect(written).toHaveLength(0);
  });

  it("writes the doc when absent", async () => {
    const sopVersion = buildSopVersionDoc("demo-outlet", DEMO_SEED.sop_v1!, NOW.getTime(), "Asia/Jakarta");
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
    expect(DEMO_TEMPLATE_SEED.sop_v1?.steps).toEqual(DEMO_SEED.sop_v1?.steps);
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

describe("R-19: SOP v1 creation date (sop_v1.created_days_before_last_day / created_date)", () => {
  const TZ = "Asia/Jakarta";
  const STEPS = DEMO_SEED.sop_v1!.steps;
  /** 09:00 WIB of a "YYYY-MM-DD" date. */
  const nineAm = (date: string) => zonedTimeToEpochMs(date, "09:00", TZ);

  it("absent: created_at_ms is the seed time (pilot / plain demo behaviour unchanged)", () => {
    const doc = buildSopVersionDoc("demo-outlet", { steps: STEPS }, NOW.getTime(), TZ);
    expect(doc.created_at_ms).toBe(NOW.getTime());
  });

  it("created_days_before_last_day: 6 on a 10 Oct seed (08:00 WIB) stamps 09:00 WIB on 3 Oct (10 - 1 - 6)", () => {
    const seedAt = Date.parse("2026-10-10T01:00:00.000Z"); // 08:00 WIB on 10 Oct
    const doc = buildSopVersionDoc("demo-tpl-outlet", { steps: STEPS, created_days_before_last_day: 6 }, seedAt, TZ);
    expect(doc.created_at_ms).toBe(nineAm("2026-10-03"));
    expect(localDateOf(doc.created_at_ms, TZ)).toBe("2026-10-03");
    expect(localHmOf(doc.created_at_ms, TZ)).toBe("09:00");
  });

  it("the relative date counts outlet-local days, not UTC days", () => {
    // 00:30 WIB on 10 Oct is still 9 Oct in UTC: the seed day is 10 Oct (local), so the SOP date is 3 Oct.
    const justAfterMidnight = Date.parse("2026-10-09T17:30:00.000Z");
    const doc = buildSopVersionDoc("demo-tpl-outlet", { steps: STEPS, created_days_before_last_day: 6 }, justAfterMidnight, TZ);
    expect(localDateOf(doc.created_at_ms, TZ)).toBe("2026-10-03");
    // 23:30 WIB on 10 Oct (16:30 UTC) is still the same seed day.
    const lateEvening = Date.parse("2026-10-10T16:30:00.000Z");
    const doc2 = buildSopVersionDoc("demo-tpl-outlet", { steps: STEPS, created_days_before_last_day: 6 }, lateEvening, TZ);
    expect(localDateOf(doc2.created_at_ms, TZ)).toBe("2026-10-03");
  });

  it("created_date (absolute) stamps 09:00 WIB on that date, whatever the seed time", () => {
    const doc = buildSopVersionDoc("demo-tpl-outlet", { steps: STEPS, created_date: "2026-10-05" }, NOW.getTime(), TZ);
    expect(doc.created_at_ms).toBe(nineAm("2026-10-05"));
  });

  it("the schema refuses both options at once, a negative or fractional day count, and a malformed date", () => {
    const base = { ...DEMO_TEMPLATE_SEED };
    const withSop = (sop_v1: unknown) => SeedConfigSchema.safeParse({ ...base, sop_v1 }).success;
    expect(withSop({ steps: STEPS, created_days_before_last_day: 6 })).toBe(true);
    expect(withSop({ steps: STEPS, created_date: "2026-10-05" })).toBe(true);
    expect(withSop({ steps: STEPS, created_days_before_last_day: 6, created_date: "2026-10-05" })).toBe(false);
    expect(withSop({ steps: STEPS, created_days_before_last_day: -1 })).toBe(false);
    expect(withSop({ steps: STEPS, created_days_before_last_day: 1.5 })).toBe(false);
    expect(withSop({ steps: STEPS, created_date: "05/10/2026" })).toBe(false);
  });

  it("created_date must be a real calendar date, not an impossible one like 2026-02-30", () => {
    const base = { ...DEMO_TEMPLATE_SEED };
    const withSop = (sop_v1: unknown) => SeedConfigSchema.safeParse({ ...base, sop_v1 }).success;
    // Valid dates
    expect(withSop({ steps: STEPS, created_date: "2026-02-28" })).toBe(true);
    expect(withSop({ steps: STEPS, created_date: "2028-02-29" })).toBe(true); // leap year
    expect(withSop({ steps: STEPS, created_date: "2026-10-05" })).toBe(true);
    // Invalid dates that pass regex but are impossible
    expect(withSop({ steps: STEPS, created_date: "2026-02-30" })).toBe(false);
    expect(withSop({ steps: STEPS, created_date: "2026-13-45" })).toBe(false);
    expect(withSop({ steps: STEPS, created_date: "2026-00-10" })).toBe(false);
    expect(withSop({ steps: STEPS, created_date: "2027-02-29" })).toBe(false); // not a leap year
  });

  it("the demo template sets created_days_before_last_day: 6; the plain demo and (by shape) the pilot do not", () => {
    expect(DEMO_TEMPLATE_SEED.sop_v1?.created_days_before_last_day).toBe(6);
    expect(DEMO_TEMPLATE_SEED.sop_v1?.created_date).toBeUndefined();
    expect(DEMO_SEED.sop_v1?.created_days_before_last_day).toBeUndefined();
    expect(DEMO_SEED.sop_v1?.created_date).toBeUndefined();
  });

  it("buildSeedDocuments passes the outlet timezone through (template config -> dated SOP doc)", async () => {
    const seedAt = new Date("2026-10-10T01:00:00.000Z"); // 08:00 WIB on 10 Oct
    const docs = await buildSeedDocuments(DEMO_TEMPLATE_SEED, "demo", { pairingCode: "123456", now: seedAt, hash: fakeHash });
    expect(docs.sopVersion?.created_at_ms).toBe(nineAm("2026-10-03"));
  });

  /**
   * End to end with fixed clocks: seed on day S, upload the template days so its last day is D = S - 1
   * (plan.json offset -1), then clone for a judge whose today is T. The clone moves the template by
   * k = (T - 1) - D whole days, so the SOP lands on (D - 6) + k = T - 7, whatever S was.
   */
  describe("re-seeding on any day: the sandbox's first SOP version reads as judge-day-1 minus 7", () => {
    const DAY_MS = 86_400_000;
    const TEMPLATE_LAST_DAY = DAYS[2]; // the fixture's last day (19 Oct)
    const daysBetween = (from: string, to: string) =>
      Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);

    /** The template as the seed + demo-seed-template leave it when both ran on seed day S (08:00 WIB). */
    function templateSeededOn(seedDay: string): TemplateSet {
      const lastDay = addDays(seedDay, -1);
      const move = daysBetween(TEMPLATE_LAST_DAY, lastDay);
      const tpl = shiftDeep(templateSet(), move * DAY_MS, move);
      const seedAt = zonedTimeToEpochMs(seedDay, "08:00", TZ);
      const sop_v1 = buildSopVersionDoc(TEMPLATE_OUTLET_ID, DEMO_TEMPLATE_SEED.sop_v1!, seedAt, TZ);
      expect(tpl.device.last_ended?.business_date).toBe(lastDay);
      return { ...tpl, sop_v1 };
    }

    function sandboxSopDate(tpl: TemplateSet, judgeDay: string): string {
      const now_ms = zonedTimeToEpochMs(judgeDay, "09:00", TZ);
      const docs = cloneTemplate({
        tpl,
        ids: { outlet_id: "sbx-aaaaaaaaaaaa", device_id: "jdg-bbbbbbbbbbbb" },
        now_ms,
        key_sha256: "a".repeat(64),
        device_token_hash: "$2a$10$judgehashjudgehashjudge",
        anchor_business_date: businessDateOf(now_ms, TZ),
      });
      const sop = docs.find((d) => d.collection === COLLECTIONS.sopVersions)!.data as SopVersion;
      expect(sop.created_at_ms).toBeLessThan(now_ms); // the clone's cap-at-now never touches it
      return localDateOf(sop.created_at_ms, TZ);
    }

    it.each([
      ["2026-10-05", "2026-10-12", "2026-10-05", "05/10/26"], // seeded a week before judge day 1
      ["2026-10-10", "2026-10-12", "2026-10-05", "05/10/26"], // the Saturday before
      ["2026-10-11", "2026-10-12", "2026-10-05", "05/10/26"], // the day before (k = 0)
      ["2026-10-12", "2026-10-12", "2026-10-05", "05/10/26"], // judge day itself, before the judge signs in
      ["2026-10-10", "2026-10-13", "2026-10-06", "06/10/26"], // judge day 2 opens its own sandbox: still today - 7
      ["2026-10-29", "2026-11-02", "2026-10-26", "26/10/26"], // across a month boundary
      ["2026-12-31", "2027-01-04", "2026-12-28", "28/12/26"], // across a year boundary
    ])("seeded %s, judge today %s -> SOP v1 dated %s (%s)", (seedDay, judgeDay, expectedDate, expectedLabel) => {
      const got = sandboxSopDate(templateSeededOn(seedDay), judgeDay);
      expect(got).toBe(expectedDate);
      expect(got).toBe(addDays(judgeDay, -7));
      expect(shortDate(got)).toBe(expectedLabel);
    });
  });
});
