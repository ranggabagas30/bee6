// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { GenerateResponse } from "@/lib/proposals/contract";
import { ProposalsApp } from "@/app/proposals/ProposalsApp";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
const ROUTER = { replace };
vi.mock("next/navigation", () => ({
  useRouter: () => ROUTER,
}));

const getClientAuth = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...args: unknown[]) => getClientAuth(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({
  useAuthUser: () => authUserState,
}));

const authedPostJson = vi.fn();
// Two panels read on mount and are routed here by path. `ConstraintsPanel`
// (R-08 Task 8.7) defaults to "error" so it renders its generic-error line and
// stays out of the way of the Generate-panel tests; `ProposalList` (R-09 Task
// 8.1) defaults to an empty list.
let constraintsResult: unknown = { kind: "error" };
let proposalsResult: unknown = { kind: "ok", data: { open: [], decided: [] } };
const authedGetJson = vi.fn(async (...args: unknown[]) =>
  args[1] === "/api/v1/proposals" ? proposalsResult : constraintsResult,
);
vi.mock("@/lib/auth/client/api", () => ({
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" };
const getIdTokenResult = vi.fn();
const FAKE_USER = { uid: "u1", getIdTokenResult };

function mockContent(overrides: Partial<NonNullable<GenerateResponse["proposal"]["content"]>> = {}) {
  return {
    intervention: { id: "add_script", label_en: "Add script", label_id: "Tambah skrip" },
    rubric: [{ id: "observable", label_en: "Observable", label_id: "Teramati" }],
    target_step: null,
    change_title: "Add a greeting script",
    change_text: "Staff say a fixed line when a customer walks in.",
    rationale: "Customers were not greeted on three separate dates.",
    metric: {
      category: "CUSTOMER_SERVICE" as const,
      direction: "decrease" as const,
      description: "Count of unmet-greeting facts per day.",
      baseline_count: 3,
      baseline_days: 3,
    },
    failure_condition: "No change if the count does not drop within the review window.",
    review_date: "2026-11-01",
    evidence: [
      { date: "2026-10-01", start_hm: "09:00", category: "CUSTOMER_SERVICE" as const, summary: "A customer was not greeted." },
      { date: "2026-10-03", start_hm: "10:00", category: "CUSTOMER_SERVICE" as const, summary: "A customer was not greeted." },
    ],
    censored_floor: true as const,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<GenerateResponse> = {}): GenerateResponse {
  return {
    reused: false,
    proposal: {
      proposal_id: "11111111-1111-1111-1111-111111111111",
      status: "awaiting_supervisor",
      created_at_ms: 1,
      range: { from_date: "2026-10-01", to_date: "2026-10-07" },
      suppression: null,
      blocked_rule: null,
      content: mockContent(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  constraintsResult = { kind: "error" };
  proposalsResult = { kind: "ok", data: { open: [], decided: [] } };
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
  getIdTokenResult.mockResolvedValue({ claims: { role: "supervisor" } });
  // Only `Date` is faked — `setTimeout`/`MutationObserver` stay real so
  // Testing Library's `waitFor`/`findBy*` polling (used throughout this
  // file) is not itself frozen by the same mock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderApp() {
  return render(
    <LangProvider initial="en">
      <ProposalsApp config={CONFIG} />
    </LangProvider>,
  );
}

async function renderReady() {
  renderApp();
  await waitFor(() => expect(screen.getByRole("button", { name: "Generate proposal" })).not.toBeNull());
}

describe("ProposalsApp — auth / role gate", () => {
  it("signed_out replaces to /sign-in", async () => {
    authUserState = { status: "signed_out" };
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("no config shows the sign-in-not-configured message, not a crash", () => {
    render(
      <LangProvider initial="en">
        <ProposalsApp config={null} />
      </LangProvider>,
    );
    expect(screen.getByText("Sign-in is not set up on this server.")).not.toBeNull();
  });

  it("owner claims: the form and button render, plus the owner note", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
    await renderReady();
    expect(screen.getByText("New proposals go to a supervisor first. You approve them after the supervisor marks them feasible.")).not.toBeNull();
  });

  it("supervisor claims: the form renders, no owner note", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "supervisor" } });
    await renderReady();
    expect(
      screen.queryByText("New proposals go to a supervisor first. You approve them after the supervisor marks them feasible."),
    ).toBeNull();
  });

  it("a staff-role token shows the forbidden message and no form", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "staff" } });
    renderApp();
    await waitFor(() =>
      expect(screen.getByText("Only the owner or a supervisor can generate proposals.")).not.toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Generate proposal" })).toBeNull();
    expect(screen.queryByLabelText("From")).toBeNull();
  });

  it("a claims read failure fails closed to the forbidden message", async () => {
    getIdTokenResult.mockRejectedValue(new Error("boom"));
    renderApp();
    await waitFor(() =>
      expect(screen.getByText("Only the owner or a supervisor can generate proposals.")).not.toBeNull(),
    );
  });
});

describe("ProposalsApp — default dates", () => {
  it("to = today, from = today - 6 (mocked system date)", async () => {
    await renderReady();
    const from = screen.getByLabelText("From") as HTMLInputElement;
    const to = screen.getByLabelText("To") as HTMLInputElement;
    expect(to.value).toBe("2026-10-10");
    expect(from.value).toBe("2026-10-04");
  });
});

describe("ProposalsApp — generate submit", () => {
  it("submit sends exactly { from_date, to_date } once; a double click while busy sends only one request", async () => {
    let resolveFn: (value: unknown) => void = () => {};
    authedPostJson.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFn = resolve; }),
    );
    await renderReady();

    const button = screen.getByRole("button", { name: "Generate proposal" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(
      FAKE_AUTH,
      "/api/v1/proposals/generate",
      { from_date: "2026-10-04", to_date: "2026-10-10" },
      expect.anything(),
    );

    resolveFn({ kind: "ok", data: makeResponse() });
    await waitFor(() => expect(screen.getByText("Add a greeting script")).not.toBeNull());
  });

  it("ok renders the ProposalCard for the returned proposal", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: makeResponse() });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(screen.getByText("Add a greeting script")).not.toBeNull());
  });

  it("reused: true shows the reused banner above the card", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: makeResponse({ reused: true }) });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() =>
      expect(screen.getByText("A proposal for these dates is already waiting for review.")).not.toBeNull(),
    );
  });

  it.each([
    ["GENERATION_IN_PROGRESS", "Another proposal is being generated. Try again in a minute."],
    ["LIBRARY_NOT_READY", "The intervention library is not set up yet."],
    ["NO_SOP", "No SOP is set up for this outlet yet."],
  ])("conflict %s shows its own message", async (code, message) => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(screen.getByText(message)).not.toBeNull());
  });

  it("an unknown conflict code falls back to the generic server message", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "SOMETHING_ELSE" });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
  });

  it("invalid (422) shows the range message", async () => {
    authedPostJson.mockResolvedValue({ kind: "invalid" });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() =>
      expect(
        screen.getByText("Check the dates: at most 14 days, not in the future, within the last 14 days."),
      ).not.toBeNull(),
    );
  });

  it("forbidden (403 from the server, defense in depth) shows the forbidden message, form still present", async () => {
    authedPostJson.mockResolvedValue({ kind: "forbidden" });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() =>
      expect(screen.getByText("Only the owner or a supervisor can generate proposals.")).not.toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Generate proposal" })).not.toBeNull();
  });

  it("error shows the generic message, and submitting again calls again", async () => {
    authedPostJson.mockResolvedValueOnce({ kind: "error" });
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());

    authedPostJson.mockResolvedValueOnce({ kind: "ok", data: makeResponse() });
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(authedPostJson).toHaveBeenCalledTimes(2));
  });

  it("a signed_out result (401 surviving the client's own retry) signs out and replaces to /sign-in", async () => {
    authedPostJson.mockResolvedValue({ kind: "signed_out" });
    signOut.mockResolvedValue(undefined);
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });
});

function listItem(status: "awaiting_supervisor" | "awaiting_owner") {
  const response = makeResponse();
  return {
    proposal: { ...response.proposal, status },
    review: { supervisor: null, owner: null },
    notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false },
  };
}

function getsTo(path: string): number {
  return authedGetJson.mock.calls.filter((call) => call[1] === path).length;
}

describe("ProposalsApp — proposals list and decisions (R-09 8.2)", () => {
  it("mounts the list between the generate result and the constraints panel", async () => {
    proposalsResult = { kind: "ok", data: { open: [listItem("awaiting_supervisor")], decided: [] } };
    constraintsResult = { kind: "ok", data: { constraints: [] } };
    await renderReady();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Open proposals" })).not.toBeNull());
    const open = screen.getByRole("heading", { name: "Open proposals" });
    const constraints = await screen.findByRole("heading", { name: "Constraints" });
    expect(open.compareDocumentPosition(constraints) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getsTo("/api/v1/proposals")).toBe(1);
  });

  it("a successful generate reloads the list", async () => {
    authedPostJson.mockResolvedValue({ kind: "ok", data: makeResponse() });
    await renderReady();
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
  });

  it("a failed generate does not reload the list", async () => {
    authedPostJson.mockResolvedValue({ kind: "error" });
    await renderReady();
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    await waitFor(() => expect(screen.getByText("Something went wrong. Try again.")).not.toBeNull());
    expect(getsTo("/api/v1/proposals")).toBe(1);
  });

  async function rejectFirstOpen() {
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "The oven only holds 2.5 kg" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  }

  it.each([
    ["supervisor", "awaiting_supervisor"],
    ["owner", "awaiting_owner"],
  ] as const)(
    "a %s rejection reloads the list and the constraints, shows the banner, and Use these dates fills the range without generating",
    async (role, status) => {
      getIdTokenResult.mockResolvedValue({ claims: { role } });
      proposalsResult = { kind: "ok", data: { open: [listItem(status)], decided: [] } };
      constraintsResult = { kind: "ok", data: { constraints: [] } };
      authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "rejected", status: "rejected" } });
      await renderReady();
      await waitFor(() => expect(getsTo("/api/v1/constraints")).toBe(1));

      await rejectFirstOpen();

      expect(
        await screen.findByText(
          "Rejected. The reason is now a constraint. Generate again for the same dates to get a revised proposal.",
        ),
      ).not.toBeNull();
      await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
      await waitFor(() => expect(getsTo("/api/v1/constraints")).toBe(2));

      fireEvent.click(screen.getByRole("button", { name: "Use these dates" }));
      expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-01");
      expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-10-07");
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Generate proposal" }));

      const generateCalls = authedPostJson.mock.calls.filter((call) => call[1] === "/api/v1/proposals/generate");
      expect(generateCalls).toHaveLength(0);
    },
  );

  it("a feasible decision reloads the list only (no constraints reload, no Use these dates)", async () => {
    proposalsResult = { kind: "ok", data: { open: [listItem("awaiting_supervisor")], decided: [] } };
    constraintsResult = { kind: "ok", data: { constraints: [] } };
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    await renderReady();
    await waitFor(() => expect(getsTo("/api/v1/constraints")).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("Marked feasible. Sent to the owner.")).not.toBeNull();
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
    expect(getsTo("/api/v1/constraints")).toBe(1);
    expect(screen.queryByRole("button", { name: "Use these dates" })).toBeNull();
  });

  it("a decision clears the generate result card so its old status line does not linger", async () => {
    proposalsResult = { kind: "ok", data: { open: [listItem("awaiting_supervisor")], decided: [] } };
    authedPostJson.mockImplementation(async (...args: unknown[]) =>
      args[1] === "/api/v1/proposals/generate"
        ? { kind: "ok", data: makeResponse() }
        : { kind: "ok", data: { result: "feasible", status: "awaiting_owner" } },
    );
    await renderReady();
    await waitFor(() => expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    // Generate card + the listed card both show the proposal.
    await waitFor(() => expect(screen.getAllByText("Add a greeting script")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("Marked feasible. Sent to the owner.")).not.toBeNull();
    await waitFor(() => expect(screen.getAllByText("Add a greeting script")).toHaveLength(1));
  });

  it("tapping Generate clears the decision banner and its Use these dates button", async () => {
    proposalsResult = { kind: "ok", data: { open: [listItem("awaiting_supervisor")], decided: [] } };
    authedPostJson.mockImplementation(async (...args: unknown[]) =>
      args[1] === "/api/v1/proposals/generate"
        ? { kind: "error" }
        : { kind: "ok", data: { result: "rejected", status: "rejected" } },
    );
    await renderReady();
    await rejectFirstOpen();
    const message =
      "Rejected. The reason is now a constraint. Generate again for the same dates to get a revised proposal.";
    expect(await screen.findByText(message)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate proposal" }));
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use these dates" })).toBeNull();
  });

  it("after a decision keyboard focus lands on the banner, not on the document body", async () => {
    proposalsResult = { kind: "ok", data: { open: [listItem("awaiting_supervisor")], decided: [] } };
    authedPostJson.mockResolvedValue({ kind: "ok", data: { result: "feasible", status: "awaiting_owner" } });
    await renderReady();
    await waitFor(() => expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const banner = await screen.findByText("Marked feasible. Sent to the owner.");
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
    expect(banner.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(banner);
  });

  it("a conflict answer shows its message in the banner and reloads the list", async () => {
    proposalsResult = { kind: "ok", data: { open: [listItem("awaiting_supervisor")], decided: [] } };
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "ALREADY_DECIDED" });
    await renderReady();
    await waitFor(() => expect(screen.getByRole("button", { name: "Feasible" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Feasible" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("This proposal was already decided. The list is updated.")).not.toBeNull();
    await waitFor(() => expect(getsTo("/api/v1/proposals")).toBe(2));
  });
});
