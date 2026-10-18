// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { t } from "@/lib/i18n/dict";
import { CATEGORY_KEY } from "@/lib/day/view-model";
import { ReviewCard, VERDICT_KEY, agentDomId, suggestionDomId } from "@/app/reviews/ReviewCard";
import { reviewView } from "@/app/reviews/review-fixtures";
import { REVIEW_CAVEATS } from "@/lib/reviews/agent/schema";
import { axeViolations } from "@/lib/testing/axe";

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

const NARRATIVE =
  "The display check went up and sold-out requests fell from 2.0 to 1.0 per day. Read it with care: these are only a few days.";

const CAVEAT_COPY_EN: Record<(typeof REVIEW_CAVEATS)[number], string> = {
  short_window: "Short windows: only a few captured days on each side.",
  category_count_not_problem_count:
    "The counts are moments of one kind (for example customer questions), not proof of cause.",
  staff_answers_affect_count: "Some of these moments count only after staff confirmed them in the debrief.",
  overlapping_change: "Another SOP change was in force in the same period.",
  threads_truncated: "Not every note could be read; the counts may be low.",
  not_enough_days: "Fewer than 2 captured days in one of the windows.",
  no_baseline: "No moments of this kind were noted before the change.",
};

describe("ReviewCard: Bee6 explains panel (ReviewAgent, plan 5.12)", () => {
  const withAgent = (caveats: (typeof REVIEW_CAVEATS)[number][] = ["short_window", "category_count_not_problem_count"]) =>
    reviewView({ agent: { narrative_en: NARRATIVE, caveats } });

  it("shows no panel when the review has no agent block (today's card, byte for byte)", () => {
    const { container } = render(<ReviewCard review={reviewView()} lang="en" />);
    expect(screen.queryByText("Bee6 explains")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(screen.queryByText(/Bee6 wrote this explanation/)).toBeNull();
  });

  it("shows the narrative, the fixed framing line and a kick, between the suggestion and the failure line", () => {
    const { container } = render(<ReviewCard review={withAgent()} lang="en" />);
    const kick = screen.getByText("Bee6 explains");
    expect(kick.className).toContain("b6-kick");
    const narrative = screen.getByText(NARRATIVE);
    screen.getByText(
      "Bee6 wrote this explanation. The suggestion above comes from a fixed rule, and the verdict is yours.",
    );
    const suggestion = document.getElementById(suggestionDomId(2))!;
    const failure = screen.getByText(/Sold-out requests do not fall\./);
    expect(suggestion.compareDocumentPosition(narrative) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(narrative.compareDocumentPosition(failure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[role=group][aria-labelledby]")!.getAttribute("aria-labelledby")).toBe(agentDomId(2));
    expect(document.getElementById(agentDomId(2))).toBe(kick);
  });

  it("renders the narrative as a text node: tags are shown as text, never parsed", () => {
    const literal = "<b>x</b> sold-out requests fell <img src=x onerror=alert(1)> in the after window, a good sign.";
    const { container } = render(
      <ReviewCard review={reviewView({ agent: { narrative_en: literal, caveats: [] } })} lang="en" />,
    );
    screen.getByText(literal);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("marks the narrative as English inside a Bahasa screen, and does not translate it", () => {
    render(<ReviewCard review={withAgent()} lang="id" />);
    const narrative = screen.getByText(NARRATIVE);
    expect(narrative.getAttribute("lang")).toBe("en");
    // the rest of the panel is Bahasa (provisional copy), not the English strings
    expect(screen.queryByText("Bee6 explains")).toBeNull();
    expect(screen.queryByText(/Bee6 wrote this explanation/)).toBeNull();
    screen.getByText(t("id", "C-rev-agent-kick"));
    screen.getByText(t("id", "C-rev-agent-note"));
  });

  it.each(REVIEW_CAVEATS)("shows the fixed line for the caveat %s, from the copy table", (caveat) => {
    render(<ReviewCard review={withAgent([caveat])} lang="en" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([CAVEAT_COPY_EN[caveat]]);
    expect(t("id", `C-rev-agent-cv-${caveat}`)).not.toBe(CAVEAT_COPY_EN[caveat]);
  });

  it("lists the caveats in the order given, and renders no list when there are none", () => {
    const { rerender, container } = render(
      <ReviewCard review={withAgent(["overlapping_change", "short_window"])} lang="en" />,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      CAVEAT_COPY_EN.overlapping_change,
      CAVEAT_COPY_EN.short_window,
    ]);
    rerender(<ReviewCard review={withAgent([])} lang="en" />);
    expect(container.querySelector("ul")).toBeNull();
    screen.getByText(NARRATIVE);
  });

  it("does not change the verdict line, the suggestion or the verdict buttons' description target", () => {
    const { container: without } = render(<ReviewCard review={reviewView()} lang="en" />);
    const before = without.querySelector(`#${suggestionDomId(2)}`)!.textContent;
    cleanup();
    const { container: withIt } = render(<ReviewCard review={withAgent()} lang="en" />);
    expect(withIt.querySelector(`#${suggestionDomId(2)}`)!.textContent).toBe(before);
    expect(before).toBe("Bee6 suggests: Worked");
  });

  it("keeps a 600-code-point narrative inside the card on a narrow screen (wraps, never a fixed width)", () => {
    const long = "word ".repeat(120).trim().slice(0, 300);
    const unbroken = "x".repeat(300);
    const { container } = render(
      <ReviewCard review={reviewView({ agent: { narrative_en: `${long} ${unbroken}`, caveats: [] } })} lang="en" />,
    );
    const p = screen.getByText(/^word word/);
    expect(container.querySelector("article")!.contains(p)).toBe(true);
    expect(p.className).toContain("agentText");
    expect(p.getAttribute("style")).toBeNull();
  });

  it("has no axe violations with the panel, in English and Bahasa, and with two cards on the page", async () => {
    for (const lang of ["en", "id"] as const) {
      const { container } = render(
        <main>
          <ReviewCard review={withAgent([...REVIEW_CAVEATS])} lang={lang} />
          <ReviewCard review={{ ...withAgent(["short_window"]), version: 3 }} lang={lang} />
        </main>,
      );
      expect(await axeViolations(container)).toEqual([]);
      cleanup();
    }
  });
});
