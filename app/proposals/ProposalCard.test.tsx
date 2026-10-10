// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ProposalView } from "@/lib/proposals/contract";
import { ProposalCard } from "@/app/proposals/ProposalCard";

afterEach(() => {
  cleanup();
});

function baseProposal(overrides: Partial<ProposalView> = {}): ProposalView {
  return {
    proposal_id: "11111111-1111-1111-1111-111111111111",
    status: "suppressed",
    created_at_ms: 1,
    range: { from_date: "2026-10-01", to_date: "2026-10-07" },
    suppression: null,
    blocked_rule: null,
    content: null,
    ...overrides,
  };
}

describe("ProposalCard — suppressed / insufficient_evidence", () => {
  it("shows the fact/day counts and (when categories exist) the watch line", () => {
    render(
      <ProposalCard
        lang="en"
        proposal={baseProposal({
          suppression: {
            reason: "insufficient_evidence",
            model_reason: null,
            followup: { categories: ["COMPLAINT"], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
          },
        })}
      />,
    );
    expect(screen.getByText("No proposal")).not.toBeNull();
    expect(
      screen.getByText("Not enough evidence yet: 1 fact(s) on 1 day(s). A proposal needs 2 facts on 2 different days."),
    ).not.toBeNull();
    expect(screen.getByText("Watch for: Customer complaint")).not.toBeNull();
  });

  it("omits the watch line when followup.categories is empty", () => {
    render(
      <ProposalCard
        lang="en"
        proposal={baseProposal({
          suppression: {
            reason: "insufficient_evidence",
            model_reason: null,
            followup: { categories: [], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
          },
        })}
      />,
    );
    expect(screen.queryByText(/^Watch for:/)).toBeNull();
  });
});

describe("ProposalCard — suppressed / model_declined", () => {
  it.each([
    ["no_clear_pattern", "The facts show no clear repeated problem."],
    ["constraints_block", "No change fits all saved constraints."],
    ["no_matching_intervention", "No intervention in the library fits."],
    ["evidence_conflicts", "The facts point in different directions."],
  ] as const)("shows the declined reason text for %s, then the follow-up lines", (reason, message) => {
    render(
      <ProposalCard
        lang="en"
        proposal={baseProposal({
          suppression: {
            reason: "model_declined",
            model_reason: reason,
            followup: { categories: [], have_facts: 3, have_dates: 2, need_facts: 2, need_dates: 2 },
          },
        })}
      />,
    );
    expect(screen.getByText(message)).not.toBeNull();
    expect(
      screen.getByText("Not enough evidence yet: 3 fact(s) on 2 day(s). A proposal needs 2 facts on 2 different days."),
    ).not.toBeNull();
  });
});

describe("ProposalCard — blocked", () => {
  it("shows the blocked message with the fired rule code", () => {
    render(<ProposalCard lang="en" proposal={baseProposal({ status: "blocked", blocked_rule: "evidence_stale" })} />);
    expect(screen.getByText("Blocked by the evidence check")).not.toBeNull();
    expect(
      screen.getByText("The proposal did not pass the evidence check (evidence_stale). Nothing was sent for review."),
    ).not.toBeNull();
  });
});

function awaitingProposal(overrides: Partial<NonNullable<ProposalView["content"]>> = {}): ProposalView {
  return baseProposal({
    status: "awaiting_supervisor",
    content: {
      intervention: { id: "add_script", label_en: "Add script", label_id: "Tambah skrip" },
      rubric: [
        { id: "observable", label_en: "Observable", label_id: "Teramati" },
        { id: "time_bound", label_en: "Time-bound", label_id: "Terikat waktu" },
      ],
      target_step: null,
      change_title: "Add a greeting script",
      change_text: "Staff say a fixed line when a customer walks in.",
      rationale: "Customers were not greeted on three separate dates.",
      metric: {
        category: "CUSTOMER_SERVICE",
        direction: "decrease",
        description: "Count of unmet-greeting facts per day.",
        baseline_count: 3,
        baseline_days: 3,
      },
      failure_condition: "No change if the count does not drop within the review window.",
      review_date: "2026-11-01",
      evidence: [
        { date: "2026-10-01", start_hm: "09:00", category: "CUSTOMER_SERVICE", summary: "A customer was not greeted." },
        { date: "2026-10-03", start_hm: "10:00", category: "CUSTOMER_SERVICE", summary: null },
      ],
      censored_floor: true,
      ...overrides,
    },
  });
}

describe("ProposalCard — awaiting_supervisor (content-bearing)", () => {
  it("renders every section, with a null-summary evidence row showing the expired copy, and the always-on censored line", () => {
    render(<ProposalCard lang="en" proposal={awaitingProposal()} />);

    expect(screen.getByText("Waiting for supervisor review")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Add a greeting script" })).not.toBeNull();
    expect(screen.getByText("Add script")).not.toBeNull();
    expect(screen.getByText("Observable")).not.toBeNull();
    expect(screen.getByText("Time-bound")).not.toBeNull();
    expect(screen.getByText("New step")).not.toBeNull(); // target_step: null
    expect(screen.getByText("Staff say a fixed line when a customer walks in.")).not.toBeNull();
    expect(screen.getByText("Customers were not greeted on three separate dates.")).not.toBeNull();
    // Each evidence row is one text run (date, time, category, summary) — not
    // separately queryable spans — so these assert the row's full text.
    expect(screen.getByText("Thu 1 Oct 09:00 · Customer service · A customer was not greeted.")).not.toBeNull();
    expect(screen.getByText("Sat 3 Oct 10:00 · Customer service · (no longer stored)")).not.toBeNull(); // the null-summary row
    expect(
      screen.getByText("Metric: Customer service per day should go down (now 3 in 3 days)"),
    ).not.toBeNull();
    expect(screen.getByText("Count of unmet-greeting facts per day.")).not.toBeNull();
    expect(screen.getByText("No change if the count does not drop within the review window.")).not.toBeNull();
    expect(
      screen.getByText(
        "Unmet requests counted here are a floor: real demand is higher, because not every request is heard or said.",
      ),
    ).not.toBeNull();
  });

  it("shows the real step title when target_step is not null", () => {
    render(
      <ProposalCard
        lang="en"
        proposal={awaitingProposal({ target_step: { step_id: "step-3", title: "Greet the customer" } })}
      />,
    );
    expect(screen.getByText("Greet the customer")).not.toBeNull();
    expect(screen.queryByText("New step")).toBeNull();
  });

  it("has no <button> (R-09 adds the review actions)", () => {
    const { container } = render(<ProposalCard lang="en" proposal={awaitingProposal()} />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("switching EN -> ID swaps translated labels but not model free text (change_text)", () => {
    const { rerender } = render(<ProposalCard lang="en" proposal={awaitingProposal()} />);
    expect(screen.getByText("Add script")).not.toBeNull();
    expect(screen.getByText("Staff say a fixed line when a customer walks in.")).not.toBeNull();

    rerender(<ProposalCard lang="id" proposal={awaitingProposal()} />);
    expect(screen.getByText("Tambah skrip")).not.toBeNull();
    // Model free text is never translated — identical string in both languages.
    expect(screen.getByText("Staff say a fixed line when a customer walks in.")).not.toBeNull();
  });
});

describe("ProposalCard — 360px safety", () => {
  it("the card's root style uses overflowWrap: anywhere and no fixed width over 360", () => {
    const { container } = render(<ProposalCard lang="en" proposal={awaitingProposal()} />);
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.overflowWrap).toBe("anywhere");
    expect(article.style.width).toBe("");
  });
});
