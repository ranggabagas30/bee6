// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { t } from "@/lib/i18n/dict";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import { ReviewCard, VERDICT_KEY, suggestionDomId } from "@/app/reviews/ReviewCard";
import { reviewView } from "@/app/reviews/review-fixtures";

afterEach(() => cleanup());

function texts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("h3, p")).map((n) => n.textContent ?? "");
}

describe("ReviewCard", () => {
  it("shows the kicker with version and the written-out review date, and the change title as the card heading", () => {
    render(<ReviewCard review={reviewView()} lang="en" />);
    const kick = screen.getByText("SOP version 2 · review on Fri 23 Oct");
    expect(kick.className).toContain("b6-kick");
    const heading = screen.getByRole("heading", { level: 3, name: "Check the display more often" });
    expect(heading.className).toContain("b6-h2-card");
  });

  it("is a page-2 card: white card surface, two glass tiles BEFORE and AFTER with the rate as the value", () => {
    const { container } = render(<ReviewCard review={reviewView()} lang="en" />);
    expect(container.querySelector("article")!.className).toContain("b6-card");
    const group = screen.getByRole("group", { name: "Before and after the change" });
    const tiles = group.querySelectorAll(".b6-tile.b6-glass");
    expect(tiles).toHaveLength(2);
    expect(tiles[0]!.textContent).toContain("BEFORE");
    expect(tiles[0]!.textContent).toContain("2.0 per day");
    expect(tiles[1]!.textContent).toContain("AFTER");
    expect(tiles[1]!.textContent).toContain("1.0 per day");
    expect(screen.getByText("This is a short window, so read the numbers with care.").className).toContain("b6-note");
  });

  it("puts the suggestion in an amber alert box and the status line in the mono face", () => {
    render(<ReviewCard review={reviewView()} lang="en" />);
    const box = screen.getByText("Bee6 suggests: Worked").parentElement!;
    expect(box.className).toContain("b6-alert--amber");
    expect(screen.getByText("Bee6 suggests: Worked").className).toContain("b6-alert__lead");
    expect(screen.getByText("Waiting for the supervisor's verdict by Fri 30 Oct").className).toContain("b6-mono");
  });

  it("shows the no-rate value, not '0.0 per day', for a window with no captured day", () => {
    const { container } = render(
      <ReviewCard
        review={reviewView({
          after: { from_date: "2026-10-16", to_date: "2026-10-22", days_captured: 0, count: 0 },
          suggestion: { verdict: null, reason: "not_enough_days", change_ratio: null },
        })}
        lang="en"
      />,
    );
    const tiles = container.querySelectorAll(".b6-tile");
    expect(tiles[1]!.textContent).toContain("No rate yet");
    expect(tiles[1]!.textContent).not.toContain("per day");
  });

  it("marks a simulated review with an amber chip beside the kicker", () => {
    render(<ReviewCard review={reviewView({ simulated: true })} lang="en" />);
    expect(screen.getByText("Simulated time (demo)").className).toContain("b6-chip--amber");
  });

  it("renders the title, metric line and description in order", () => {
    const { container } = render(<ReviewCard review={reviewView()} lang="en" />);
    const lines = texts(container);
    const metric = t("en", "C-prop-metric", {
      category: t("en", CATEGORY_KEY.CUSTOMER_SERVICE),
      direction: t("en", "C-prop-dir-decrease"),
      count: 6,
      days: 3,
    });
    const want = ["Check the display more often", metric, "Sold-out requests per day."];
    let at = -1;
    for (const w of want) {
      const idx = lines.findIndex((l, i) => i > at && l === w);
      expect(idx, `missing or out of order: ${w}`).toBeGreaterThan(at);
      at = idx;
    }
  });

  it("shows counts, captured days and rate per day for both windows", () => {
    render(<ReviewCard review={reviewView()} lang="en" />);
    screen.getByText("Before (Tue 6 Oct to Mon 12 Oct): 6 in 3 captured days, 2.0 per day");
    screen.getByText("After (Fri 16 Oct to Thu 22 Oct): 3 in 3 captured days, 1.0 per day");
    screen.getByText("This is a short window, so read the numbers with care.");
  });

  it("shows 'no captured days' instead of a rate when a window has 0 days", () => {
    render(
      <ReviewCard
        review={reviewView({
          after: { from_date: "2026-10-16", to_date: "2026-10-22", days_captured: 0, count: 0 },
          suggestion: { verdict: null, reason: "not_enough_days", change_ratio: null },
        })}
        lang="en"
      />,
    );
    screen.getByText("After (Fri 16 Oct to Thu 22 Oct): no captured days");
  });

  it("words a before window with 0 days the same way, in Bahasa too", () => {
    render(
      <ReviewCard
        review={reviewView({
          before: { from_date: "2026-10-06", to_date: "2026-10-12", days_captured: 0, count: 0 },
          suggestion: { verdict: null, reason: "no_baseline", change_ratio: null },
        })}
        lang="id"
      />,
    );
    screen.getByText("Sebelum (Sel 6 Okt s.d. Sen 12 Okt): tidak ada hari terekam");
  });

  it("draws the bars in proportion to the rate: before 2/day -> 100%, after 1/day -> 50%, hidden from screen readers", () => {
    const { container } = render(<ReviewCard review={reviewView()} lang="en" />);
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="rate-bar"]');
    expect(bars).toHaveLength(2);
    expect(bars[0]!.style.width).toBe("100%");
    expect(bars[1]!.style.width).toBe("50%");
    for (const bar of bars) expect(bar.parentElement!.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps a visible sliver for a tiny non-zero rate, and none for a zero rate", () => {
    const before = { from_date: "2026-10-06", to_date: "2026-10-12", days_captured: 1, count: 1000 };
    const { container, rerender } = render(
      <ReviewCard
        review={reviewView({ before, after: { from_date: "2026-10-16", to_date: "2026-10-22", days_captured: 3, count: 1 } })}
        lang="en"
      />,
    );
    let bars = container.querySelectorAll<HTMLElement>('[data-testid="rate-bar"]');
    expect(bars[1]!.style.minWidth).toBe("2px");
    rerender(
      <ReviewCard
        review={reviewView({ before, after: { from_date: "2026-10-16", to_date: "2026-10-22", days_captured: 3, count: 0 } })}
        lang="en"
      />,
    );
    bars = container.querySelectorAll<HTMLElement>('[data-testid="rate-bar"]');
    expect(bars[1]!.style.width).toBe("0%");
    expect(bars[1]!.style.minWidth).toBe("");
  });

  it("shows the suggested verdict with the percentage and the reason", () => {
    render(<ReviewCard review={reviewView()} lang="en" />);
    const line = screen.getByText("Bee6 suggests: Worked");
    expect(line.id).toBe(suggestionDomId(2));
    screen.getByText("the count per day moved the right way by 50%");
  });

  it("explains a worsened result with the wrong-way copy", () => {
    render(
      <ReviewCard
        review={reviewView({ suggestion: { verdict: "revert", reason: "worsened", change_ratio: 0.333 } })}
        lang="en"
      />,
    );
    screen.getByText("Bee6 suggests: Revert");
    screen.getByText("the count per day moved the wrong way by 33%");
  });

  it("explains a no-clear-change result without a percentage", () => {
    render(
      <ReviewCard
        review={reviewView({ suggestion: { verdict: "revise", reason: "no_clear_change", change_ratio: -0.1 } })}
        lang="en"
      />,
    );
    screen.getByText("Bee6 suggests: Revise");
    screen.getByText("the count per day changed by less than 20%");
  });

  it("shows the no-suggestion line with its reason for not_enough_days and no_baseline", () => {
    const { rerender } = render(
      <ReviewCard
        review={reviewView({ suggestion: { verdict: null, reason: "not_enough_days", change_ratio: null } })}
        lang="en"
      />,
    );
    screen.getByText("Bee6 has no suggestion: fewer than 2 captured days in one of the windows");
    expect(screen.queryByText(/^Bee6 suggests/)).toBeNull();
    rerender(
      <ReviewCard
        review={reviewView({ suggestion: { verdict: null, reason: "no_baseline", change_ratio: null } })}
        lang="en"
      />,
    );
    screen.getByText("Bee6 has no suggestion: there were none before the change");
  });

  it("shows the failure condition", () => {
    render(<ReviewCard review={reviewView()} lang="en" />);
    screen.getByText("Failure condition:");
    expect(screen.getByText("Failure condition:").parentElement!.textContent).toContain("Sold-out requests do not fall.");
  });

  it("labels simulated time only when the review is simulated", () => {
    const { rerender } = render(<ReviewCard review={reviewView()} lang="en" />);
    expect(screen.queryByText("Simulated time (demo)")).toBeNull();
    rerender(<ReviewCard review={reviewView({ simulated: true })} lang="en" />);
    screen.getByText("Simulated time (demo)");
  });

  it("shows the generic overlap notice and the truncation notice only when set", () => {
    const { rerender } = render(<ReviewCard review={reviewView()} lang="en" />);
    expect(screen.queryByText(/Another SOP change/)).toBeNull();
    expect(screen.queryByText(/Too many records/)).toBeNull();
    rerender(
      <ReviewCard
        review={reviewView({ notices: { overlapping_change: true, threads_truncated: true } })}
        lang="en"
      />,
    );
    screen.getByText("Another SOP change took effect during the measured period; these numbers may mix both.");
    screen.getByText("Too many records to read in full; the counts may be low.");
  });

  it("renders each status line", () => {
    const { rerender } = render(<ReviewCard review={reviewView()} lang="en" />);
    screen.getByText("Waiting for the supervisor's verdict by Fri 30 Oct");
    rerender(
      <ReviewCard
        review={reviewView({
          status: "awaiting_owner",
          supervisor: { verdict: "revise", reason: null, decided_date: "2026-10-24" },
        })}
        lang="en"
      />,
    );
    screen.getByText("Waiting for the owner's verdict by Fri 30 Oct");
    rerender(
      <ReviewCard
        review={reviewView({
          status: "confirmed",
          supervisor: { verdict: "revise", reason: null, decided_date: "2026-10-24" },
          owner: { verdict: "worked", reason: null, decided_date: "2026-10-25" },
        })}
        lang="en"
      />,
    );
    screen.getByText("Confirmed. Remembered as: Worked");
    rerender(<ReviewCard review={reviewView({ status: "unknown" })} lang="en" />);
    screen.getByText("Not confirmed in time. Stored as unknown and not remembered.");
  });

  it("shows both verdict lines with their dates; supervisor and owner reasons are both visible", () => {
    render(
      <ReviewCard
        review={reviewView({
          status: "confirmed",
          supervisor: { verdict: "revise", reason: "Too few busy days", decided_date: "2026-10-24" },
          owner: { verdict: "worked", reason: "Looks right to me", decided_date: "2026-10-25" },
        })}
        lang="en"
      />,
    );
    screen.getByText("Supervisor's verdict on Sat 24 Oct: Revise");
    screen.getByText("Owner's verdict on Sun 25 Oct: Worked");
    screen.getByText("Too few busy days");
    screen.getByText("Looks right to me");
  });

  it("renders a reason as plain text, never as HTML", () => {
    const { container } = render(
      <ReviewCard
        review={reviewView({
          status: "awaiting_owner",
          supervisor: { verdict: "revise", reason: "<b>x</b><img src=x onerror=alert(1)>", decided_date: "2026-10-24" },
        })}
        lang="en"
      />,
    );
    screen.getByText("<b>x</b><img src=x onerror=alert(1)>");
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("omits the reason line when there is no reason", () => {
    render(
      <ReviewCard
        review={reviewView({
          status: "awaiting_owner",
          supervisor: { verdict: "revise", reason: null, decided_date: "2026-10-24" },
        })}
        lang="en"
      />,
    );
    expect(screen.queryByText("Reason:")).toBeNull();
  });

  it("shows the revert note when any verdict is revert, and not otherwise", () => {
    const note = "Reverting does not change the SOP by itself. To undo the change, generate a new proposal.";
    const { rerender } = render(<ReviewCard review={reviewView()} lang="en" />);
    expect(screen.queryByText(note)).toBeNull();
    rerender(
      <ReviewCard
        review={reviewView({
          status: "awaiting_owner",
          supervisor: { verdict: "revert", reason: null, decided_date: "2026-10-24" },
        })}
        lang="en"
      />,
    );
    screen.getByText(note);
    rerender(
      <ReviewCard
        review={reviewView({
          status: "confirmed",
          supervisor: { verdict: "worked", reason: null, decided_date: "2026-10-24" },
          owner: { verdict: "revert", reason: null, decided_date: "2026-10-25" },
        })}
        lang="en"
      />,
    );
    screen.getByText(note);
  });

  it("renders its children after the status line", () => {
    const { container } = render(
      <ReviewCard review={reviewView()} lang="en">
        <button type="button">child action</button>
      </ReviewCard>,
    );
    const status = screen.getByText("Waiting for the supervisor's verdict by Fri 30 Oct");
    const child = screen.getByRole("button", { name: "child action" });
    expect(container.contains(child)).toBe(true);
    expect(status.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders in Bahasa Indonesia", () => {
    render(<ReviewCard review={reviewView()} lang="id" />);
    screen.getByText("SOP versi 2 · ditinjau pada Jum 23 Okt");
    screen.getByText("Saran Bee6: Berhasil");
  });

  it("maps every verdict to a copy key", () => {
    expect(Object.keys(VERDICT_KEY).sort()).toEqual(["revert", "revise", "worked"]);
  });
});
