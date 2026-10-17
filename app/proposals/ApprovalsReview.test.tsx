// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApprovalsReview, type ApprovalsBridgeEvent } from "@/app/proposals/ApprovalsReview";
import type { ListProposalsResponse, ProposalListItem } from "@/lib/proposals/review-contract";
import type { SopOverview } from "@/lib/sop/contract";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

let proposalsResult: unknown;
let sopResult: unknown = { kind: "ok", data: { today: "2026-10-13", latest: null, in_force_version: null, first_version_date: null, changes: [] } satisfies SopOverview };
const authedGetJson = vi.fn(async (...args: unknown[]) => (args[1] === "/api/v1/proposals" ? proposalsResult : sopResult));
const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;
const WATCH = { from_date: "2026-10-05", to_date: "2026-10-11", categories: [] };
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const FEASIBLE = { decision: "feasible" as const, reason: null, decided_date: "2026-10-12" };

function item(
  n: number,
  status: ProposalListItem["proposal"]["status"],
  opts: {
    title?: string;
    owner?: ProposalListItem["review"]["owner"];
    notices?: Partial<ProposalListItem["notices"]>;
    target_step?: { step_id: string; title: string; text: string | null } | null;
  } = {},
): ProposalListItem {
  return {
    proposal: {
      proposal_id: uuid(n),
      status,
      created_at_ms: n * 1000,
      range: { from_date: "2026-10-05", to_date: "2026-10-11" },
      focus_category: "CUSTOMER_SERVICE",
      suppression: null,
      blocked_rule: null,
      content: {
        intervention: { id: "add_step_detail", label_en: "Add detail", label_id: "Tambah detail" },
        rubric: [{ id: "observable", label_en: "Observable", label_id: "Teramati" }],
        target_step:
          opts.target_step === undefined
            ? { step_id: "display-check", title: "Display check", text: "Check the display every hour." }
            : opts.target_step,
        change_title: opts.title ?? `Proposal ${n}`,
        change_text: `New wording ${n}: write the bake time on each tray label.`,
        rationale: `Why ${n}: customers asked if the egg tarts were fresh.`,
        metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: `Metric ${n} per day`, baseline_count: 2, baseline_days: 2 },
        failure_condition: "Questions keep coming.",
        review_date: "2026-10-21",
        evidence: [
          { date: "2026-10-06", start_hm: "10:40", category: "CUSTOMER_SERVICE", summary: `Evidence ${n}a.` },
          { date: "2026-10-07", start_hm: "10:30", category: "CUSTOMER_SERVICE", summary: null },
        ],
        censored_floor: true,
      },
    },
    review: { supervisor: FEASIBLE, owner: opts.owner ?? null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false, ...opts.notices },
  };
}

const ok = (open: ProposalListItem[], decided: ProposalListItem[] = []): unknown => ({ kind: "ok", data: { open, decided, watch: WATCH } satisfies ListProposalsResponse });
const APPROVED = { decision: "approved" as const, reason: null, decided_date: "2026-10-13" };
const REJECTED = { decision: "rejected" as const, reason: "The oven is too small.", decided_date: "2026-10-13" };
const TWO_WAITING = ok([item(1, "awaiting_owner"), item(2, "awaiting_owner")]);
const SOP_WITH_V2: SopOverview = {
  today: "2026-10-13",
  latest: { version: 2, effective_from_date: "2026-10-14", steps: [{ step_id: "display-check", title: "Display check", text: "x", role: "staff" }] },
  in_force_version: 1,
  first_version_date: "2026-10-01",
  changes: [
    {
      version: 2,
      previous_version: 1,
      effective_from_date: "2026-10-14",
      approved_date: "2026-10-13",
      kind: "modify",
      before: null,
      after: { step_id: "display-check", title: "Display check", text: "x", role: "staff" },
      change_title: "Proposal 1",
      metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "Metric 1 per day", baseline_count: 2, baseline_days: 2 },
      failure_condition: "Questions keep coming.",
      review_date: "2026-10-28",
      outcome: null,
    },
  ],
};

beforeEach(() => {
  proposalsResult = TWO_WAITING;
  sopResult = { kind: "ok", data: { today: "2026-10-13", latest: null, in_force_version: null, first_version_date: null, changes: [] } };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderScreen = (onBridge?: (e: ApprovalsBridgeEvent) => void) => render(<ApprovalsReview auth={AUTH} lang="en" onBridge={onBridge} />);
const card = () => screen.getByRole("region", { name: "Proposal 1" });

describe("ApprovalsReview — states", () => {
  it("shows the loading line until the list arrives", () => {
    proposalsResult = new Promise(() => {});
    renderScreen();
    expect(screen.getByRole("status").textContent).toBe("Loading…");
  });

  it("an error shows the generic line", async () => {
    proposalsResult = { kind: "error" };
    renderScreen();
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
  });

  it("nothing for the owner: the empty state, the head and Back to home still render", async () => {
    proposalsResult = ok([item(1, "awaiting_supervisor")]);
    renderScreen();
    expect(await screen.findByText("Nothing waiting for you.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Approvals");
    expect(screen.getByRole("link", { name: "‹ Back to home" }).getAttribute("href")).toBe("/home");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("a signed-out read signs out and goes to /sign-in", async () => {
    proposalsResult = { kind: "signed_out" };
    renderScreen();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(signOut).toHaveBeenCalled();
  });
});

describe("ApprovalsReview — review in order", () => {
  it("shows the oldest waiting proposal first, the recommended order with status, and the progress segments", async () => {
    proposalsResult = ok([item(2, "awaiting_owner"), item(1, "awaiting_owner")]);
    renderScreen();
    expect((await screen.findByRole("heading", { level: 1, name: "Proposal 1" })).textContent).toBe("Proposal 1");
    const order = screen.getByRole("list", { name: "RECOMMENDED ORDER" });
    const rows = within(order).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("#1");
    expect(rows[0]!.textContent).toContain("Proposal 1");
    expect(rows[0]!.textContent).toContain("Reviewing now");
    expect(rows[1]!.textContent).toContain("#2");
    expect(rows[1]!.textContent).toContain("Waiting for you");
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("2");
    expect(bar.getAttribute("aria-label")).toBe("0 of 2 decided");
  });

  it("the card has the step chip, the three tiles (Cost never a number), the evidence, the metric and the dates from the view", async () => {
    renderScreen();
    const c = await waitFor(card);
    expect(within(c).getByText("Display check")).toBeTruthy();
    expect(within(c).getByText("WHY").parentElement!.textContent).toContain("Why 1: customers asked if the egg tarts were fresh.");
    const extra = within(c).getByText("EXTRA WORK FOR STAFF").parentElement!;
    expect(extra.textContent).toContain("New wording 1: write the bake time on each tray label.");
    expect(extra.querySelector("del")!.textContent).toBe("Check the display every hour.");
    expect(extra.textContent).toContain("Before:");
    const cost = within(c).getByText("COST").parentElement!;
    expect(cost.textContent).toContain("Not estimated yet");
    expect(cost.textContent).toContain("coming soon");
    expect(cost.textContent).not.toMatch(/\d/);
    expect(within(c).getByText("Evidence 1a.", { exact: false })).toBeTruthy();
    expect(within(c).getByText("(no longer stored)", { exact: false })).toBeTruthy();
    expect(within(c).getByText("Metric 1 per day")).toBeTruthy();
    expect(within(c).getByText("Starts the day after approval · review Wed 21 Oct")).toBeTruthy();
  });

  it("a new step shows the New step chip and no struck wording", async () => {
    proposalsResult = ok([item(1, "awaiting_owner", { target_step: null })]);
    renderScreen();
    const c = await waitFor(card);
    expect(within(c).getByText("New step")).toBeTruthy();
    expect(c.querySelector("del")).toBeNull();
  });

  it("picking #2 in the order shows #2 alone (one at a time)", async () => {
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    fireEvent.click(screen.getByRole("button", { name: /^#2 Proposal 2/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Proposal 2" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Proposal 1" })).toBeNull();
  });

  it("opens the proposal from ?id= when it is in the queue", async () => {
    render(<ApprovalsReview auth={AUTH} lang="en" initialId={uuid(2)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Proposal 2" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Proposal 1" })).toBeNull();
    expect(screen.getByRole("button", { name: /^#2 Proposal 2/ }).getAttribute("aria-current")).toBe("true");
  });

  it("an unknown id falls back to the first undecided", async () => {
    render(<ApprovalsReview auth={AUTH} lang="en" initialId={uuid(9)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Proposal 1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Proposal 2" })).toBeNull();
  });

  it("the id of an owner-decided proposal falls back to the first undecided (not the read-only view)", async () => {
    proposalsResult = ok([item(2, "awaiting_owner")], [item(1, "approved", { owner: APPROVED })]);
    render(<ApprovalsReview auth={AUTH} lang="en" initialId={uuid(1)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Proposal 2" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Proposal 1" })).toBeNull();
    expect(screen.getByRole("button", { name: /^#2 Proposal 2/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /^#1 Proposal 1/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByText(/^Decided /)).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("reports the screen to the bridge", async () => {
    const onBridge = vi.fn();
    renderScreen(onBridge);
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    expect(onBridge).toHaveBeenCalledWith({ type: "screen", screen: "review" });
  });
});

describe("ApprovalsReview — approve", () => {
  it("Approve posts to the approve route, reloads, shows the answer, moves to #2 which is now 'Approve · not available' with the SOP-changed line, and the shipped version", async () => {
    const onBridge = vi.fn();
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "approved", status: "approved" } });
    renderScreen(onBridge);
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    proposalsResult = ok([item(2, "awaiting_owner", { notices: { sop_changed: true } })], [item(1, "approved", { owner: APPROVED })]);
    sopResult = { kind: "ok", data: SOP_WITH_V2 };
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(authedPostJson).toHaveBeenCalledWith(AUTH, `/api/v1/proposals/${uuid(1)}/approve`, { decision: "approve", acknowledged_constraint_ids: [] }, expect.anything());

    expect(await screen.findByText("Approved. It ships as a new SOP version.")).toBeTruthy();
    await screen.findByRole("heading", { level: 1, name: "Proposal 2" });
    const na = screen.getByRole("button", { name: "Approve · not available" });
    expect(na.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("The SOP changed after this was drafted. You can still reject it with a reason.")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("1 of 2 decided");
    const order = screen.getByRole("list", { name: "RECOMMENDED ORDER" });
    expect(within(order).getAllByRole("listitem")[0]!.textContent).toContain("Approved");
    expect(await within(order).findByText("Shipped as SOP version 2", { exact: false })).toBeTruthy();
    expect(onBridge).toHaveBeenCalledWith({ type: "progress" });
    // the answer takes focus so it is read out, not the document body
    expect(document.activeElement?.textContent).toBe("Approved. It ships as a new SOP version.");
  });

  it("a double tap sends one request", async () => {
    let resolve: (v: unknown) => void = () => {};
    authedPostJson.mockReturnValue(new Promise((r) => (resolve = r)));
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    const approve = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(approve.hasAttribute("disabled")).toBe(true);
    resolve({ kind: "ok", data: { result: "approved", status: "approved" } });
    await screen.findByText("Approved. It ships as a new SOP version.");
  });

  it("stale evidence disables Approve with the stale notice; a late constraint needs the tick first", async () => {
    proposalsResult = ok([
      item(1, "awaiting_owner", { notices: { evidence_stale: true } }),
      item(2, "awaiting_owner", { notices: { late_constraints: [{ constraint_id: uuid(9), text: "No new trays." }] } }),
    ]);
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Some of the evidence no longer holds. Generate again for these dates.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^#2 Proposal 2/ }));
    expect(screen.getByText("No new trays.")).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(approve.hasAttribute("disabled")).toBe(false);
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "approved", status: "approved" } });
    fireEvent.click(approve);
    expect(authedPostJson).toHaveBeenCalledWith(AUTH, `/api/v1/proposals/${uuid(2)}/approve`, { decision: "approve", acknowledged_constraint_ids: [uuid(9)] }, expect.anything());
  });

  it("after the server answers, the decision stays locked until the reload lands (a fast second tap sends nothing)", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "approved", status: "approved" } });
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    proposalsResult = new Promise(() => {}); // the reload never lands in this test
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Approved. It ships as a new SOP version.")).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Reject with reason" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Reject — why?").hasAttribute("disabled")).toBe(true);
    fireEvent.click(approve);
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Approved. It ships as a new SOP version.")).toBeTruthy();
  });

  it("the lock lifts when the reload lands with the same proposal still waiting (409 SOP_CHANGED → reject stays possible)", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "SOP_CHANGED" });
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    proposalsResult = ok([item(1, "awaiting_owner", { notices: { sop_changed: true } }), item(2, "awaiting_owner")]);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("The SOP has changed, so this cannot go ahead. Generate again.")).toBeTruthy();
    await screen.findByRole("button", { name: "Approve · not available" });
    await waitFor(() => expect(screen.getByLabelText("Reject — why?").hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("Reject — why?"), { target: { value: "Not this week." } });
    expect(screen.getByRole("button", { name: "Reject with reason" }).hasAttribute("disabled")).toBe(false);
  });

  it("a 409 shows its message and reloads", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "SOP_CHANGED" });
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    const reads = authedGetJson.mock.calls.filter((c) => c[1] === "/api/v1/proposals").length;
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("The SOP has changed, so this cannot go ahead. Generate again.")).toBeTruthy();
    await waitFor(() => expect(authedGetJson.mock.calls.filter((c) => c[1] === "/api/v1/proposals").length).toBe(reads + 1));
  });
});

describe("ApprovalsReview — reject with reason", () => {
  it("Reject with reason stays disabled until 3 characters, then posts the trimmed reason", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    const send = screen.getByRole("button", { name: "Reject with reason" });
    const box = screen.getByLabelText("Reject — why?");
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Write a short reason first. It becomes a rule Bee6 will respect.", { exact: false })).toBeTruthy();
    fireEvent.change(box, { target: { value: "  ab " } });
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.change(box, { target: { value: "  The oven is too small. " } });
    expect(send.hasAttribute("disabled")).toBe(false);
    expect(box.getAttribute("maxlength")).toBe("300");
    proposalsResult = ok([item(2, "awaiting_owner")], [item(1, "rejected", { owner: REJECTED })]);
    fireEvent.click(send);
    expect(authedPostJson).toHaveBeenCalledWith(AUTH, `/api/v1/proposals/${uuid(1)}/approve`, { decision: "reject", reason: "The oven is too small." }, expect.anything());
    expect(await screen.findByText("Rejected. Your reason is now a rule Bee6 will respect.")).toBeTruthy();
    await screen.findByRole("heading", { level: 1, name: "Proposal 2" });
    expect((screen.getByLabelText("Reject — why?") as HTMLTextAreaElement).value).toBe("");
  });

  it("two rejections in a row each move focus to the answer (same message key twice)", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    fireEvent.change(screen.getByLabelText("Reject — why?"), { target: { value: "The oven is too small." } });
    proposalsResult = ok([item(2, "awaiting_owner")], [item(1, "rejected", { owner: REJECTED })]);
    fireEvent.click(screen.getByRole("button", { name: "Reject with reason" }));
    await screen.findByRole("heading", { level: 1, name: "Proposal 2" });
    expect(document.activeElement?.textContent).toBe("Rejected. Your reason is now a rule Bee6 will respect.");

    // the owner moves on to the second one: focus is on the send button when the answer comes back
    fireEvent.change(screen.getByLabelText("Reject — why?"), { target: { value: "Not this week." } });
    const send = screen.getByRole("button", { name: "Reject with reason" });
    send.focus();
    expect(document.activeElement).toBe(send);
    proposalsResult = ok([], [item(1, "rejected", { owner: REJECTED }), item(2, "rejected", { owner: REJECTED })]);
    fireEvent.click(send);
    await screen.findByRole("heading", { level: 1, name: "Both decided. Nice and calm." });
    expect(document.activeElement?.textContent).toBe("Rejected. Your reason is now a rule Bee6 will respect.");
  });

  it("the SOP-changed proposal can still be rejected", async () => {
    proposalsResult = ok([item(2, "awaiting_owner", { notices: { sop_changed: true } })], [item(1, "approved", { owner: APPROVED })]);
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 2" });
    expect(screen.getByRole("button", { name: "Approve · not available" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Reject — why?"), { target: { value: "Not this week." } });
    expect(screen.getByRole("button", { name: "Reject with reason" }).hasAttribute("disabled")).toBe(false);
  });

  it("a 422 on the reason shows the length line and keeps the form", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    fireEvent.change(screen.getByLabelText("Reject — why?"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject with reason" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Write between 3 and 300 characters.");
    expect(screen.getByLabelText("Reject — why?")).toBeTruthy();
  });
});

describe("ApprovalsReview — all decided", () => {
  it("both decided: the summary with the shipped version and dates, the rejected reason as a rule, what happens next, and the two links", async () => {
    proposalsResult = ok([], [item(1, "approved", { owner: APPROVED }), item(2, "rejected", { owner: REJECTED })]);
    sopResult = { kind: "ok", data: SOP_WITH_V2 };
    const onBridge = vi.fn();
    renderScreen(onBridge);
    expect(await screen.findByRole("heading", { level: 1, name: "Both decided. Nice and calm." })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("2 of 2 decided");
    expect(await screen.findByText("Shipped as SOP version 2")).toBeTruthy();
    expect(screen.getByText("Starts Wed 14 Oct · review Wed 28 Oct")).toBeTruthy();
    expect(screen.getByText("Now a rule: The oven is too small.")).toBeTruthy();
    expect(screen.getByText("WHAT HAPPENS NEXT")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/home");
    expect(screen.getByRole("link", { name: "See the SOP" }).getAttribute("href")).toBe("/sop");
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(onBridge).toHaveBeenCalledWith({ type: "screen", screen: "all_decided" });
  });

  it("one decided proposal reads 'All decided.' and an approved one without a matching SOP change keeps the day-after line", async () => {
    proposalsResult = ok([], [item(1, "approved", { owner: APPROVED })]);
    renderScreen();
    expect(await screen.findByRole("heading", { level: 1, name: "All decided." })).toBeTruthy();
    expect(screen.getByText("Starts the day after approval · review Wed 21 Oct")).toBeTruthy();
    expect(screen.queryByText(/Shipped as SOP version/)).toBeNull();
  });

  it("a decided proposal opened from the order is read-only with its decision date", async () => {
    proposalsResult = ok([item(2, "awaiting_owner")], [item(1, "approved", { owner: APPROVED })]);
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 2" });
    fireEvent.click(screen.getByRole("button", { name: /^#1 Proposal 1/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Proposal 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(screen.queryByLabelText("Reject — why?")).toBeNull();
    expect(screen.getByText("Decided Tue 13 Oct")).toBeTruthy();
  });
});

describe("ApprovalsReview — page-2 layout (R-25 T11)", () => {
  it("the proposal title is the one h1; the kicker counts the place in the order; one bar per proposal with the open one marked", async () => {
    renderScreen();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(h1.className).toContain("b6-h1-web");
    expect(screen.queryByRole("heading", { name: "Approvals" })).toBeNull();
    expect(screen.getByText("APPROVALS · 1 OF 2 · 2 LEFT").className).toContain("b6-kick");
    const bar = screen.getByRole("progressbar");
    expect(bar.children).toHaveLength(2);
    expect(bar.children[0]!.className).toContain("segmentNow");
    expect(bar.children[1]!.className).not.toContain("segmentNow");
  });

  it("the kicker and bars follow a decision: #2 open, #1 approved", async () => {
    proposalsResult = ok([item(2, "awaiting_owner")], [item(1, "approved", { owner: APPROVED })]);
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 2" });
    expect(screen.getByText("APPROVALS · 2 OF 2 · 1 LEFT")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.children[0]!.className).toContain("segmentApproved");
    expect(bar.children[1]!.className).toContain("segmentNow");
  });

  it("the chip row has the step chip and the '#n · supervisor: feasible' line (a date, never a name)", async () => {
    renderScreen();
    const c = await waitFor(card);
    expect(within(c).getByText("Display check")).toBeTruthy();
    expect(within(c).getByText("#1 · supervisor: feasible Mon 12 Oct")).toBeTruthy();
  });

  it("the evidence sits under its own h2 'Why Bee6 suggests this' with the count line and the metric", async () => {
    renderScreen();
    const c = await waitFor(card);
    expect(within(c).getByRole("heading", { level: 2, name: "Why Bee6 suggests this" })).toBeTruthy();
    expect(within(c).getAllByRole("listitem")).toHaveLength(2);
    expect(within(c).getByText("THE EVIDENCE · 2 MOMENTS ON 2 DAYS")).toBeTruthy();
    expect(within(c).getByText("WATCH THIS METRIC")).toBeTruthy();
  });

  it("the pace box says approving creates a version, and that the other can only be rejected while another is waiting", async () => {
    renderScreen();
    const c = await waitFor(card);
    expect(within(c).getByText(/Approving creates a new SOP version\./).textContent).toContain("the other can only be rejected");
    cleanup();
    proposalsResult = ok([item(1, "awaiting_owner")]);
    renderScreen();
    const alone = await waitFor(card);
    expect(within(alone).getByText(/Approving creates a new SOP version\./).textContent).not.toContain("only be rejected");
  });

  it("the SOP-changed proposal shows the amber 'Not available' pace box and the same line in the decision card", async () => {
    proposalsResult = ok([item(2, "awaiting_owner", { notices: { sop_changed: true } })], [item(1, "approved", { owner: APPROVED })]);
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 2" });
    const lead = screen.getByText("Not available: the SOP changed");
    expect(lead.parentElement!.parentElement!.className).toContain("paceBlocked");
    expect(screen.getByText(/can only be rejected\. A rejection reason becomes a rule Bee6 respects\./)).toBeTruthy();
    expect(screen.getByText("The SOP changed after this was drafted. You can still reject it with a reason.")).toBeTruthy();
  });

  it("the decision card is an h2 'Your decision' (sentence case); the reject field is required, with a placeholder, and the label text is plain", async () => {
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    expect(screen.getByRole("heading", { level: 2, name: "Your decision" })).toBeTruthy();
    const box = screen.getByLabelText("Reject — why?") as HTMLTextAreaElement;
    expect(box.required).toBe(true);
    expect(box.placeholder).toBe("Why is this not workable?");
    // approve is the large primary button, reject the destructive one
    expect(screen.getByRole("button", { name: "Approve" }).className).toContain("b6-btn--lg");
    expect(screen.getByRole("button", { name: "Reject with reason" }).className).toContain("b6-btn--destructive");
  });

  it("the recommended order sits after the decision card, the open row carries the dark 'Reviewing now' pill", async () => {
    renderScreen();
    await screen.findByRole("heading", { level: 1, name: "Proposal 1" });
    const decision = screen.getByRole("heading", { level: 2, name: "Your decision" });
    const order = screen.getByRole("list", { name: "RECOMMENDED ORDER" });
    expect(decision.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(order).getByText("Reviewing now").className).toContain("pillNow");
    expect(within(order).getByText("Waiting for you").className).not.toContain("pillNow");
  });

  it("all decided: h1 'Both decided. Nice and calm.', a counts + dates sentence, '#n' rows with their pills, Back to home first", async () => {
    proposalsResult = ok([], [item(1, "approved", { owner: APPROVED }), item(2, "rejected", { owner: REJECTED })]);
    sopResult = { kind: "ok", data: SOP_WITH_V2 };
    renderScreen();
    expect(await screen.findByRole("heading", { level: 1, name: "Both decided. Nice and calm." })).toBeTruthy();
    expect(screen.getByText("APPROVALS · DONE")).toBeTruthy();
    expect(await screen.findByText("1 approved, 1 rejected. The approved change starts on Wed 14 Oct and is reviewed on Wed 28 Oct.")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Both decided. Nice and calm." })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("#1");
    expect(within(rows[0]!).getByText("Approved · starts Wed 14 Oct")).toBeTruthy();
    expect(rows[1]!.textContent).toContain("#2");
    expect(within(rows[1]!).getByText("Rejected · now a rule")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /^(Back to home|See the SOP)$/ });
    expect(links.map((l) => l.textContent)).toEqual(["Back to home", "See the SOP"]);
    expect(links[0]!.className).toContain("b6-btn--primary");
    expect(links[1]!.className).toContain("b6-btn--secondary");
  });

  it("all decided before the SOP version is known: the counts sentence only, the pill is plain 'Approved'", async () => {
    proposalsResult = ok([], [item(1, "approved", { owner: APPROVED }), item(2, "rejected", { owner: REJECTED })]);
    renderScreen();
    expect(await screen.findByText("1 approved, 1 rejected.")).toBeTruthy();
    expect(screen.queryByText(/The approved change starts on/)).toBeNull();
    expect(screen.getByText("Approved")).toBeTruthy();
  });
});

describe("ApprovalsReview — Bahasa", () => {
  it("renders the provisional Bahasa copy", async () => {
    render(<ApprovalsReview auth={AUTH} lang="id" />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Proposal 1");
    expect(screen.getByText("PERSETUJUAN · 1 DARI 2 · SISA 2")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Keputusan Anda" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Setujui" })).toBeTruthy();
    expect(screen.getByLabelText("Tolak — mengapa?")).toBeTruthy();
  });
});
