// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SopChangeView } from "@/lib/sop/contract";
import { t } from "@/lib/i18n/dict";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import { SopChangeCard } from "@/app/sop/SopChangeCard";

afterEach(() => cleanup());

function change(overrides: Partial<SopChangeView> = {}): SopChangeView {
  return {
    version: 2,
    previous_version: 1,
    effective_from_date: "2026-10-16",
    approved_date: "2026-10-15",
    kind: "modify",
    before: { step_id: "stock-01", title: "Display check", text: "Check the display every hour.", role: "staff" },
    after: { step_id: "stock-01", title: "Display check", text: "Check the display every 30 minutes.", role: "staff" },
    change_title: "Check the display more often",
    metric: {
      category: "CUSTOMER_SERVICE",
      direction: "decrease",
      description: "Sold-out requests per day.",
      baseline_count: 4,
      baseline_days: 7,
    },
    failure_condition: "Sold-out requests do not fall.",
    review_date: "2026-10-23",
    outcome: null,
    ...overrides,
  };
}

function textOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("h4, h5, p")).map((n) => n.textContent ?? "");
}

describe("SopChangeCard", () => {
  it("5.T1 a modify change renders head, title, before, after, metric, failure, review and approval in order", () => {
    const { container } = render(<SopChangeCard change={change()} lang="en" />);
    const lines = textOrder(container);
    const expected = [
      "Version 2, from Fri 16 Oct",
      "Check the display more often",
      "Before (version 1)",
      "Display check",
      "Check the display every hour.",
      "After (version 2)",
      "Display check",
      "Check the display every 30 minutes.",
      "Done by: Staff",
      t("en", "C-prop-metric", {
        category: t("en", CATEGORY_KEY.CUSTOMER_SERVICE),
        direction: t("en", "C-prop-dir-decrease"),
        count: 4,
        days: 7,
      }),
      "Sold-out requests per day.",
      "Failure condition: Sold-out requests do not fall.",
      "Review on Fri 23 Oct",
      "Approved on Thu 15 Oct",
    ];
    let at = -1;
    for (const want of expected) {
      const idx = lines.findIndex((l, i) => i > at && l === want);
      expect(idx, `missing or out of order: ${want}`).toBeGreaterThan(at);
      at = idx;
    }
  });

  it("the inline card (opened under an improved step) leaves out the before/after block the step already shows", () => {
    render(<SopChangeCard change={change()} lang="en" inline />);
    expect(screen.getByText("Check the display more often")).not.toBeNull();
    expect(screen.getByText("Review on Fri 23 Oct")).not.toBeNull();
    expect(screen.queryByText("Before (version 1)")).toBeNull();
    expect(screen.queryByText("Check the display every hour.")).toBeNull();
  });

  it("5.T2 an add change says it is a new step and shows no before text", () => {
    render(<SopChangeCard change={change({ kind: "add", before: null })} lang="en" />);
    expect(screen.getByText("New step. Not in version 1.")).not.toBeNull();
    expect(screen.queryByText("Check the display every hour.")).toBeNull();
  });

  it("5.T3 model text renders as literal text, never HTML", () => {
    const { container } = render(
      <SopChangeCard
        change={change({ after: { step_id: "stock-01", title: "T", text: "<b>x</b>", role: "staff" } })}
        lang="en"
      />,
    );
    expect(screen.getByText("<b>x</b>")).not.toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("5.T3 Bahasa renders the ID strings", () => {
    render(<SopChangeCard change={change()} lang="id" />);
    expect(screen.getByText("Sebelum (versi 1)")).not.toBeNull();
    expect(screen.getByText("Sesudah (versi 2)")).not.toBeNull();
    expect(screen.getByText("Dikerjakan oleh: Staf")).not.toBeNull();
  });

  it("uses no diff wording or highlight elements (cut #51)", () => {
    const { container } = render(<SopChangeCard change={change()} lang="en" />);
    expect(container.textContent?.toLowerCase()).not.toContain("diff");
    expect(container.querySelector("ins, del, mark")).toBeNull();
  });
});

describe("SopChangeCard outcome line (R-11 Task 7)", () => {
  it("7.T5 shows nothing about an outcome when there is none", () => {
    render(<SopChangeCard change={change()} lang="en" />);
    expect(screen.queryByText(/^Outcome/)).toBeNull();
    expect(screen.queryByText("Simulated time (demo)")).toBeNull();
  });

  it.each([
    ["worked", "Outcome: Worked"],
    ["revise", "Outcome: Revise"],
    ["revert", "Outcome: Revert"],
  ] as const)("7.T6 a %s outcome reads '%s'", (verdict, text) => {
    render(<SopChangeCard change={change({ outcome: { verdict, simulated: false } })} lang="en" />);
    expect(screen.getByText(text)).not.toBeNull();
    expect(screen.queryByText("Simulated time (demo)")).toBeNull();
  });

  it("7.T7 an unknown outcome says it was not confirmed and not remembered", () => {
    render(<SopChangeCard change={change({ outcome: { verdict: "unknown", simulated: false } })} lang="en" />);
    expect(screen.getByText("Outcome: unknown (not confirmed, not remembered)")).not.toBeNull();
  });

  it("7.T8 a simulated outcome carries the simulated-time label", () => {
    render(<SopChangeCard change={change({ outcome: { verdict: "worked", simulated: true } })} lang="en" />);
    expect(screen.getByText("Outcome: Worked")).not.toBeNull();
    expect(screen.getByText("Simulated time (demo)")).not.toBeNull();
  });

  it("7.T9 the outcome line follows the approved-on line, and Bahasa renders", () => {
    const { container } = render(
      <SopChangeCard change={change({ outcome: { verdict: "worked", simulated: false } })} lang="id" />,
    );
    const lines = Array.from(container.querySelectorAll("p")).map((n) => n.textContent);
    const approved = lines.findIndex((l) => l?.startsWith("Disetujui pada"));
    expect(approved).toBeGreaterThan(-1);
    expect(lines[approved + 1]).toBe("Hasil: Berhasil");
  });
});
