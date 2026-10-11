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
    ...overrides,
  };
}

function textOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("h3, h4, p")).map((n) => n.textContent ?? "");
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
