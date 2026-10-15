// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SupervisorProposals, type ProposalsBridgeEvent } from "@/app/proposals/SupervisorProposals";
import type { ListProposalsResponse, ProposalListItem, ProposalsWatch, WatchRow } from "@/lib/proposals/review-contract";
import type { ProposalView } from "@/lib/proposals/contract";

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

function renderScreen(onBridge?: (e: ProposalsBridgeEvent) => void) {
  return render(<SupervisorProposals auth={AUTH} lang="en" onBridge={onBridge} />);
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

  it("open proposals render as rows (status, title, step, why, moments) with an Open control; decided ones under their own heading", async () => {
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
    expect(within(openRow).getByText("Waiting for your check")).not.toBeNull();
    expect(within(openRow).getByText("Display check")).not.toBeNull();
    expect(within(openRow).getByText("Customers asked if the egg tarts were fresh.")).not.toBeNull();
    expect(within(openRow).getByText("2 moments · Tue 6 Oct, Wed 7 Oct")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Recently decided" })).not.toBeNull();
    expect(screen.getByText("Older idea")).not.toBeNull();
  });

  it("a failed load shows the generic message", async () => {
    proposalsResult = { kind: "error" };
    renderScreen();
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
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
    expect(screen.getByText("Asking Bee6…", { selector: "p" })).not.toBeNull();
    expect((screen.getByRole("button", { name: "Asking Bee6…" }) as HTMLButtonElement).disabled).toBe(true);

    proposalsResult = listOk({ open: [item(3, "awaiting_supervisor", "Write the bake time")], decided: [], watch: watchOf([row("CUSTOMER_SERVICE", 2, "proposed")]) });
    resolveFn({ kind: "ok", data: { proposal: view(3, "awaiting_supervisor", "Write the bake time"), reused: false } });
    await waitFor(() => expect(screen.getByText("Write the bake time")).not.toBeNull());
    expect(screen.getByText("Bee6 wrote a proposal. Open it to read the evidence.")).not.toBeNull();
    expect(screen.queryByText("Asking Bee6…", { selector: "p" })).toBeNull();
    expect(getsTo("/api/v1/proposals")).toBe(2);
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
    expect(screen.getByText("Asking Bee6…", { selector: "p" })).not.toBeNull();
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
    expect(screen.queryByText("Asking Bee6…", { selector: "p" })).toBeNull();
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
    expect(screen.queryByText("Asking Bee6…", { selector: "p" })).toBeNull();
    expect(screen.getByText("Bee6 is still working. Reload this page in a moment.")).not.toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "Open proposal: Write the bake time" }));
    await screen.findByRole("heading", { level: 1, name: "Write the bake time" });
    return bridge;
  }

  it("Open shows the detail; ‹ Proposals returns to the list", async () => {
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
    expect(document.activeElement).toBe(banner);
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
