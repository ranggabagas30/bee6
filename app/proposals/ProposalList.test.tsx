// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProposalList } from "@/app/proposals/ProposalList";
import type { ListProposalsResponse, ProposalListItem } from "@/lib/proposals/review-contract";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

const authedGetJson = vi.fn();
const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" } as unknown as import("@/lib/auth/client/firebase-client").Auth;
const onSettled = vi.fn();

function uuid(n: number): string {
  return `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function makeItem(
  n: number,
  status: ProposalListItem["proposal"]["status"],
  title: string,
  extra: Partial<ProposalListItem> = {},
): ProposalListItem {
  return {
    proposal: {
      proposal_id: uuid(n),
      status,
      created_at_ms: n,
      range: { from_date: "2026-10-01", to_date: "2026-10-07" },
      focus_category: "CUSTOMER_SERVICE",
      suppression: null,
      blocked_rule: null,
      content: {
        intervention: { id: "add_script", label_en: "Add script", label_id: "Tambah skrip" },
        rubric: [{ id: "observable", label_en: "Observable", label_id: "Teramati" }],
        target_step: null,
        change_title: title,
        change_text: "Staff say a fixed line.",
        rationale: "Not greeted.",
        metric: {
          category: "CUSTOMER_SERVICE",
          direction: "decrease",
          description: "Count per day.",
          baseline_count: 3,
          baseline_days: 3,
        },
        failure_condition: "No change.",
        review_date: "2026-11-01",
        evidence: [
          { date: "2026-10-01", start_hm: "09:00", category: "CUSTOMER_SERVICE", summary: "A customer was not greeted." },
          { date: "2026-10-03", start_hm: "10:00", category: "CUSTOMER_SERVICE", summary: "A customer was not greeted." },
        ],
        censored_floor: true,
      },
    },
    review: { supervisor: null, owner: null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false },
    ...extra,
  };
}

const EMPTY_WATCH = { from_date: "2026-10-01", to_date: "2026-10-07", categories: [] };
const EMPTY_NOTICES = { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false };

function listOf(open: ProposalListItem[], decided: ProposalListItem[] = []): { kind: "ok"; data: ListProposalsResponse } {
  return { kind: "ok", data: { open, decided, watch: EMPTY_WATCH } };
}

beforeEach(() => {
  authedGetJson.mockReset();
  authedPostJson.mockReset();
  onSettled.mockReset();
  replace.mockReset();
  signOut.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderList(role: "owner" | "supervisor" = "supervisor", reloadKey = 0, lang: "en" | "id" = "en") {
  return render(
    <ProposalList auth={FAKE_AUTH} role={role} lang={lang} reloadKey={reloadKey} onSettled={onSettled} />,
  );
}

describe("ProposalList — loading", () => {
  it("shows the loading line, then GETs /api/v1/proposals once on mount", async () => {
    authedGetJson.mockResolvedValue(listOf([]));
    renderList();
    expect(screen.getByText("Loading…")).not.toBeNull();
    await waitFor(() => expect(screen.getByText("No proposal yet")).not.toBeNull());
    expect(authedGetJson).toHaveBeenCalledTimes(1);
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/proposals", expect.anything());
  });

  it("reloads when reloadKey changes (two GETs) and keeps the old list on screen meanwhile", async () => {
    authedGetJson.mockResolvedValueOnce(listOf([makeItem(1, "awaiting_supervisor", "First change")]));
    const { rerender } = renderList("supervisor", 0);
    await waitFor(() => expect(screen.getByText("First change")).not.toBeNull());

    let resolveFn: (value: unknown) => void = () => {};
    authedGetJson.mockImplementationOnce(() => new Promise((resolve) => { resolveFn = resolve; }));
    rerender(<ProposalList auth={FAKE_AUTH} role="supervisor" lang="en" reloadKey={1} onSettled={onSettled} />);
    expect(authedGetJson).toHaveBeenCalledTimes(2);
    expect(screen.getByText("First change")).not.toBeNull();
    expect(screen.queryByText("Loading…")).toBeNull();

    resolveFn(listOf([makeItem(2, "awaiting_supervisor", "Second change")]));
    await waitFor(() => expect(screen.getByText("Second change")).not.toBeNull());
    expect(screen.queryByText("First change")).toBeNull();
  });

  it("a stale response never overwrites a newer one", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    authedGetJson.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = renderList("supervisor", 0);
    authedGetJson.mockResolvedValueOnce(listOf([makeItem(2, "awaiting_supervisor", "Newer")]));
    rerender(<ProposalList auth={FAKE_AUTH} role="supervisor" lang="en" reloadKey={1} onSettled={onSettled} />);
    await waitFor(() => expect(screen.getByText("Newer")).not.toBeNull());
    resolveOld(listOf([makeItem(1, "awaiting_supervisor", "Older")]));
    await Promise.resolve();
    expect(screen.queryByText("Older")).toBeNull();
    expect(screen.getByText("Newer")).not.toBeNull();
  });
});

describe("ProposalList — empty and error states", () => {
  it("nothing open and nothing decided shows the supervisor empty state (R-19 PR-6 §8.3) and hides the Decided heading", async () => {
    authedGetJson.mockResolvedValue(listOf([]));
    renderList();
    await waitFor(() => expect(screen.getByText("No proposal yet")).not.toBeNull());
    expect(screen.getByText("Bee6 needs the same problem on at least 2 days.")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Open proposals" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Recently decided" })).toBeNull();
    expect(screen.queryByText("No open proposals.")).toBeNull();
  });

  it("the owner's empty state is the Approvals copy", async () => {
    authedGetJson.mockResolvedValue(listOf([]));
    renderList("owner");
    await waitFor(() => expect(screen.getByText("Nothing waiting for you.")).not.toBeNull());
    expect(screen.getByText("Proposals appear here after the supervisor marks them feasible.")).not.toBeNull();
    expect(screen.queryByText("No proposal yet")).toBeNull();
  });

  it("nothing open but something decided keeps the plain 'No open proposals.' line and the Decided section", async () => {
    authedGetJson.mockResolvedValue(listOf([], [makeItem(2, "rejected", "Old change")]));
    renderList();
    await waitFor(() => expect(screen.getByText("No open proposals.")).not.toBeNull());
    expect(screen.getByRole("heading", { name: "Recently decided" })).not.toBeNull();
    expect(screen.queryByText("No proposal yet")).toBeNull();
  });

  it("a failed GET shows the generic message", async () => {
    authedGetJson.mockResolvedValue({ kind: "error" });
    renderList();
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
  });

  it("LIBRARY_NOT_READY shows the library message", async () => {
    authedGetJson.mockResolvedValue({ kind: "conflict", code: "LIBRARY_NOT_READY" });
    renderList();
    await waitFor(() => expect(screen.getByText("The intervention library is not set up yet.")).not.toBeNull());
  });

  it("another conflict code shows the generic message", async () => {
    authedGetJson.mockResolvedValue({ kind: "conflict", code: "WHATEVER" });
    renderList();
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
  });

  it("forbidden shows the generic message", async () => {
    authedGetJson.mockResolvedValue({ kind: "forbidden" });
    renderList();
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
  });

  it("signed_out signs out and replaces to /sign-in", async () => {
    authedGetJson.mockResolvedValue({ kind: "signed_out" });
    signOut.mockResolvedValue(undefined);
    renderList();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });
});

describe("ProposalList — populated", () => {
  it("renders open items with the decision panel and decided items without one", async () => {
    authedGetJson.mockResolvedValue(
      listOf(
        [makeItem(2, "awaiting_supervisor", "Open one")],
        [
          makeItem(1, "approved", "Done one", {
            review: {
              supervisor: { decision: "feasible", reason: null, decided_date: "2026-10-05" },
              owner: { decision: "approved", reason: null, decided_date: "2026-10-06" },
            },
          }),
        ],
      ),
    );
    renderList("supervisor");
    await waitFor(() => expect(screen.getByText("Open one")).not.toBeNull());

    const decidedHeading = screen.getByRole("heading", { name: "Recently decided" });
    expect(decidedHeading).not.toBeNull();
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(2);
    expect(within(articles[0]!).getByRole("button", { name: "Feasible" })).not.toBeNull();
    expect(within(articles[1]!).queryAllByRole("button")).toHaveLength(0);
    expect(within(articles[1]!).getByText("The owner approved this on Tue 6 Oct.")).not.toBeNull();
  });

  it("card titles are h3 under the h2 section headings", async () => {
    authedGetJson.mockResolvedValue(
      listOf([makeItem(2, "awaiting_supervisor", "Open one")], [makeItem(1, "approved", "Done one")]),
    );
    renderList("supervisor");
    await waitFor(() => expect(screen.getByText("Open one")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 3, name: "Open one" })).not.toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Done one" })).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
  });

  it("a supervisor sees panels only on awaiting_supervisor items", async () => {
    authedGetJson.mockResolvedValue(
      listOf([
        makeItem(3, "awaiting_supervisor", "Needs supervisor"),
        makeItem(2, "awaiting_owner", "Needs owner"),
      ]),
    );
    renderList("supervisor");
    await waitFor(() => expect(screen.getByText("Needs supervisor")).not.toBeNull());
    const [first, second] = screen.getAllByRole("article");
    expect(within(first!).getAllByRole("button")).toHaveLength(2);
    expect(within(second!).queryAllByRole("button")).toHaveLength(0);
    expect(within(second!).getByText("Waiting for owner approval")).not.toBeNull();
  });

  it("an owner sees Approve only on awaiting_owner items", async () => {
    authedGetJson.mockResolvedValue(
      listOf([
        makeItem(3, "awaiting_supervisor", "Needs supervisor"),
        makeItem(2, "awaiting_owner", "Needs owner"),
      ]),
    );
    renderList("owner");
    await waitFor(() => expect(screen.getByText("Needs owner")).not.toBeNull());
    const [first, second] = screen.getAllByRole("article");
    expect(within(first!).queryAllByRole("button")).toHaveLength(0);
    expect(within(second!).getByRole("button", { name: "Approve" })).not.toBeNull();
  });

  it("notices render on open items", async () => {
    authedGetJson.mockResolvedValue(
      listOf([
        makeItem(2, "awaiting_supervisor", "Stale one", {
          notices: { ...EMPTY_NOTICES, evidence_stale: true },
        }),
      ]),
    );
    renderList();
    await waitFor(() => expect(screen.getByText("Stale one")).not.toBeNull());
    expect(screen.getByText("Some of the evidence no longer holds. Generate again for these dates.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Feasible" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a decision settles through onSettled and the panel does not keep stale state across a reload", async () => {
    authedGetJson.mockResolvedValue(listOf([makeItem(2, "awaiting_supervisor", "Open one")]));
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    renderList("supervisor");
    await waitFor(() => expect(screen.getByText("Open one")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith({ messageKey: "C-prop-done-feasible" }));
  });

  it("each card section is labelled so a screen reader can jump between the lists", async () => {
    authedGetJson.mockResolvedValue(listOf([makeItem(2, "awaiting_supervisor", "Open one")]));
    renderList();
    await waitFor(() => expect(screen.getByText("Open one")).not.toBeNull());
    expect(screen.getByRole("region", { name: "Open proposals" })).not.toBeNull();
  });
});

describe("ProposalList — a panel recovers after an answer that leaves the proposal open", () => {
  const LATE = "11111111-1111-4111-8111-111111111111";

  async function settleThenReload(
    item: ProposalListItem,
    reloaded: ListProposalsResponse,
    act: () => void,
  ) {
    authedGetJson.mockResolvedValueOnce({ kind: "ok", data: { open: [item], decided: [], watch: EMPTY_WATCH } });
    const view = renderList("supervisor", 0);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject" })).not.toBeNull());
    act();
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    // The panel has settled: no action while the reload is pending.
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    authedGetJson.mockResolvedValueOnce({ kind: "ok", data: reloaded });
    view.rerender(
      <ProposalList auth={FAKE_AUTH} role="supervisor" lang="en" reloadKey={1} onSettled={onSettled} />,
    );
  }

  it("EVIDENCE_STALE conflict: the reloaded stale proposal gets Reject back and Feasible stays disabled", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "EVIDENCE_STALE" });
    const fresh = makeItem(2, "awaiting_supervisor", "Open one");
    const stale = makeItem(2, "awaiting_supervisor", "Open one", {
      notices: { ...EMPTY_NOTICES, evidence_stale: true },
    });
    await settleThenReload(fresh, { open: [stale], decided: [], watch: EMPTY_WATCH }, () => {
      fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    });
    const reject = await screen.findByRole("button", { name: "Reject" });
    expect((reject as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Feasible" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("CONSTRAINT_ADDED conflict: the reloaded proposal asks for the acknowledgement and Yes works again", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "CONSTRAINT_ADDED" });
    const fresh = makeItem(2, "awaiting_supervisor", "Open one");
    const withLate = makeItem(2, "awaiting_supervisor", "Open one", {
      notices: { ...EMPTY_NOTICES, late_constraints: [{ constraint_id: LATE, text: "No price talk" }] },
    });
    await settleThenReload(fresh, { open: [withLate], decided: [], watch: EMPTY_WATCH }, () => {
      fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    });
    const feasible = await screen.findByRole("button", { name: "Feasible" });
    fireEvent.click(feasible);
    const yes = screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("CONSTRAINT_LIMIT conflict on a rejection: Feasible and Reject come back after the reload", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "CONSTRAINT_LIMIT" });
    const item = makeItem(2, "awaiting_supervisor", "Open one");
    await settleThenReload(item, { open: [makeItem(2, "awaiting_supervisor", "Open one")], decided: [], watch: EMPTY_WATCH }, () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Does not fit our floor" } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    });
    expect(await screen.findByRole("button", { name: "Reject" })).not.toBeNull();
    expect((screen.getByRole("button", { name: "Feasible" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("an unchanged ok answer: the reloaded, still open proposal gets its buttons back", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "unchanged", status: "awaiting_supervisor" } });
    const item = makeItem(2, "awaiting_supervisor", "Open one");
    await settleThenReload(item, { open: [makeItem(2, "awaiting_supervisor", "Open one")], decided: [], watch: EMPTY_WATCH }, () => {
      fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    });
    expect(await screen.findByRole("button", { name: "Reject" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull();
  });

  it("an ok answer where the proposal leaves the open list: no panel remains", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    const item = makeItem(2, "awaiting_supervisor", "Open one");
    await settleThenReload(item, { open: [makeItem(2, "awaiting_owner", "Open one")], decided: [], watch: EMPTY_WATCH }, () => {
      fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    });
    await waitFor(() => expect(screen.getByText("Waiting for owner approval")).not.toBeNull());
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("a reload does not drop the reason text typed on another card", async () => {
    authedGetJson.mockResolvedValueOnce({
      kind: "ok",
      data: {
        open: [makeItem(3, "awaiting_supervisor", "Card A"), makeItem(2, "awaiting_supervisor", "Card B")],
        decided: [],
        watch: EMPTY_WATCH,
      },
    });
    const view = renderList("supervisor", 0);
    await waitFor(() => expect(screen.getByText("Card A")).not.toBeNull());
    const [, cardB] = screen.getAllByRole("article");
    fireEvent.click(within(cardB!).getByRole("button", { name: "Reject" }));
    fireEvent.change(within(cardB!).getByRole("textbox"), { target: { value: "Typing a reason" } });
    authedGetJson.mockResolvedValueOnce({
      kind: "ok",
      data: {
        open: [makeItem(3, "awaiting_supervisor", "Card A"), makeItem(2, "awaiting_supervisor", "Card B")],
        decided: [],
        watch: EMPTY_WATCH,
      },
    });
    view.rerender(
      <ProposalList auth={FAKE_AUTH} role="supervisor" lang="en" reloadKey={1} onSettled={onSettled} />,
    );
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    const [, cardB2] = screen.getAllByRole("article");
    expect((within(cardB2!).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Typing a reason");
  });
});
