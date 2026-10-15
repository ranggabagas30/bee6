// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SopChangeView, SopOverview, SopStepView } from "@/lib/sop/contract";
import { axeViolations } from "@/lib/testing/axe";
import { SopTable } from "@/app/sop/SopTable";
import { buildVersions } from "@/app/sop/versions";

afterEach(() => cleanup());

const step = (id: string, text = `Text ${id}`, role: SopStepView["role"] = "staff"): SopStepView => ({
  step_id: id,
  title: `Title ${id}`,
  text,
  role,
});

function change(version: number, overrides: Partial<SopChangeView> = {}): SopChangeView {
  return {
    version,
    previous_version: version - 1,
    effective_from_date: `2026-10-${10 + version}`,
    approved_date: `2026-10-${9 + version}`,
    kind: "modify",
    before: step("stock-01", "Check the display every hour."),
    after: step("stock-01", "Check the display every 30 minutes."),
    change_title: "Check the display more often",
    metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 3, baseline_days: 7 },
    failure_condition: "f",
    review_date: "2026-10-26",
    outcome: null,
    ...overrides,
  };
}

const overview = (o: Partial<SopOverview> = {}): SopOverview => ({
  today: "2026-10-15",
  latest: {
    version: 2,
    effective_from_date: "2026-10-12",
    steps: [step("open-01"), step("stock-01", "Check the display every 30 minutes."), step("serve-01", "Text serve-01", "supervisor"), step("misc-09")],
  },
  in_force_version: 2,
  first_version_date: "2026-10-05",
  changes: [change(2)],
  ...o,
});

const rowsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent));

describe("SopTable (R-19 PR-9b §9.1)", () => {
  it("has the six columns CODE / STEP / CHAPTER / WHO / WHEN / WHERE IT CAME FROM, in that order", () => {
    const versions = buildVersions(overview());
    render(<SopTable view={versions[0]!} versions={versions} lang="en" />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["CODE", "STEP", "CHAPTER", "WHO", "WHEN", "WHERE IT CAME FROM"]);
    expect(screen.getByRole("table", { name: "Steps in version 2 as a table" })).not.toBeNull();
  });

  it("one row per step in SOP order: code, title and text, chapter, role, the version date and where it came from", () => {
    const versions = buildVersions(overview());
    const { container } = render(<SopTable view={versions[0]!} versions={versions} lang="en" />);
    expect(rowsOf(container)).toEqual([
      ["open-01", "Title open-01Text open-01", "Opening & closing", "Staff", "05/10/26", "Your SOP"],
      ["stock-01", "Title stock-01Check the display every 30 minutes.", "Stock", "Staff", "12/10/26", "Bee6 proposal, approved 11/10/26"],
      ["serve-01", "Title serve-01Text serve-01", "Customer", "Supervisor", "05/10/26", "Your SOP"],
      ["misc-09", "Title misc-09Text misc-09", "Other steps", "Staff", "05/10/26", "Your SOP"],
    ]);
  });

  it("an older version ignores later changes: on the seed every step is from your SOP", () => {
    const versions = buildVersions(overview());
    const { container } = render(<SopTable view={versions[1]!} versions={versions} lang="en" />);
    const rows = rowsOf(container);
    expect(rows[1]).toEqual(["stock-01", "Title stock-01Check the display every hour.", "Stock", "Staff", "05/10/26", "Your SOP"]);
    expect(rows.every((r) => r[5] === "Your SOP")).toBe(true);
  });

  it("says 'Not dated' when the seed's date is not known", () => {
    const versions = buildVersions(overview({ first_version_date: null }));
    const { container } = render(<SopTable view={versions[0]!} versions={versions} lang="en" />);
    expect(rowsOf(container)[0]![4]).toBe("Not dated");
    expect(rowsOf(container)[1]![4]).toBe("12/10/26");
  });

  it("each cell carries its column header for the stacked phone layout", () => {
    const versions = buildVersions(overview());
    const { container } = render(<SopTable view={versions[0]!} versions={versions} lang="en" />);
    const first = Array.from(container.querySelectorAll("tbody tr")[0]!.querySelectorAll("td"));
    expect(first.map((td) => td.getAttribute("data-label"))).toEqual(["CODE", "STEP", "CHAPTER", "WHO", "WHEN", "WHERE IT CAME FROM"]);
  });

  it("model text renders as literal text, never HTML", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 1, effective_from_date: null, steps: [{ ...step("x-01", "<b>bold</b>"), title: "<i>t</i>" }] },
        in_force_version: 1,
        changes: [],
      }),
    );
    const { container } = render(<SopTable view={versions[0]!} versions={versions} lang="en" />);
    expect(screen.getByText("<b>bold</b>")).not.toBeNull();
    expect(screen.getByText("<i>t</i>")).not.toBeNull();
    expect(container.querySelector("b, i")).toBeNull();
  });

  it("Bahasa renders the ID strings", () => {
    const versions = buildVersions(overview());
    const { container } = render(<SopTable view={versions[0]!} versions={versions} lang="id" />);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["KODE", "LANGKAH", "BAB", "SIAPA", "KAPAN", "ASALNYA"]);
    expect(rowsOf(container)[1]!.slice(2)).toEqual(["Stok", "Staf", "12/10/26", "Usulan Bee6, disetujui 11/10/26"]);
  });

  it("has no axe violations", async () => {
    const versions = buildVersions(overview());
    const { container } = render(<SopTable view={versions[0]!} versions={versions} lang="en" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
