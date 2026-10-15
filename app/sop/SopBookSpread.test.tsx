// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SopChangeView, SopOverview, SopStepView } from "@/lib/sop/contract";
import { axeViolations } from "@/lib/testing/axe";
import { SopBookSpread } from "@/app/sop/SopBookSpread";
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

/** The demo SOP: five steps over four chapters (Opening & closing has two). */
const DEMO_STEPS = [step("open-01"), step("bake-01"), step("stock-01", "Check the display every 30 minutes."), step("serve-01"), step("close-01")];

const overview = (o: Partial<SopOverview> = {}): SopOverview => ({
  today: "2026-10-15",
  latest: { version: 2, effective_from_date: "2026-10-12", steps: DEMO_STEPS },
  in_force_version: 2,
  first_version_date: "2026-10-05",
  changes: [change(2)],
  ...o,
});

const stepIdsShown = () => Array.from(document.querySelectorAll("ol > li")).map((li) => li.querySelector("p")?.textContent);
const contentsButtons = (nav = "Contents") => Array.from(screen.getByRole("navigation", { name: nav }).querySelectorAll("button"));

describe("SopBookSpread (R-19 PR-9b §9.1)", () => {
  it("left page lists the chapters with their step counts and the legend; right page opens on chapter 1", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    expect(contentsButtons().map((b) => b.textContent)).toEqual(["Opening & closing 2 steps", "Production 1 step", "Stock 1 step", "Customer 1 step"]);
    expect(contentsButtons().map((b) => b.getAttribute("aria-label"))).toEqual([null, null, null, null]);
    expect(contentsButtons().map((b) => b.getAttribute("aria-current"))).toEqual(["page", null, null, null]);
    expect(screen.getByText("From your SOP").parentElement!.textContent).toContain("4");
    expect(screen.getByText("Improved with Bee6").parentElement!.textContent).toContain("1");
    expect(screen.getByRole("heading", { level: 3, name: "Opening & closing" })).not.toBeNull();
    expect(screen.getByText("CHAPTER 1 OF 4")).not.toBeNull();
    expect(stepIdsShown()).toEqual(["Title open-01", "Title close-01"]);
    expect(screen.getByText("Page 1 of 4")).not.toBeNull();
  });

  it("the legend counts for the shown version: on the seed nothing is improved yet", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[1]!} versions={versions} lang="en" />);
    expect(screen.getByText("From your SOP").parentElement!.textContent).toContain("5");
    expect(screen.getByText("Improved with Bee6").parentElement!.textContent).toContain("0");
  });

  it("Next and Previous page move through the chapters and are disabled at the ends", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    const prev = () => screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement;
    const next = () => screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement;
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);

    fireEvent.click(next());
    expect(screen.getByRole("heading", { level: 3, name: "Production" })).not.toBeNull();
    expect(stepIdsShown()).toEqual(["Title bake-01"]);
    expect(screen.getByText("Page 2 of 4")).not.toBeNull();
    expect(prev().disabled).toBe(false);

    fireEvent.click(next());
    fireEvent.click(next());
    expect(screen.getByRole("heading", { level: 3, name: "Customer" })).not.toBeNull();
    expect(next().disabled).toBe(true);

    fireEvent.click(prev());
    expect(screen.getByRole("heading", { level: 3, name: "Stock" })).not.toBeNull();
    expect(screen.getByText("IMPROVED · NEW ON 12/10/26")).not.toBeNull();
    expect(document.querySelector("del")?.textContent).toBe("Check the display every hour.");
  });

  it("a contents entry opens its chapter, marks itself current and moves focus to the chapter heading", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Stock 1 step" }));
    const heading = screen.getByRole("heading", { level: 3, name: "Stock" });
    expect(contentsButtons().map((b) => b.getAttribute("aria-current"))).toEqual([null, null, "page", null]);
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText("Page 3 of 4")).not.toBeNull();
  });

  it("a contents entry's accessible name is its visible text, chapter then count, with a space between (WCAG 2.5.3)", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    expect(screen.getByRole("button", { name: "Stock 1 step" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Opening & closing 2 steps" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Stock1 step" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stock, 1 step" })).toBeNull();
    // Label in Name: for every entry the computed name equals the visible text (whitespace collapsed), so the
    // repo's own axe version (where label-content-name-mismatch is experimental) cannot hide a drift.
    for (const button of contentsButtons()) {
      const visible = button.textContent!.replace(/\s+/g, " ").trim();
      expect(visible).toMatch(/^\S.* \d+ (steps?|langkah)$/);
      expect(screen.getByRole("button", { name: visible, exact: true })).toBe(button);
      expect(button.getAttribute("aria-label")).toBeNull();
    }
  });

  it("Bahasa names the entries the same way", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="id" />);
    expect(screen.getByRole("button", { name: "Buka & tutup 2 langkah" })).not.toBeNull();
    for (const button of contentsButtons("Daftar isi")) {
      const visible = button.textContent!.replace(/\s+/g, " ").trim();
      expect(screen.getByRole("button", { name: visible, exact: true })).toBe(button);
    }
  });

  it("re-clicking the open chapter's contents entry lands on the chapter heading", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    const entry = screen.getByRole("button", { name: "Opening & closing 2 steps" });
    entry.focus();
    fireEvent.click(entry);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: "Opening & closing" }));
    expect(screen.getByText("Page 1 of 4")).not.toBeNull();
  });

  it("re-clicking the open chapter does not steal focus on a later version switch that clamps the page", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 2, effective_from_date: "2026-10-12", steps: [step("open-01"), step("stock-01"), step("serve-02")] },
        changes: [change(2, { kind: "add", before: null, after: step("serve-02") })],
      }),
    );
    const { rerender } = render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("heading", { level: 3, name: "Customer" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Customer 1 step" }));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    rerender(<SopBookSpread view={versions[1]!} versions={versions} lang="en" />);
    expect(screen.getByRole("heading", { level: 3, name: "Stock" })).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("the open chapter can be controlled by the parent so it outlives a remount", () => {
    const versions = buildVersions(overview());
    const onChapterChange = vi.fn();
    const { rerender } = render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" chapter={2} onChapterChange={onChapterChange} />);
    expect(screen.getByRole("heading", { level: 3, name: "Stock" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onChapterChange).toHaveBeenCalledWith(3);
    // Controlled: the page does not move until the parent passes the new index.
    expect(screen.getByRole("heading", { level: 3, name: "Stock" })).not.toBeNull();
    rerender(<SopBookSpread view={versions[0]!} versions={versions} lang="en" chapter={3} onChapterChange={onChapterChange} />);
    expect(screen.getByRole("heading", { level: 3, name: "Customer" })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: "Customer" }));
  });

  it("the page clamps when a version with fewer chapters is shown", () => {
    const versions = buildVersions(
      overview({
        latest: { version: 2, effective_from_date: "2026-10-12", steps: [step("open-01"), step("stock-01"), step("serve-02")] },
        changes: [change(2, { kind: "add", before: null, after: step("serve-02") })],
      }),
    );
    const { rerender } = render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("heading", { level: 3, name: "Customer" })).not.toBeNull();
    rerender(<SopBookSpread view={versions[1]!} versions={versions} lang="en" />);
    expect(screen.getByRole("heading", { level: 3, name: "Stock" })).not.toBeNull();
    expect(screen.getByText("Page 2 of 2")).not.toBeNull();
  });

  it("a single-chapter SOP (the pilot: every step is 'Other steps') shows no page navigation", () => {
    const versions = buildVersions(
      overview({ latest: { version: 1, effective_from_date: null, steps: [step("p-01"), step("p-02")] }, in_force_version: 1, changes: [] }),
    );
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    expect(contentsButtons().map((b) => b.textContent)).toEqual(["Other steps 2 steps"]);
    expect(screen.getByRole("button", { name: "Other steps 2 steps" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
    expect(stepIdsShown()).toEqual(["Title p-01", "Title p-02"]);
  });

  it("renders both pages inside one spread so the phone layout can stack them", () => {
    const versions = buildVersions(overview());
    const { container } = render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    const pages = container.querySelectorAll("[data-page]");
    expect(Array.from(pages).map((p) => p.getAttribute("data-page"))).toEqual(["contents", "chapter"]);
    expect(pages[0]!.parentElement).toBe(pages[1]!.parentElement);
  });

  it("Bahasa renders the ID strings", () => {
    const versions = buildVersions(overview());
    render(<SopBookSpread view={versions[0]!} versions={versions} lang="id" />);
    expect(screen.getByRole("navigation", { name: "Daftar isi" })).not.toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Buka & tutup" })).not.toBeNull();
    expect(screen.getByText("Halaman 1 dari 4")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Halaman berikutnya" })).not.toBeNull();
  });

  it("has no axe violations", async () => {
    const versions = buildVersions(overview());
    const { container } = render(<SopBookSpread view={versions[0]!} versions={versions} lang="en" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
