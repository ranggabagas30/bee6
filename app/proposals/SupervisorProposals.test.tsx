// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SupervisorProposals, type ProposalsBridgeEvent } from "@/app/proposals/SupervisorProposals";
import type { ListProposalsResponse, ProposalListItem, ProposalsWatch, WatchRow } from "@/lib/proposals/review-contract";
import type { ProposalView } from "@/lib/proposals/contract";
import type { AskEstimate } from "@/lib/proposals/v4/flag";
import { axeViolations } from "@/lib/testing/axe";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

let proposalsResult: unknown;
let constraintsResult: unknown = { kind: "ok", data: { constraints: [] } };
const authedGetJson = vi.fn(async (...args: unknown[]) => (args[1] === "/api/v1/proposals" ? proposalsResult : constraintsResult));
const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;

function uuid(n: number): string {
  return `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function row(category: WatchRow["category"], dates: number, state: WatchRow["state"]): WatchRow {
  return { category, facts: dates, dates, need_dates: 2, state };
}

function watchOf(categories: WatchRow[] = []): ProposalsWatch {
  return { from_date: "2026-10-05", to_date: "2026-10-11", categories };
}

function view(n: number, status: ProposalView["status"], title: string): ProposalView {
  return {
    proposal_id: uuid(n),
    status,
    created_at_ms: n,
    range: { from_date: "2026-10-05", to_date: "2026-10-11" },
    focus_category: "CUSTOMER_SERVICE",
    suppression: null,
    blocked_rule: null,
    content: {
      intervention: { id: "add_step_detail", label_en: "Add detail", label_id: "Tambah detail" },
      rubric: [{ id: "observable", label_en: "Observable", label_id: "Teramati" }],
      target_step: { step_id: "display-check", title: "Display check", text: "Check the display every hour." },
      change_title: title,
      change_text: "Check the display every hour and write the bake time.",
      rationale: "Customers asked if the egg tarts were fresh.",
      metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "Freshness questions per day", baseline_count: 2, baseline_days: 2 },
      failure_condition: "Questions keep coming.",
      review_date: "2026-10-21",
      evidence: [
        { date: "2026-10-06", start_hm: "10:40", category: "CUSTOMER_SERVICE", summary: "A customer asked if the egg tarts were fresh." },
        { date: "2026-10-07", start_hm: "10:30", category: "CUSTOMER_SERVICE", summary: "The same question again." },
      ],
      censored_floor: true,
    },
  };
}

function item(n: number, status: ProposalView["status"], title: string): ProposalListItem {
  return {
    proposal: view(n, status, title),
    review: { supervisor: null, owner: null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false },
  };
}

function suppressed(n: number): ProposalView {
  return {
    proposal_id: uuid(n),
    status: "suppressed",
    created_at_ms: n,
    range: { from_date: "2026-10-05", to_date: "2026-10-11" },
    focus_category: null,
    suppression: {
      reason: "insufficient_evidence",
      model_reason: null,
      followup: { categories: ["PHONE_CALL"], have_facts: 1, have_dates: 1, need_facts: 2, need_dates: 2 },
    },
    blocked_rule: null,
    content: null,
  };
}

function listOk(data: ListProposalsResponse) {
  return { kind: "ok", data };
}

function getsTo(path: string): number {
  return authedGetJson.mock.calls.filter((call) => call[1] === path).length;
}

function renderScreen(onBridge?: (e: ProposalsBridgeEvent) => void, askEstimate?: AskEstimate | null, demo?: boolean) {
  return render(<SupervisorProposals auth={AUTH} lang="en" onBridge={onBridge} askEstimate={askEstimate} demo={demo} />);
}

beforeEach(() => {
  authedGetJson.mockClear();
  authedPostJson.mockReset();
  replace.mockReset();
  signOut.mockReset();
  constraintsResult = { kind: "ok", data: { constraints: [] } };
  proposalsResult = listOk({ open: [], decided: [], watch: watchOf() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SupervisorProposals — list screen (D2-03, D2-03a, D2-03b)", () => {
  it("loads once, then shows the page head, the watch panel and (nothing seen, nothing proposed) the empty state", async () => {
    renderScreen();
    expect(screen.getByText("Loading…")).not.toBeNull();
    await waitFor(() => expect(screen.getByText("No proposal yet")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1, name: "Proposals" })).not.toBeNull();
    expect(screen.getByText("WHAT BEE6 IS WATCHING")).not.toBeNull();
    expect(screen.getByText("Bee6 needs the same problem on at least 2 days.")).not.toBeNull();
    expect(getsTo("/api/v1/proposals")).toBe(1);
  });

  it("watch rows but no proposal: no empty state, the rows and the plain 'No open proposals.' line", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 1, "needs_more")]) });
    renderScreen();
    await waitFor(() => expect(screen.getByText("Needs 1 more day")).not.toBeNull());
    expect(screen.queryByText("No proposal yet")).toBeNull();
    expect(screen.getByText("No open proposals.")).not.toBeNull();
  });

  it("open proposals render as rows (status, title, step, why, moments) with a Review control; decided ones under their own heading", async () => {
    proposalsResult = listOk({
      open: [item(2, "awaiting_supervisor", "Write the bake time")],
      decided: [item(1, "rejected", "Older idea")],
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]),
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText("Write the bake time")).not.toBeNull());
    // The row's visible h3 names it; the li carries no aria-label of its own (tech-lead PR-12a finding 6).
    const openRow = screen.getByRole("heading", { level: 3, name: "Write the bake time" }).closest("li")!;
    expect(openRow.getAttribute("aria-label")).toBeNull();
    expect(within(openRow).getByText("Waiting for you")).not.toBeNull();
    expect(within(openRow).getByText("Display check")).not.toBeNull();
    expect(within(openRow).getByText("Customers asked if the egg tarts were fresh.")).not.toBeNull();
    expect(within(openRow).getByText("2 moments · Tue 6 Oct, Wed 7 Oct")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Recently decided" })).not.toBeNull();
    expect(screen.getByText("Older idea")).not.toBeNull();
  });

  it("a row reads chip, then pill, then the title; Review is the dark button, and a decided row's is the quiet one", async () => {
    proposalsResult = listOk({
      open: [item(2, "awaiting_supervisor", "Write the bake time")],
      decided: [item(1, "rejected", "Older idea")],
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]),
    });
    renderScreen();
    await screen.findByText("Write the bake time");
    const openRow = screen.getByRole("heading", { level: 3, name: "Write the bake time" }).closest("li")!;
    const chip = within(openRow).getByText("Display check");
    const pill = within(openRow).getByText("Waiting for you");
    expect(chip.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const review = within(openRow).getByRole("button", { name: "Review proposal: Write the bake time" });
    expect(review.textContent).toBe("Review");
    expect(review.className).toContain("b6-btn--primary");
    const decidedRow = screen.getByRole("heading", { level: 3, name: "Older idea" }).closest("li")!;
    expect(within(decidedRow).getByRole("button", { name: "Review proposal: Older idea" }).className).toContain("b6-btn--secondary");
  });

  it("the constraints form stays, folded into a collapsed 'Rules for Bee6 (optional)' at the bottom (R8)", async () => {
    proposalsResult = listOk({ open: [item(2, "awaiting_supervisor", "Write the bake time")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]) });
    const { container } = renderScreen();
    await screen.findByText("Write the bake time");
    await screen.findByRole("heading", { name: "Constraints", hidden: true });
    const rules = container.querySelector("details")!;
    expect(rules).not.toBeNull();
    expect(rules.open).toBe(false);
    expect(rules.querySelector("summary")!.textContent).toBe("Rules for Bee6 (optional)");
    expect(rules.className).toContain("b6-card");
    expect(rules.querySelector("section")!.textContent).toContain("Constraints");
    // last block of the page, after the list
    expect(container.lastElementChild).toBe(rules);
    rules.open = true; // it opens on the summary tap; nothing else about the panel changes
    expect(within(rules).getByRole("button", { name: "Add constraint" })).not.toBeNull();
  });

  it("demo: the watch panel shows both problem rows 'Not seen yet'; the pilot does not", async () => {
    const first = renderScreen(undefined, undefined, true);
    await waitFor(() => expect(screen.getAllByText("Not seen yet")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Not enough evidence yet" })).not.toBeNull();
    first.unmount();
    renderScreen();
    await screen.findByText("WHAT BEE6 IS WATCHING");
    expect(screen.queryByText("Not seen yet")).toBeNull();
  });

  it("the one status line under the watch panel is a live region that is still there while it is empty", async () => {
    renderScreen();
    await screen.findByText("WHAT BEE6 IS WATCHING");
    const lines = screen.getAllByRole("status").filter((el) => el.tagName === "P");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe("");
    expect(lines[0]!.getAttribute("aria-live")).toBe("polite");
  });

  it("a failed load shows the generic message", async () => {
    proposalsResult = { kind: "error" };
    renderScreen();
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
  });

  // R-19 PR-5 round 4 (QA on the merged PR-12a): the loading and error states rendered only a status line, so
  // the page had no h1 there (axe page-has-heading-one). The page head is part of every state.
  it("the page h1 'Proposals' is there while loading and when the load fails", async () => {
    proposalsResult = { kind: "error" };
    renderScreen();
    expect(screen.getByText("Loading…")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Proposals" })).not.toBeNull();
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1, name: "Proposals" })).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("SupervisorProposals — ask (D2-03d)", () => {
  it("Ask sends the watch range (no `another`), shows Asking Bee6…, then reloads and says a proposal was written", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    let resolveFn: (v: unknown) => void = () => {};
    authedPostJson.mockImplementationOnce(() => new Promise((r) => { resolveFn = r; }));
    renderScreen();
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for a proposal" });
    fireEvent.click(ask);
    expect(authedPostJson).toHaveBeenCalledWith(AUTH, "/api/v1/proposals/generate", { from_date: "2026-10-05", to_date: "2026-10-11" }, expect.anything());
    expect(screen.getByText("Bee6 is writing a proposal", { selector: "p" })).not.toBeNull();
    expect((screen.getByRole("button", { name: "Asking Bee6…" }) as HTMLButtonElement).disabled).toBe(true);

    proposalsResult = listOk({ open: [item(3, "awaiting_supervisor", "Write the bake time")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]) });
    resolveFn({ kind: "ok", data: { proposal: view(3, "awaiting_supervisor", "Write the bake time"), reused: false } });
    await waitFor(() => expect(screen.getByText("Write the bake time")).not.toBeNull());
    expect(screen.getByText("Bee6 wrote a proposal. Open it to read the evidence.")).not.toBeNull();
    expect(screen.queryByText("Bee6 is writing a proposal", { selector: "p" })).toBeNull();
    expect(getsTo("/api/v1/proposals")).toBe(2);
  });

  // Integration QA D2 (CLS 0.18 at 360 px): the answer used to land in two frames, the written line plus the OLD list
  // first and the reloaded rows ~10 ms later, right after the line's focus had scrolled the constraints panel into
  // view. The asking state now holds until the reloaded list is on screen: rows, line and focus arrive in one frame.
  it("D2: Asking Bee6… holds until the reloaded list has landed; the row and the written line then appear together", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    renderScreen();
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for a proposal" });
    await waitFor(() => expect(getsTo("/api/v1/constraints")).toBe(1));
    // the reload after the ask is held back
    let releaseList: (v: unknown) => void = () => {};
    authedGetJson.mockImplementationOnce(() => new Promise((r) => { releaseList = r; }));
    authedPostJson.mockResolvedValue({ kind: "ok", data: { proposal: view(3, "awaiting_supervisor", "Write the bake time"), reused: false } });
    fireEvent.click(ask);
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
    // the POST has answered, the GET has not: still asking, no written line, no row
    expect(screen.getByText("Bee6 is writing a proposal", { selector: "p" })).not.toBeNull();
    expect(screen.queryByText("Bee6 wrote a proposal. Open it to read the evidence.")).toBeNull();
    expect(screen.queryByText("Write the bake time")).toBeNull();
    await act(async () => {
      releaseList(listOk({ open: [item(3, "awaiting_supervisor", "Write the bake time")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]) }));
    });
    expect(screen.getByText("Write the bake time")).not.toBeNull();
    expect(screen.getByText("Bee6 wrote a proposal. Open it to read the evidence.")).not.toBeNull();
    expect(screen.queryByText("Bee6 is writing a proposal", { selector: "p" })).toBeNull();
    // The line takes focus (and scrolls into view) one painted frame AFTER the rows landed: Chrome counts a scroll
    // that lands in the same frame as the rows as a layout shift of whatever the scroll uncovers.
    expect(document.activeElement).toBe(document.body);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Bee6 wrote a proposal. Open it to read the evidence."));
  });

  it("D2: while asking, the generating block grows until the constraints panel under it sits where it sat before the ask", async () => {
    proposalsResult = listOk({
      open: [item(2, "awaiting_supervisor", "Write the bake time")],
      decided: [],
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed"), row("PHONE_CALL", 2, "ready")]),
    });
    authedPostJson.mockImplementation(() => new Promise(() => {}));
    renderScreen();
    const ask = await screen.findByRole("button", { name: "Ask for another proposal" });
    // The panel the hold measures is loaded by its own GET and is not in the DOM until that lands (ConstraintsPanel
    // renders nothing while loading). Under CPU load React commits the two loads in separate tasks, so the Ask
    // button can be on screen before the panel is: wait for the panel itself, not only the button.
    await screen.findByRole("heading", { name: "Constraints" });
    // jsdom has no layout: the panel reads 900 px from the top at the ask, 700 px once the asking block (250 px
    // tall) stands in for the list, so the block must grow by 200 px.
    let panelReads = 0;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const isPanel = this.tagName === "DETAILS" && (this.textContent ?? "").includes("Constraints");
      const top = isPanel ? (panelReads++ === 0 ? 900 : 700) : 400;
      const height = this.querySelector("[role='status']") ? 250 : 351;
      return { top, height, bottom: top + height, left: 0, right: 360, width: 360, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    try {
      fireEvent.click(ask);
    } finally {
      rect.mockRestore();
    }
    const block = screen.getByText("Bee6 is writing a proposal", { selector: "p" }).closest("[role='status']") as HTMLElement;
    expect(block.style.minHeight).toBe("450px");
  });

  it("D2: while asking, the cleared status line keeps one line of height, so the rows do not move down when the answer fills it", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockImplementation(() => new Promise(() => {}));
    renderScreen();
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for a proposal" });
    const line = () => screen.getAllByRole("status").find((el) => el.tagName === "P" && el.getAttribute("tabindex") === "-1") as HTMLElement;
    expect(line().className).not.toContain("statusHold");
    fireEvent.click(ask);
    expect(line().textContent).toBe("");
    expect(line().className).toContain("statusHold");
  });

  it("once a proposal exists, Ask for another sends another: true; a suppressed answer reads 'No other problem is ready yet.'", async () => {
    proposalsResult = listOk({
      open: [item(2, "awaiting_supervisor", "Write the bake time")],
      decided: [],
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed"), row("PHONE_CALL", 2, "ready")]),
    });
    authedPostJson.mockResolvedValue({ kind: "ok", data: { proposal: suppressed(9), reused: false } });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for another proposal" }));
    expect(authedPostJson.mock.calls[0]![2]).toEqual({ from_date: "2026-10-05", to_date: "2026-10-11", another: true });
    expect(await screen.findByText("No other problem is ready yet.")).not.toBeNull();
    expect(screen.queryByText(/Not enough evidence yet:/)).toBeNull();
  });

  it("a first ask that is suppressed shows the evidence-count line", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockResolvedValue({ kind: "ok", data: { proposal: suppressed(9), reused: false } });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for a proposal" }));
    expect(await screen.findByText(/Not enough evidence yet: 1 fact\(s\) on 1 day\(s\)/)).not.toBeNull();
  });

  it.each([
    ["LIBRARY_NOT_READY", "The intervention library is not set up yet."],
    ["NO_SOP", "No SOP is set up for this outlet yet."],
  ])("conflict %s ends the asking state with its message", async (code, copy) => {
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockResolvedValue({ kind: "conflict", code });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for a proposal" }));
    expect(await screen.findByText(copy)).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ask Bee6 for a proposal" })).not.toBeNull();
  });

  it("409 GENERATION_IN_PROGRESS keeps the asking state, re-reads the list every 5 s and ends when a new proposal appears", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "GENERATION_IN_PROGRESS" });
    renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Bee6 for a proposal" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Bee6 is writing a proposal", { selector: "p" })).not.toBeNull();
    expect(getsTo("/api/v1/proposals")).toBe(1);

    proposalsResult = listOk({ open: [item(3, "awaiting_supervisor", "Written elsewhere")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]) });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(getsTo("/api/v1/proposals")).toBe(2);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Written elsewhere")).not.toBeNull();
    expect(screen.queryByText("Bee6 is writing a proposal", { selector: "p" })).toBeNull();
  });

  it("409 GENERATION_IN_PROGRESS gives up after two model timeouts with the still-working line", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "GENERATION_IN_PROGRESS" });
    renderScreen();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Bee6 for a proposal" }));
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });
    expect(screen.queryByText("Bee6 is writing a proposal", { selector: "p" })).toBeNull();
    expect(screen.getByText("Bee6 is still working. Reload this page in a moment.")).not.toBeNull();
  });
});

// Demo feedback 2 item 18: on a demo sandbox, one tap chains the generate route, one round per ready problem (at most 3).
describe("SupervisorProposals — one tap asks for every proposal the evidence allows (item 18, demo sandbox only)", () => {
  const TWO_READY = () => watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready")]);
  const written = (n: number) => ({ kind: "ok", data: { proposal: view(n, "awaiting_supervisor", `Title ${n}`), reused: false } });
  const BODY = { from_date: "2026-10-05", to_date: "2026-10-11" };
  const PARTIAL = "Bee6 wrote 1 of 2 proposals, but the rest could not be written right now. Tap Ask for another proposal to try again.";

  /** After round 1 wrote and the list is reloaded: one proposal, one problem still ready. */
  const afterOneWritten = () =>
    listOk({ open: [item(3, "awaiting_supervisor", "Title 3")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed"), row("PHONE_CALL", 2, "ready")]) });

  it("two ready rows: two POSTs (round 1 without `another`, round 2 with it), ONE reload, ONE status line, ONE progress event", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce(written(4));
    const bridge = vi.fn();
    renderScreen(bridge, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = listOk({
      open: [item(3, "awaiting_supervisor", "Title 3"), item(4, "awaiting_supervisor", "Title 4")],
      decided: [],
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed"), row("PHONE_CALL", 2, "proposed")]),
    });
    fireEvent.click(ask);
    await waitFor(() => expect(screen.getByText("Title 4")).not.toBeNull());
    expect(authedPostJson).toHaveBeenCalledTimes(2);
    expect(authedPostJson.mock.calls[0]![2]).toEqual(BODY);
    expect(authedPostJson.mock.calls[1]![2]).toEqual({ ...BODY, another: true });
    expect(getsTo("/api/v1/proposals")).toBe(2);
    expect(screen.getByText("Bee6 wrote 2 proposals. Open each to read the evidence.")).not.toBeNull();
    expect(bridge.mock.calls.filter((c) => (c[0] as ProposalsBridgeEvent).type === "progress")).toHaveLength(1);
  });

  it("with a proposal already there, round 1 already sends `another: true`", async () => {
    proposalsResult = listOk({ open: [item(2, "awaiting_supervisor", "Title 2")], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValue(written(3));
    renderScreen(undefined, null, true);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for proposals" }));
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(2));
    expect(authedPostJson.mock.calls.map((c) => c[2])).toEqual([{ ...BODY, another: true }, { ...BODY, another: true }]);
  });

  it("one ready row: one POST and today's single-proposal line", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockResolvedValue(written(3));
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for a proposal" });
    proposalsResult = listOk({ open: [item(3, "awaiting_supervisor", "Title 3")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]) });
    fireEvent.click(ask);
    expect(await screen.findByText("Bee6 wrote a proposal. Open it to read the evidence.")).not.toBeNull();
    expect(authedPostJson).toHaveBeenCalledTimes(1);
  });

  it("PILOT unchanged: two ready rows, one POST, the singular label and line", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValue(written(3));
    renderScreen();
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for a proposal" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    expect(await screen.findByText("Bee6 wrote a proposal. Open it to read the evidence.")).not.toBeNull();
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Writing proposal/)).toBeNull();
  });

  it("stops when round 2 is not a new proposal (suppressed): the partial line, the list reloaded, the round-1 row visible, no retry", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce({ kind: "ok", data: { proposal: suppressed(9), reused: false } });
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    expect(await screen.findByText(PARTIAL)).not.toBeNull();
    expect(screen.getByText("Title 3")).not.toBeNull();
    expect(getsTo("/api/v1/proposals")).toBe(2);
    // the retry control is the existing one; nothing retries by itself (each round is a paid call)
    expect(screen.getByRole("button", { name: "Ask for another proposal" })).not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(authedPostJson).toHaveBeenCalledTimes(2);
  });

  it("round 2 blocked by a rule also ends as a partial chain", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    const blocked = { ...suppressed(9), status: "blocked" as const, suppression: null, blocked_rule: "R3" };
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce({ kind: "ok", data: { proposal: blocked, reused: false } });
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    expect(await screen.findByText(PARTIAL)).not.toBeNull();
  });

  it("round 2 network error: the partial line, and the round-1 row is on the list", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce({ kind: "error" });
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    expect(await screen.findByText(PARTIAL)).not.toBeNull();
    expect(screen.getByText("Title 3")).not.toBeNull();
    expect(authedPostJson).toHaveBeenCalledTimes(2);
  });

  it("a 409 GENERATION_IN_PROGRESS on round 2 ends the chain like any failure (no waiting poll)", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce({ kind: "conflict", code: "GENERATION_IN_PROGRESS" });
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    expect(await screen.findByText(PARTIAL)).not.toBeNull();
    expect(screen.queryByText("Bee6 is writing a proposal", { selector: "p" })).toBeNull();
  });

  it("a 409 GENERATION_IN_PROGRESS on round 1 keeps today's waiting path and makes no second call", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "GENERATION_IN_PROGRESS" });
    renderScreen(undefined, null, true);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for proposals" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Asking Bee6…" })).not.toBeNull());
    expect(screen.getByText("Bee6 is writing a proposal", { selector: "p" })).not.toBeNull();
    expect(authedPostJson).toHaveBeenCalledTimes(1);
  });

  it("signed out on round 2 still signs out and goes to sign-in", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce({ kind: "signed_out" });
    renderScreen(undefined, null, true);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for proposals" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("a demo cap refusing round 2 says so: n of total written, the limit was reached", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce({ kind: "error", code: "demo_generate_cap" });
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    expect(await screen.findByText("Bee6 wrote 1 of 2 proposals. The demo's proposal limit was reached, so it stopped there.")).not.toBeNull();
    expect(screen.getByText("Title 3")).not.toBeNull();
  });

  it("a demo cap refusing round 1 says so, writes nothing, reloads nothing", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValue({ kind: "error", code: "demo_model_cap" });
    renderScreen(undefined, null, true);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for proposals" }));
    expect(await screen.findByText("This demo has reached its proposal limit, so Bee6 can't write more proposals now.")).not.toBeNull();
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(getsTo("/api/v1/proposals")).toBe(1);
  });

  it("a plain 5xx on round 1 stays the generic error line (not the cap line)", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValue({ kind: "error" });
    renderScreen(undefined, null, true);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for proposals" }));
    expect(await screen.findByText("Something went wrong. Try again.")).not.toBeNull();
  });

  it("MAX_ASK_ROUNDS: four ready rows make three POSTs", async () => {
    proposalsResult = listOk({
      open: [],
      decided: [],
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready"), row("PHONE_CALL", 2, "ready"), row("COMPLAINT", 2, "ready"), row("EVENT", 2, "ready")]),
    });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce(written(4)).mockResolvedValueOnce(written(5));
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = listOk({ open: [item(3, "awaiting_supervisor", "Title 3")], decided: [], watch: watchOf([row("EVENT", 2, "ready")]) });
    fireEvent.click(ask);
    expect(await screen.findByText("Bee6 wrote 3 proposals. Open each to read the evidence.")).not.toBeNull();
    expect(authedPostJson).toHaveBeenCalledTimes(3);
  });

  it("the generating block names the round: 'Writing proposal 1 of 2…', then '2 of 2…'; a one-round ask has no such line", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    const resolvers: ((v: unknown) => void)[] = [];
    authedPostJson.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    renderScreen(undefined, null, true);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for proposals" }));
    expect(screen.getByText("Writing proposal 1 of 2…")).not.toBeNull();
    await act(async () => {
      resolvers[0]!(written(3));
    });
    expect(screen.getByText("Writing proposal 2 of 2…")).not.toBeNull();
    expect(screen.queryByText("Writing proposal 1 of 2…")).toBeNull();
    cleanup();

    authedPostJson.mockReset();
    authedPostJson.mockImplementation(() => new Promise(() => {}));
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    renderScreen(undefined, null, true);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Bee6 for a proposal" }));
    expect(screen.queryByText(/Writing proposal/)).toBeNull();
  });

  it("a `reused` answer ends the chain and reads the reused line", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValue({ kind: "ok", data: { proposal: view(3, "awaiting_supervisor", "Title 3"), reused: true } });
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    await waitFor(() => expect(screen.getByText("Title 3")).not.toBeNull());
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(screen.getByText("A proposal for these dates is already waiting for review.")).not.toBeNull();
  });

  it("double tap: a second tap while the chain runs starts nothing (one chain only)", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    let resolveFirst: (v: unknown) => void = () => {};
    authedPostJson.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; })).mockResolvedValueOnce(written(4));
    renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    fireEvent.click(ask);
    fireEvent.click(ask);
    fireEvent.click(screen.getByRole("button", { name: "Asking Bee6…" }));
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst(written(3));
    });
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(2));
    // still locked during round 2 and after the chain no stray third call exists
    fireEvent.click(screen.getByRole("button", { name: "Asking Bee6…" }));
    expect(authedPostJson).toHaveBeenCalledTimes(2);
  });

  it("has no axe violations after a partial chain (the partial line, the reloaded list, the retry control)", async () => {
    proposalsResult = listOk({ open: [], decided: [], watch: TWO_READY() });
    authedPostJson.mockResolvedValueOnce(written(3)).mockResolvedValueOnce({ kind: "error" });
    const { container } = renderScreen(undefined, null, true);
    const ask = await screen.findByRole("button", { name: "Ask Bee6 for proposals" });
    proposalsResult = afterOneWritten();
    fireEvent.click(ask);
    await screen.findByText(PARTIAL);
    expect(await axeViolations(container)).toEqual([]);
  });
});

// R-24 D11 (plan 3.11): the estimated wait belongs to THIS tab's own Ask only; a 409 never shows it.
describe("SupervisorProposals — estimated wait while asking (R-24 D11)", () => {
  const ESTIMATE: AskEstimate = { min_s: 10, max_s: 30 };
  const FAKE: { toFake: ("setTimeout" | "clearTimeout" | "setInterval" | "clearInterval")[] } = {
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  };

  async function clickAsk() {
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Bee6 for a proposal" }));
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("calling with an estimate: the range, not 'up to a minute'; the overrun line after max_s", async () => {
    vi.useFakeTimers(FAKE);
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockImplementationOnce(() => new Promise(() => {}));
    renderScreen(undefined, ESTIMATE);
    await clickAsk();
    const block = screen.getByText("Bee6 is writing a proposal", { selector: "p" }).closest("[role='status']") as HTMLElement;
    expect(block.textContent).toContain("Usually 10–30 seconds");
    expect(block.textContent).not.toContain("up to a minute");
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(block.textContent).toContain("Taking longer than usual. Bee6 is still working. Keep this page open.");
  });

  it("calling without an estimate (flag off): today's body line, never the range", async () => {
    vi.useFakeTimers(FAKE);
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockImplementationOnce(() => new Promise(() => {}));
    renderScreen(undefined, null);
    await clickAsk();
    const block = screen.getByText("Bee6 is writing a proposal", { selector: "p" }).closest("[role='status']") as HTMLElement;
    expect(block.textContent).toContain("This can take up to a minute. Please keep this page open.");
    expect(block.textContent).not.toContain("Usually");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(block.textContent).not.toContain("Taking longer than usual");
  });

  it("409 waiting with an estimate: the plain body, no range, and no overrun line however long it waits", async () => {
    vi.useFakeTimers(FAKE);
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "ready")]) });
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "GENERATION_IN_PROGRESS" });
    renderScreen(undefined, ESTIMATE);
    await clickAsk();
    const block = screen.getByText("Bee6 is writing a proposal", { selector: "p" }).closest("[role='status']") as HTMLElement;
    expect(block.textContent).toContain("This can take up to a minute. Please keep this page open.");
    expect(block.textContent).not.toContain("Usually");
    await act(async () => {
      vi.advanceTimersByTime(40_000);
    });
    expect(block.textContent).toContain("This can take up to a minute.");
    expect(block.textContent).not.toContain("Taking longer than usual");
  });
});

describe("SupervisorProposals — detail, feasible, reject", () => {
  async function openFirst() {
    proposalsResult = listOk({
      open: [item(2, "awaiting_supervisor", "Write the bake time")],
      decided: [],
      watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]),
    });
    const bridge = vi.fn();
    renderScreen(bridge);
    fireEvent.click(await screen.findByRole("button", { name: "Review proposal: Write the bake time" }));
    await screen.findByRole("heading", { level: 1, name: "Write the bake time" });
    return bridge;
  }

  it("Review shows the detail; ‹ Proposals returns to the list", async () => {
    await openFirst();
    expect(screen.queryByText("WHAT BEE6 IS WATCHING")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "‹ Proposals" }));
    expect(await screen.findByText("WHAT BEE6 IS WATCHING")).not.toBeNull();
  });

  it("Mark feasible shows the hand-over and reloads the list; the bridge hears the screens and the progress change", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    const bridge = await openFirst();
    proposalsResult = listOk({ open: [item(2, "awaiting_owner", "Write the bake time")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]) });
    fireEvent.click(screen.getByRole("button", { name: "Mark feasible" }));
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("Marked feasible.");
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
    expect(screen.getByText("Waiting for owner approval")).not.toBeNull();
    const events = bridge.mock.calls.map((c) => c[0]);
    expect(events).toContainEqual({ type: "screen", screen: "list" });
    expect(events).toContainEqual({ type: "screen", screen: "detail" });
    expect(events).toContainEqual({ type: "screen", screen: "feasible" });
    expect(events).toContainEqual({ type: "progress" });
  });

  it("a rejection returns to the list with the rule line and reloads the list and the constraints", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
    await openFirst();
    await waitFor(() => expect(getsTo("/api/v1/constraints")).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Reject… (reason required)" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "The oven only holds two trays." } });
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    const banner = await screen.findByText("Rejected. Your reason is now a rule Bee6 will respect.");
    await waitFor(() => expect(document.activeElement).toBe(banner)); // one painted frame later (D2)
    expect(screen.getByText("WHAT BEE6 IS WATCHING")).not.toBeNull();
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
    await waitFor(() => expect(getsTo("/api/v1/constraints")).toBe(2));
  });

  it("a 409 on the decision returns to the list with its message", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "ALREADY_DECIDED" });
    await openFirst();
    fireEvent.click(screen.getByRole("button", { name: "Mark feasible" }));
    expect(await screen.findByText("This proposal was already decided. The list is updated.")).not.toBeNull();
    expect(screen.getByText("WHAT BEE6 IS WATCHING")).not.toBeNull();
  });

  it("a reload that drops the opened proposal falls back to the list", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    await openFirst();
    proposalsResult = listOk({ open: [], decided: [], watch: watchOf() });
    fireEvent.click(screen.getByRole("button", { name: "Mark feasible" }));
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
    expect(await screen.findByText("WHAT BEE6 IS WATCHING")).not.toBeNull();
  });
});
