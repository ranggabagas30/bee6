// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProposalDetail } from "@/app/proposals/ProposalDetail";
import type { ProposalListItem } from "@/lib/proposals/review-contract";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;
const ID = "11111111-1111-4111-8111-111111111111";
const LATE = "22222222-2222-4222-8222-222222222222";
const REVIEW_PATH = `/api/v1/proposals/${ID}/review`;

function item(
  status: ProposalListItem["proposal"]["status"] = "awaiting_supervisor",
  extra: { notices?: Partial<ProposalListItem["notices"]>; target_step?: { step_id: string; title: string; text: string | null } | null } = {},
): ProposalListItem {
  return {
    proposal: {
      proposal_id: ID,
      status,
      created_at_ms: 1,
      range: { from_date: "2026-10-05", to_date: "2026-10-11" },
      focus_category: "CUSTOMER_SERVICE",
      suppression: null,
      blocked_rule: null,
      content: {
        intervention: { id: "add_step_detail", label_en: "Add detail", label_id: "Tambah detail" },
        rubric: [{ id: "observable", label_en: "Observable", label_id: "Teramati" }],
        target_step:
          extra.target_step === undefined
            ? { step_id: "display-check", title: "Display check", text: "Check the display every hour and refill items that are running low." }
            : extra.target_step,
        change_title: "Write the bake time on every tray label",
        change_text: "Check the display every hour, refill items that are running low, and write the bake time on each tray label.",
        rationale: "On two days a customer asked if the egg tarts were fresh.",
        metric: {
          category: "CUSTOMER_SERVICE",
          direction: "decrease",
          description: "Egg tart freshness questions per day",
          baseline_count: 2,
          baseline_days: 2,
        },
        failure_condition: "Questions keep coming.",
        review_date: "2026-10-21",
        evidence: [
          { date: "2026-10-06", start_hm: "10:40", category: "CUSTOMER_SERVICE", summary: "A customer asked if the egg tarts were fresh." },
          { date: "2026-10-07", start_hm: "10:30", category: "CUSTOMER_SERVICE", summary: null },
        ],
        censored_floor: true,
      },
    },
    review: { supervisor: null, owner: null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false, ...extra.notices },
  };
}

function renderDetail(it: ProposalListItem = item(), props: Partial<Parameters<typeof ProposalDetail>[0]> = {}) {
  const onBack = vi.fn();
  const onFeasible = vi.fn();
  const onSettled = vi.fn();
  render(
    <ProposalDetail auth={AUTH} lang="en" item={it} feasible={false} onBack={onBack} onFeasible={onFeasible} onSettled={onSettled} {...props} />,
  );
  return { onBack, onFeasible, onSettled };
}

beforeEach(() => {
  authedPostJson.mockReset();
  signOut.mockReset();
  replace.mockReset();
});

afterEach(() => cleanup());

describe("ProposalDetail — content (D2-03e)", () => {
  it("shows the step chip, the status pill, the title, the struck old wording and the new wording", () => {
    renderDetail();
    expect(screen.getByText("Display check")).not.toBeNull();
    expect(screen.getByText("Waiting for your check")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Write the bake time on every tray label" })).not.toBeNull();
    expect(screen.getByText("WHAT CHANGES IN THE SOP")).not.toBeNull();
    const before = screen.getByText("Check the display every hour and refill items that are running low.");
    expect(before.tagName).toBe("DEL"); // same element as PR-9a's SOP book, not <s>
    expect(screen.getByText("Check the display every hour, refill items that are running low, and write the bake time on each tray label.")).not.toBeNull();
  });

  it("shows the rationale as one line under the title", () => {
    renderDetail();
    const title = screen.getByRole("heading", { level: 1 });
    const why = screen.getByText("On two days a customer asked if the egg tarts were fresh.");
    expect(why.tagName).toBe("P");
    expect(title.nextElementSibling).toBe(why);
  });

  it("a new step shows 'New step' and no struck wording", () => {
    renderDetail(item("awaiting_supervisor", { target_step: null }));
    expect(screen.getByText("New step")).not.toBeNull();
    expect(document.querySelector("del")).toBeNull();
    expect(document.querySelector("s")).toBeNull();
  });

  it("the evidence block counts moments and distinct days and lists date · time — summary (expired summary gets the stored-no-longer line)", () => {
    renderDetail();
    expect(screen.getByText("THE EVIDENCE · 2 MOMENTS ON 2 DAYS")).not.toBeNull();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Tue 6 Oct · 10:40");
    expect(items[0]!.textContent).toContain("A customer asked if the egg tarts were fresh.");
    expect(items[1]!.textContent).toContain("(no longer stored)");
  });

  it("shows the metric, the review date and the feasible note", () => {
    renderDetail();
    expect(screen.getByText("WATCH THIS METRIC")).not.toBeNull();
    expect(screen.getByText("Egg tart freshness questions per day")).not.toBeNull();
    expect(screen.getByText("REVIEW DATE")).not.toBeNull();
    expect(screen.getByText("Wed 21 Oct")).not.toBeNull();
    expect(screen.getByText("Feasible means staff can do this in the shop. The owner approves or rejects after you.")).not.toBeNull();
  });

  it("‹ Proposals calls onBack", () => {
    const { onBack } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "‹ Proposals" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// CHK-1: the "Checked by Bee6" card sits right after the evidence block.
describe("ProposalDetail — checked by Bee6 (CHK-1)", () => {
  const V3 = { checks_total: 8, checks_passed: 8, rule_set: "pgate-v1", agent: "proposal-v3", revisions: 0, read_sections: null, read_facts: null } as const;
  const V4 = { checks_total: 18, checks_passed: 18, rule_set: "pcheck-v4", agent: "proposal-v4", revisions: 1, read_sections: 1, read_facts: 2 } as const;
  const withChecked = (checked: ProposalListItem["proposal"]["checked"]): ProposalListItem => {
    const it = item();
    return { ...it, proposal: { ...it.proposal, checked } };
  };

  it("v3: shows '8 OF 8 CHECKS' and the fixed-rules line, and hides the agent-reads line", () => {
    renderDetail(withChecked(V3));
    expect(screen.getByText("CHECKED BY BEE6 · 8 OF 8 CHECKS")).not.toBeNull();
    expect(screen.getByText("Every check is a fixed rule in code, not the model's opinion.")).not.toBeNull();
    expect(screen.queryByText(/The agent read/)).toBeNull();
    expect(screen.queryByText(/Revised/)).toBeNull();
  });

  it("v4: shows the reads line with the counts, and the revision line", () => {
    renderDetail(withChecked(V4));
    expect(screen.getByText("CHECKED BY BEE6 · 18 OF 18 CHECKS")).not.toBeNull();
    expect(screen.getByText("The agent read 1 SOP section(s) and 2 fact(s) before writing.")).not.toBeNull();
    expect(screen.getByText("Revised 1 time(s) until every check passed.")).not.toBeNull();
  });

  it("sits directly after the evidence block", () => {
    renderDetail(withChecked(V3));
    const evidence = screen.getByText("THE EVIDENCE · 2 MOMENTS ON 2 DAYS").closest("section")!;
    const checked = screen.getByText("CHECKED BY BEE6 · 8 OF 8 CHECKS").closest("section")!;
    expect(evidence.nextElementSibling).toBe(checked);
  });

  it("nothing is rendered when `checked` is null or absent (the existing list still has exactly one list)", () => {
    renderDetail(withChecked(null));
    expect(screen.queryByText(/CHECKED BY BEE6/)).toBeNull();
    cleanup();
    renderDetail(item());
    expect(screen.queryByText(/CHECKED BY BEE6/)).toBeNull();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  it("shows on a feasible (hand-over) detail too, and in Bahasa", () => {
    renderDetail(withChecked(V4), { feasible: true, lang: "id" });
    expect(screen.getByText("DIPERIKSA BEE6 · 18 DARI 18 PEMERIKSAAN")).not.toBeNull();
  });
});

describe("ProposalDetail — mark feasible", () => {
  it("posts { decision: 'feasible', acknowledged_constraint_ids: [] } once to the review route and calls onFeasible", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    authedPostJson.mockImplementationOnce(() => new Promise((r) => { resolveFn = r; }));
    const { onFeasible, onSettled } = renderDetail();
    const button = screen.getByRole("button", { name: "Mark feasible" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(AUTH, REVIEW_PATH, { decision: "feasible", acknowledged_constraint_ids: [] }, expect.anything());
    resolveFn({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    await waitFor(() => expect(onFeasible).toHaveBeenCalledTimes(1));
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("late constraints: listed, and Mark feasible stays disabled until the acknowledgement is ticked; the ids go in the body", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    renderDetail(item("awaiting_supervisor", { notices: { late_constraints: [{ constraint_id: LATE, text: "No price talk" }] } }));
    expect(screen.getByText("No price talk")).not.toBeNull();
    const feasible = screen.getByRole("button", { name: "Mark feasible" }) as HTMLButtonElement;
    expect(feasible.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(feasible.disabled).toBe(false);
    fireEvent.click(feasible);
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(1));
    expect(authedPostJson.mock.calls[0]![2]).toEqual({ decision: "feasible", acknowledged_constraint_ids: [LATE] });
  });

  it("stale evidence or a changed SOP disables Mark feasible and shows the notice; Reject stays available", () => {
    renderDetail(item("awaiting_supervisor", { notices: { evidence_stale: true } }));
    expect((screen.getByRole("button", { name: "Mark feasible" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Some of the evidence no longer holds. Generate again for these dates.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Reject… (reason required)" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a 409 settles with its own copy key so the list screen can show it", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "ALREADY_DECIDED" });
    const { onSettled, onFeasible } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Mark feasible" }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({ messageKey: "C-prop-err-decided" }));
    expect(onFeasible).not.toHaveBeenCalled();
  });

  it("a network error stays on the screen with the generic alert and the buttons back", async () => {
    authedPostJson.mockResolvedValue({ kind: "error" });
    const { onSettled } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Mark feasible" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Mark feasible" }) as HTMLButtonElement).disabled).toBe(false);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("signed_out signs out and goes to /sign-in", async () => {
    authedPostJson.mockResolvedValue({ kind: "signed_out" });
    signOut.mockResolvedValue(undefined);
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Mark feasible" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });
});

describe("ProposalDetail — inline reject (D2-03f)", () => {
  it("Reject… opens the titled inline panel with the reason field focused; send is disabled until a reason is written; no confirm step", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    const { onSettled } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Reject… (reason required)" }));
    // The panel stays inline (R-19 plan 9.5; tech-lead ruling on UI-078): a form, not a modal dialog.
    expect(screen.queryByRole("dialog")).toBeNull();
    const panel = screen.getByRole("form", { name: "Reject this proposal?" });
    expect(within(panel).getByRole("heading", { level: 2, name: "Reject this proposal?" })).not.toBeNull();
    expect(within(panel).getByText("Give a short reason. Bee6 remembers it and will not suggest the same thing again.")).not.toBeNull();
    const box = within(panel).getByLabelText("Why is this not workable? (required)") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(box);
    const send = screen.getByRole("button", { name: "Reject proposal" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "no" } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  The oven only holds two trays.  " } });
    expect(send.disabled).toBe(false);
    expect(within(panel).getByText("34/300")).not.toBeNull();
    fireEvent.click(send);
    expect(authedPostJson).toHaveBeenCalledWith(AUTH, REVIEW_PATH, { decision: "reject", reason: "The oven only holds two trays." }, expect.anything());
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({ messageKey: "C-propd-rejected" }));
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
  });

  it("the buttons are Reject proposal (destructive) then Cancel (secondary)", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Reject… (reason required)" }));
    const panel = screen.getByRole("form", { name: "Reject this proposal?" });
    const buttons = within(panel).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Reject proposal", "Cancel"]);
    expect(buttons[0]!.className).toContain("b6-btn--destructive");
    expect(buttons[1]!.className).toContain("b6-btn--secondary");
  });

  it("Cancel closes the panel and returns focus to Reject…", () => {
    renderDetail();
    const reject = screen.getByRole("button", { name: "Reject… (reason required)" });
    fireEvent.click(reject);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Why is this not workable? (required)")).toBeNull();
    // The actions row remounts, so the button is re-queried: focus must be on Reject… again, not on <body>.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reject… (reason required)" }));
    expect(authedPostJson).not.toHaveBeenCalled();
  });

  it("a 422 on the reason keeps the field open with the length message", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Reject… (reason required)" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    expect(await screen.findByText("Write between 3 and 300 characters.")).not.toBeNull();
    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByRole("textbox")).not.toBeNull();
  });
});

describe("ProposalDetail — read-only and hand-over", () => {
  it("a proposal not awaiting the supervisor shows no actions", () => {
    renderDetail(item("awaiting_owner"));
    expect(screen.getByText("Waiting for owner approval")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mark feasible" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject… (reason required)" })).toBeNull();
  });

  it("a superseded proposal shows the notice and no actions", () => {
    renderDetail(item("awaiting_supervisor", { notices: { superseded: true } }));
    expect(screen.getByText("A newer proposal exists for these dates. Decide on that one.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Mark feasible" })).toBeNull();
  });

  it("feasible: the banner sits under the title; no action buttons are shown (R-19 PR-A, D2-03g)", () => {
    renderDetail(item("awaiting_owner"), { feasible: true });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toBe("Marked feasible. The owner decides next. Sign out and pick Owner to approve or reject.");
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark feasible" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject… (reason required)" })).toBeNull();
    // The banner already says the owner decides next, so the note is gone; no buttons appear.
    expect(screen.queryByText("Feasible means staff can do this in the shop. The owner approves or rejects after you.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Marked feasible ✓" })).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out.*pick owner/i })).toBeNull();
    // The back button remains above the banner
    expect(screen.getByRole("button", { name: "‹ Proposals" })).not.toBeNull();
  });

  it("no device id, name or thread key appears anywhere on the screen", () => {
    renderDetail();
    expect(document.body.innerHTML).not.toMatch(/device_id|thread_id|answered_by/);
  });
});
