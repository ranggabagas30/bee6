import { describe, expect, it } from "vitest";
import type { SopChangeView, SopOverview, SopStepView } from "@/lib/sop/contract";
import { buildVersions, shortDate, stepOrigins } from "@/app/sop/versions";

/**
 * R-19 PR-9a (§9.1): the SOP book switches versions by date. The wire contract carries only the latest steps and
 * the list of approved changes (one step each), so older versions are rebuilt here, in plain code, by undoing each
 * change from the newest version down to the seed.
 */

const step = (id: string, text = `Text ${id}`): SopStepView => ({ step_id: id, title: `Title ${id}`, text, role: "staff" });

function change(version: number, overrides: Partial<SopChangeView> = {}): SopChangeView {
  return {
    version,
    previous_version: version - 1,
    effective_from_date: `2026-10-${10 + version}`,
    approved_date: `2026-10-${9 + version}`,
    kind: "modify",
    before: step("stock-01", "old text"),
    after: step("stock-01", `new text v${version}`),
    change_title: `Change v${version}`,
    metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 3, baseline_days: 7 },
    failure_condition: "f",
    review_date: `2026-10-${20 + version}`,
    outcome: null,
    ...overrides,
  };
}

function overview(o: Partial<SopOverview> = {}): SopOverview {
  return {
    today: "2026-10-15",
    latest: { version: 1, effective_from_date: null, steps: [step("open-01"), step("stock-01")] },
    in_force_version: 1,
    first_version_date: "2026-10-05",
    changes: [],
    ...o,
  };
}

describe("shortDate", () => {
  it("renders a YYYY-MM-DD business date as dd/mm/yy", () => {
    expect(shortDate("2026-10-05")).toBe("05/10/26");
    expect(shortDate("2026-10-15")).toBe("15/10/26");
    expect(shortDate("2027-01-31")).toBe("31/01/27");
  });
});

describe("buildVersions", () => {
  it("a seed-only SOP is one version dated by the seed's creation date, with no change", () => {
    const versions = buildVersions(overview());
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, effective_from_date: "2026-10-05", change: null });
    expect(versions[0]!.steps.map((s) => s.step_id)).toEqual(["open-01", "stock-01"]);
  });

  it("the seed version has no date when the overview carries none", () => {
    const versions = buildVersions(overview({ first_version_date: null }));
    expect(versions[0]).toMatchObject({ version: 1, effective_from_date: null, change: null });
  });

  it("a modify change rebuilds the previous version with the old wording in the same place", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 2, effective_from_date: "2026-10-12", steps: [step("open-01"), step("stock-01", "new text v2")] },
        in_force_version: 2,
        changes: [change(2)],
      }),
    );
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ effective_from_date: "2026-10-12", change: { version: 2 } });
    expect(versions[0]!.steps[1]!.text).toBe("new text v2");
    expect(versions[1]).toMatchObject({ effective_from_date: "2026-10-05", change: null });
    expect(versions[1]!.steps.map((s) => [s.step_id, s.text])).toEqual([
      ["open-01", "Text open-01"],
      ["stock-01", "old text"],
    ]);
  });

  it("an add change rebuilds the previous version without the added step", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 2, effective_from_date: "2026-10-12", steps: [step("open-01"), step("stock-01"), step("serve-02")] },
        in_force_version: 2,
        changes: [change(2, { kind: "add", before: null, after: step("serve-02") })],
      }),
    );
    expect(versions[1]!.steps.map((s) => s.step_id)).toEqual(["open-01", "stock-01"]);
  });

  it("two changes rebuild two older versions, newest first, each carrying its own change", () => {
    const versions = buildVersions(
      overview({
        latest: {
          version: 3,
          effective_from_date: "2026-10-13",
          steps: [step("open-01", "open v3"), step("stock-01", "new text v2")],
        },
        in_force_version: 3,
        changes: [change(3, { before: step("open-01"), after: step("open-01", "open v3") }), change(2)],
      }),
    );
    expect(versions.map((v) => [v.version, v.effective_from_date, v.change?.version ?? null])).toEqual([
      [3, "2026-10-13", 3],
      [2, "2026-10-12", 2],
      [1, "2026-10-05", null],
    ]);
    expect(versions[1]!.steps.map((s) => s.text)).toEqual(["Text open-01", "new text v2"]);
    expect(versions[2]!.steps.map((s) => s.text)).toEqual(["Text open-01", "old text"]);
  });

  it("stops at the oldest version it can rebuild when a change is missing (truncated list)", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 3, effective_from_date: "2026-10-13", steps: [step("open-01", "open v3")] },
        in_force_version: 3,
        changes: [change(3, { before: step("open-01"), after: step("open-01", "open v3") })],
      }),
    );
    // Version 2's change is not in the list: version 2 has no date to show, so neither it nor version 1 is listed.
    expect(versions.map((v) => v.version)).toEqual([3]);
  });

  it("shows only versions it can date: a gap in the middle of the chain ends the walk", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 4, effective_from_date: "2026-10-14", steps: [step("open-01", "open v4")] },
        in_force_version: 4,
        changes: [
          change(4, { before: step("open-01", "open v3"), after: step("open-01", "open v4") }),
          change(3, { before: step("open-01"), after: step("open-01", "open v3") }),
        ],
      }),
    );
    expect(versions.map((v) => [v.version, v.effective_from_date])).toEqual([
      [4, "2026-10-14"],
      [3, "2026-10-13"],
    ]);
  });

  it("no SOP yields no versions", () => {
    expect(buildVersions(overview({ latest: null, in_force_version: null }))).toEqual([]);
  });
});

describe("stepOrigins (R-19 PR-9b §9.1)", () => {
  const three = () =>
    buildVersions(
      overview({
        latest: {
          version: 3,
          effective_from_date: "2026-10-13",
          steps: [step("open-01", "open v3"), step("stock-01", "new text v2"), step("serve-02")],
        },
        in_force_version: 3,
        changes: [
          change(3, { before: step("open-01"), after: step("open-01", "open v3") }),
          change(2, { kind: "add", before: null, after: step("serve-02") }),
        ],
      }),
    );

  it("maps each changed step to the latest change at or before the shown version", () => {
    const versions = three();
    const atV3 = stepOrigins(versions, 3);
    expect([...atV3.entries()]).toEqual([
      ["open-01", { version: 3, effective_from_date: "2026-10-13", approved_date: "2026-10-12" }],
      ["serve-02", { version: 2, effective_from_date: "2026-10-12", approved_date: "2026-10-11" }],
    ]);
    const atV2 = stepOrigins(versions, 2);
    expect([...atV2.keys()]).toEqual(["serve-02"]);
    expect(stepOrigins(versions, 1).size).toBe(0);
  });

  it("keeps only the newest change per step when the same step changed twice", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 3, effective_from_date: "2026-10-13", steps: [step("stock-01", "v3")] },
        in_force_version: 3,
        changes: [change(3, { before: step("stock-01", "v2"), after: step("stock-01", "v3") }), change(2, { after: step("stock-01", "v2") })],
      }),
    );
    expect(stepOrigins(versions, 3).get("stock-01")?.version).toBe(3);
    expect(stepOrigins(versions, 2).get("stock-01")?.version).toBe(2);
  });
});
