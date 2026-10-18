import { describe, expect, it } from "vitest";
import { getSopOverview, type SopStore } from "@/lib/sop/service";
import { planShip } from "@/lib/sop/ship";
import { outcomeFor, proposalV1, seedV1 } from "@/lib/sop/testing/fixtures";
import { ForbiddenError, NotFoundError } from "@/lib/http/errors";
import type { Outcome, Outlet, SopVersion } from "@/lib/firestore/schema";
import type { CustomClaims } from "@/lib/auth/roles";

const TZ = "Asia/Jakarta";
const outlet: Outlet = {
  outlet_id: "o1",
  name: "Test",
  project_kind: "demo",
  timezone: TZ,
  opening_time: "07:00",
  closing_time: "21:45",
  retention_days: 14,
  created_at: "2026-01-01T00:00:00.000Z",
};
const APPROVE_V2 = Date.parse("2026-10-15T16:30:00Z"); // 23:30 WIB 15 Oct -> eff 2026-10-16
const APPROVE_V3 = Date.parse("2026-10-17T01:00:00Z"); // 08:00 WIB 17 Oct -> eff 2026-10-18

function shipOn(current: SopVersion, nowMs: number, content: Record<string, unknown> = {}, pid?: string): SopVersion {
  const proposal = proposalV1(
    { proposal_id: pid ?? "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f", generator: { ...proposalV1().generator, sop_version_id: current.sop_version_id } },
    content,
  );
  const plan = planShip({ current, drafted: seedV1(), proposal, now_ms: nowMs, tz: TZ });
  if (plan.kind !== "ship") throw new Error("fixture: expected ship");
  return plan.sop_version;
}
const v1 = seedV1();
const v2 = shipOn(v1, APPROVE_V2);
const v3 = shipOn(v2, APPROVE_V3, { target_step_id: null }, "7a1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f");

function store(versions: SopVersion[], o: Outlet | null = outlet, outcomes: Outcome[] = []): SopStore {
  return { getOutlet: async () => o, listVersions: async () => [...versions], listOutcomes: async () => [...outcomes] };
}
const claims = (role: string, outlet_id = "o1"): CustomClaims => ({ outlet_id, role }) as CustomClaims;
const at = (iso: string) => Date.parse(iso);

describe("getSopOverview", () => {
  it("4.T1 seed v1 only: latest 1, no effective date, in force 1, no changes", async () => {
    const r = await getSopOverview(store([v1]), { claims: claims("owner"), now_ms: at("2026-10-15T01:00:00Z") });
    expect(r.latest).toMatchObject({ version: 1, effective_from_date: null });
    expect(r.latest!.steps).toHaveLength(5);
    expect(r.in_force_version).toBe(1);
    expect(r.changes).toEqual([]);
    expect(r.today).toBe("2026-10-15");
  });

  it("4.T2 v2 is latest at once but in force only from its effective date", async () => {
    const before = await getSopOverview(store([v1, v2]), { claims: claims("owner"), now_ms: at("2026-10-15T13:00:00Z") }); // 20:00 WIB 15 Oct
    expect(before.latest!.version).toBe(2);
    expect(before.latest!.effective_from_date).toBe("2026-10-16");
    expect(before.in_force_version).toBe(1);
    const after = await getSopOverview(store([v1, v2]), { claims: claims("owner"), now_ms: at("2026-10-16T01:00:00Z") }); // 08:00 WIB 16 Oct
    expect(after.in_force_version).toBe(2);
  });

  it("4.T3 changes are newest first with previous_version, a null before for an add, and the local approved date", async () => {
    const r = await getSopOverview(store([v2, v1, v3]), { claims: claims("owner"), now_ms: at("2026-10-20T01:00:00Z") });
    expect(r.changes.map((c) => [c.version, c.previous_version])).toEqual([[3, 2], [2, 1]]);
    expect(r.changes[0]!.kind).toBe("add");
    expect(r.changes[0]!.before).toBeNull();
    expect(r.changes[1]!.before).toMatchObject({ step_id: "stock-01" });
    expect(r.changes[1]!.approved_date).toBe("2026-10-15"); // 23:30 WIB, not the UTC date of any other zone shift
    expect(r.changes[0]!.approved_date).toBe("2026-10-17");
    expect(r.changes[1]!.review_date).toBe("2026-10-23");
    expect(r.changes[1]!.effective_from_date).toBe("2026-10-16");
  });

  it("4.T3 caps the change list at 50, newest first", async () => {
    // 60 synthetic versions: shape-only copies of v2 renumbered (the overview does not re-parse stored docs).
    const many: SopVersion[] = [v1];
    for (let n = 2; n <= 60; n++) {
      many.push({ ...v2, version: n, sop_version_id: `o1:v${n}`, previous_version_id: `o1:v${n - 1}` });
    }
    const r = await getSopOverview(store(many), { claims: claims("owner"), now_ms: at("2026-12-01T00:00:00Z") });
    expect(r.changes).toHaveLength(50);
    expect(r.changes[0]!.version).toBe(60);
  });

  it("4.T4 no versions at all is an empty 200-state, not an error", async () => {
    const r = await getSopOverview(store([]), { claims: claims("owner"), now_ms: at("2026-10-15T01:00:00Z") });
    expect(r).toEqual({ today: "2026-10-15", latest: null, in_force_version: null, first_version_date: null, changes: [] });
  });

  describe("first_version_date (R-19 PR-9a: the seed's date on the version switch)", () => {
    // seedV1 is created at 1_700_000_000_000 = 2023-11-14 22:13:20 UTC, which is already 15 Nov in Asia/Jakarta.
    it("is the outlet-local date of the version-1 seed's created_at_ms", async () => {
      const r = await getSopOverview(store([v2, v1]), { claims: claims("owner"), now_ms: at("2026-10-20T01:00:00Z") });
      expect(r.first_version_date).toBe("2023-11-15");
    });

    it("follows the outlet timezone, not UTC", async () => {
      const utcOutlet: Outlet = { ...outlet, timezone: "UTC" };
      const r = await getSopOverview(store([v1], utcOutlet), { claims: claims("owner"), now_ms: at("2026-10-20T01:00:00Z") });
      expect(r.first_version_date).toBe("2023-11-14");
    });

    it("is null when the version-1 seed doc is not in the read set", async () => {
      const r = await getSopOverview(store([v2, v3]), { claims: claims("owner"), now_ms: at("2026-10-20T01:00:00Z") });
      expect(r.latest!.version).toBe(3);
      expect(r.first_version_date).toBeNull();
    });

    it("carries a date only, never the seed's id", async () => {
      const r = await getSopOverview(store([v1]), { claims: claims("owner"), now_ms: at("2026-10-20T01:00:00Z") });
      expect(JSON.stringify(r)).not.toContain("o1:v1");
    });
  });

  it("4.T5 owner and supervisor get identical payloads; staff and device are 403", async () => {
    const now_ms = at("2026-10-16T01:00:00Z");
    const o = await getSopOverview(store([v1, v2]), { claims: claims("owner"), now_ms });
    const s = await getSopOverview(store([v1, v2]), { claims: claims("supervisor"), now_ms });
    expect(s).toEqual(o);
    await expect(getSopOverview(store([v1]), { claims: claims("staff"), now_ms })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSopOverview(store([v1]), { claims: claims("device"), now_ms })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("4.T6 wrong outlet is 403, a missing outlet is 404", async () => {
    const now_ms = at("2026-10-16T01:00:00Z");
    await expect(getSopOverview(store([v1]), { claims: claims("owner", "other"), now_ms })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getSopOverview(store([v1], null), { claims: claims("owner"), now_ms })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("4.T7 the payload leaks no ids", async () => {
    const r = await getSopOverview(store([v1, v2, v3]), { claims: claims("owner"), now_ms: at("2026-10-20T01:00:00Z") });
    const json = JSON.stringify(r);
    expect(json).not.toContain("source_proposal_id");
    expect(json).not.toContain("6f1c2d3e");
    expect(json).not.toContain("o1:v");
    expect(json).not.toContain("outlet_id");
    expect(json).not.toContain("intervention_id");
  });

  it("converts an internal schema violation into a generic error", async () => {
    const broken: SopVersion = { ...v1, steps: [{ ...v1.steps[0]!, role: "janitor" as never }] };
    await expect(getSopOverview(store([broken]), { claims: claims("owner"), now_ms: 0 })).rejects.toThrow(
      "getSopOverview: internal schema violation",
    );
  });
});

describe("getSopOverview: outcomes (R-11 Task 7)", () => {
  const now = at("2026-10-30T01:00:00Z");

  it("7.T1 a change without an outcome has outcome null", async () => {
    const r = await getSopOverview(store([v1, v2]), { claims: claims("owner"), now_ms: now });
    expect(r.changes[0]!.outcome).toBeNull();
  });

  it("7.T2 maps a remembered outcome onto its change, with only verdict and simulated", async () => {
    const r = await getSopOverview(store([v1, v2, v3], outlet, [outcomeFor(2, { simulated: true })]), {
      claims: claims("supervisor"),
      now_ms: now,
    });
    const byVersion = new Map(r.changes.map((c) => [c.version, c]));
    expect(byVersion.get(2)!.outcome).toEqual({ verdict: "worked", simulated: true });
    expect(byVersion.get(3)!.outcome).toBeNull();
    expect(JSON.stringify(r)).not.toContain("o1:v2");
  });

  it("7.T3 an unknown outcome is passed through as unknown", async () => {
    const unknown = outcomeFor(2, { verdict: "unknown", in_memory: false, supervisor_verdict: null });
    const r = await getSopOverview(store([v1, v2], outlet, [unknown]), { claims: claims("owner"), now_ms: now });
    expect(r.changes[0]!.outcome).toEqual({ verdict: "unknown", simulated: false });
  });

  it("7.T4 an outcome whose version has no change is ignored", async () => {
    const r = await getSopOverview(store([v1, v2], outlet, [outcomeFor(9)]), { claims: claims("owner"), now_ms: now });
    expect(r.changes.map((c) => c.outcome)).toEqual([null]);
  });
});
