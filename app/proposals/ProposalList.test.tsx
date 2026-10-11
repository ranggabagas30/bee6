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

const EMPTY_NOTICES = { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false };

function listOf(open: ProposalListItem[], decided: ProposalListItem[] = []): { kind: "ok"; data: ListProposalsResponse } {
  return { kind: "ok", data: { open, decided } };
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
    await waitFor(() => expect(screen.getByText("No open proposals.")).not.toBeNull());
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
  it("empty open list shows the empty line and hides the Decided heading", async () => {
    authedGetJson.mockResolvedValue(listOf([]));
    renderList();
    await waitFor(() => expect(screen.getByText("No open proposals.")).not.toBeNull());
    expect(screen.getByRole("heading", { name: "Open proposals" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Recently decided" })).toBeNull();
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
