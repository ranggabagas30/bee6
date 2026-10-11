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

describe("ProposalCard — title heading level", () => {
  it("defaults to an h2 so the generate result card is unchanged", () => {
    render(<ProposalCard lang="en" proposal={awaitingProposal()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Add a greeting script" })).not.toBeNull();
  });

  it("titleLevel 3 renders the title as an h3", () => {
    render(<ProposalCard lang="en" proposal={awaitingProposal()} titleLevel={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "Add a greeting script" })).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
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

const NO_NOTICES = { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false };
const NO_REVIEW = { supervisor: null, owner: null };

describe("ProposalCard — status line for all six statuses (R-09 7.T1)", () => {
  it.each([
    ["suppressed", "No proposal"],
    ["blocked", "Blocked by the evidence check"],
    ["awaiting_supervisor", "Waiting for supervisor review"],
    ["awaiting_owner", "Waiting for owner approval"],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
  ] as const)("%s shows %s", (status, line) => {
    const base = awaitingProposal();
    render(<ProposalCard lang="en" proposal={{ ...base, status }} />);
    expect(screen.getByText(line)).not.toBeNull();
  });

  it("the Bahasa column resolves the three new status lines", () => {
    const base = awaitingProposal();
    const { rerender } = render(<ProposalCard lang="id" proposal={{ ...base, status: "awaiting_owner" }} />);
    expect(screen.getByText("Menunggu persetujuan pemilik")).not.toBeNull();
    rerender(<ProposalCard lang="id" proposal={{ ...base, status: "approved" }} />);
    expect(screen.getByText("Disetujui")).not.toBeNull();
    rerender(<ProposalCard lang="id" proposal={{ ...base, status: "rejected" }} />);
    expect(screen.getByText("Ditolak")).not.toBeNull();
  });

  it("a decided proposal still renders its content block", () => {
    render(<ProposalCard lang="en" proposal={{ ...awaitingProposal(), status: "approved" }} />);
    expect(screen.getByRole("heading", { name: "Add a greeting script" })).not.toBeNull();
  });
});

describe("ProposalCard — review lines (R-09 7.T2)", () => {
  it("shows the supervisor feasible line with the decided date", () => {
    render(
      <ProposalCard
        lang="en"
        proposal={{ ...awaitingProposal(), status: "awaiting_owner" }}
        review={{ supervisor: { decision: "feasible", reason: null, decided_date: "2026-10-05" }, owner: null }}
      />,
    );
    expect(screen.getByText("The supervisor marked this feasible on Mon 5 Oct.")).not.toBeNull();
  });

  it("shows the supervisor rejection line and the reason as a separate text node", () => {
    render(
      <ProposalCard
        lang="en"
        proposal={{ ...awaitingProposal(), status: "rejected" }}
        review={{
          supervisor: { decision: "rejected", reason: "The oven only holds 2.5 kg", decided_date: "2026-10-05" },
          owner: null,
        }}
      />,
    );
    expect(screen.getByText("The supervisor rejected this on Mon 5 Oct. Reason:")).not.toBeNull();
    expect(screen.getByText("The oven only holds 2.5 kg")).not.toBeNull();
  });

  it("shows the owner approved and owner rejected lines", () => {
    const { rerender } = render(
      <ProposalCard
        lang="en"
        proposal={{ ...awaitingProposal(), status: "approved" }}
        review={{
          supervisor: { decision: "feasible", reason: null, decided_date: "2026-10-05" },
          owner: { decision: "approved", reason: null, decided_date: "2026-10-06" },
        }}
      />,
    );
    expect(screen.getByText("The owner approved this on Tue 6 Oct.")).not.toBeNull();

    rerender(
      <ProposalCard
        lang="en"
        proposal={{ ...awaitingProposal(), status: "rejected" }}
        review={{
          supervisor: { decision: "feasible", reason: null, decided_date: "2026-10-05" },
          owner: { decision: "rejected", reason: "No new equipment this quarter", decided_date: "2026-10-06" },
        }}
      />,
    );
    expect(screen.getByText("The owner rejected this on Tue 6 Oct. Reason:")).not.toBeNull();
    expect(screen.getByText("No new equipment this quarter")).not.toBeNull();
  });

  it("renders a reason containing markup as literal text, never an element", () => {
    const { container } = render(
      <ProposalCard
        lang="en"
        proposal={{ ...awaitingProposal(), status: "rejected" }}
        review={{
          supervisor: { decision: "rejected", reason: "<b>x</b>", decided_date: "2026-10-05" },
          owner: null,
        }}
      />,
    );
    expect(screen.getByText("<b>x</b>")).not.toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("ProposalCard — notices (R-09 7.T3)", () => {
  it("renders each notice in its own paragraph and lists late constraint texts as plain text", () => {
    const { container } = render(
      <ProposalCard
        lang="en"
        proposal={awaitingProposal()}
        review={NO_REVIEW}
        notices={{
          late_constraints: [
            { constraint_id: "22222222-2222-2222-2222-222222222222", text: "The oven only holds 2.5 kg" },
            { constraint_id: "33333333-3333-3333-3333-333333333333", text: "<i>no</i> new hires" },
          ],
          evidence_stale: true,
          sop_changed: true,
          superseded: true,
        }}
      />,
    );
    expect(screen.getByText("A newer proposal exists for these dates. Decide on that one.")).not.toBeNull();
    expect(screen.getByText("Some of the evidence no longer holds. Generate again for these dates.")).not.toBeNull();
    expect(screen.getByText("The SOP has changed since this proposal was made. Generate again.")).not.toBeNull();
    expect(
      screen.getByText("Added after this proposal was made. Check the proposal against it before you decide:"),
    ).not.toBeNull();
    expect(screen.getByText("The oven only holds 2.5 kg")).not.toBeNull();
    expect(screen.getByText("<i>no</i> new hires")).not.toBeNull();
    expect(container.querySelector("i")).toBeNull();
  });

  it("without review and notices props, none of the new strings appear and no list is added", () => {
    const { container } = render(<ProposalCard lang="en" proposal={awaitingProposal()} />);
    expect(screen.queryByText(/The supervisor/)).toBeNull();
    expect(screen.queryByText(/The owner/)).toBeNull();
    expect(screen.queryByText(/newer proposal exists/)).toBeNull();
    expect(screen.queryByText(/no longer holds/)).toBeNull();
    expect(screen.queryByText(/SOP has changed/)).toBeNull();
    expect(screen.queryByText(/Added after this proposal/)).toBeNull();
    expect(container.querySelectorAll("article > ul")).toHaveLength(2); // rubric + evidence only
  });

  it("empty notices render nothing extra", () => {
    render(<ProposalCard lang="en" proposal={awaitingProposal()} review={NO_REVIEW} notices={NO_NOTICES} />);
    expect(screen.queryByText(/Added after this proposal/)).toBeNull();
    expect(screen.queryByText(/newer proposal exists/)).toBeNull();
  });

  it("renders children last, inside the article", () => {
    const { container } = render(
      <ProposalCard lang="en" proposal={awaitingProposal()}>
        <p>child-slot</p>
      </ProposalCard>,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.lastElementChild?.textContent).toBe("child-slot");
  });
});
