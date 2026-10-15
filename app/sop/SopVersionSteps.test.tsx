// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SopChangeView, SopStepView } from "@/lib/sop/contract";
import { axeViolations } from "@/lib/testing/axe";
import { SopVersionSteps } from "@/app/sop/SopVersionSteps";
import type { SopVersionView } from "@/app/sop/versions";

afterEach(() => cleanup());

const step = (id: string, text = `Text ${id}`, role: SopStepView["role"] = "staff"): SopStepView => ({
  step_id: id,
  title: `Title ${id}`,
  text,
  role,
});

function change(overrides: Partial<SopChangeView> = {}): SopChangeView {
  return {
    version: 2,
    previous_version: 1,
    effective_from_date: "2026-10-12",
    approved_date: "2026-10-11",
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

const v2: SopVersionView = {
  version: 2,
  effective_from_date: "2026-10-12",
  steps: [step("open-01"), step("stock-01", "Check the display every 30 minutes."), step("close-01", "Text close-01", "supervisor")],
  change: change(),
};

const seed: SopVersionView = {
  version: 1,
  effective_from_date: null,
  steps: [step("open-01"), step("stock-01", "Check the display every hour.")],
  change: null,
};

describe("SopVersionSteps (R-19 PR-9a §9.1)", () => {
  it("badges only the changed step with IMPROVED · NEW ON dd/mm/yy, the new text and the old wording struck", () => {
    const { container } = render(<SopVersionSteps view={v2} lang="en" />);
    const items = Array.from(container.querySelectorAll("ol > li"));
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).not.toContain("IMPROVED");
    expect(items[2]!.textContent).not.toContain("IMPROVED");

    const changed = items[1]!;
    expect(changed.textContent).toContain("IMPROVED · NEW ON 12/10/26");
    expect(changed.textContent).toContain("Check the display every 30 minutes.");
    const del = changed.querySelector("del");
    expect(del?.textContent).toBe("Check the display every hour.");
    // The visually hidden "Before:" sits right before the struck text, so a screen reader hears what it is.
    const sr = changed.querySelector(".b6-sr-only");
    expect(sr?.textContent).toBe("Before:");
    expect(sr!.compareDocumentPosition(del!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("del")).toHaveLength(1);
    expect(changed.textContent).toContain("Done by: Staff");
  });

  it("links the changed step to why it changed and the result, carrying the SOP version number (not an id)", () => {
    render(<SopVersionSteps view={v2} lang="en" />);
    const link = screen.getByRole("link", { name: "See why it changed and the result" });
    expect(link.getAttribute("href")).toBe("/proposals?v=2");
  });

  it("the why link carries the version of the change that made the shown version", () => {
    const view: SopVersionView = { ...v2, version: 3, change: change({ version: 3, previous_version: 2 }) };
    render(<SopVersionSteps view={view} lang="en" />);
    expect(screen.getByRole("link", { name: "See why it changed and the result" }).getAttribute("href")).toBe("/proposals?v=3");
  });

  it("an add change says NEW ON dd/mm/yy and strikes nothing", () => {
    const view: SopVersionView = {
      ...v2,
      steps: [step("open-01"), step("serve-02")],
      change: change({ kind: "add", before: null, after: step("serve-02") }),
    };
    const { container } = render(<SopVersionSteps view={view} lang="en" />);
    const items = Array.from(container.querySelectorAll("ol > li"));
    expect(items[1]!.textContent).toContain("NEW ON 12/10/26");
    expect(items[1]!.textContent).not.toContain("IMPROVED");
    expect(container.querySelector("del")).toBeNull();
    expect(screen.getByRole("link", { name: "See why it changed and the result" })).not.toBeNull();
  });

  it("the seed version shows no badge, no struck text and no link", () => {
    const { container } = render(<SopVersionSteps view={seed} lang="en" />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.textContent).not.toContain("NEW ON");
    expect(container.querySelector("del")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("Check the display every hour.");
  });

  it("model text renders as literal text, never HTML", () => {
    const view: SopVersionView = {
      ...v2,
      steps: [step("stock-01", "<b>x</b>")],
      change: change({ before: step("stock-01", "<i>old</i>"), after: step("stock-01", "<b>x</b>") }),
    };
    const { container } = render(<SopVersionSteps view={view} lang="en" />);
    expect(screen.getByText("<b>x</b>")).not.toBeNull();
    expect(screen.getByText("<i>old</i>")).not.toBeNull();
    expect(container.querySelector("b, i")).toBeNull();
  });

  it("Bahasa renders the ID strings", () => {
    const { container } = render(<SopVersionSteps view={v2} lang="id" />);
    expect(container.textContent).toContain("DIPERBAIKI · BARU PADA 12/10/26");
    expect(container.querySelector(".b6-sr-only")?.textContent).toBe("Sebelumnya:");
    expect(screen.getByRole("link", { name: "Lihat alasan perubahan dan hasilnya" })).not.toBeNull();
    expect(container.textContent).toContain("Dikerjakan oleh: Staf");
  });

  it("has no axe violations", async () => {
    const { container } = render(<SopVersionSteps view={v2} lang="en" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
