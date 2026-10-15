// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import { ProposalsApp } from "@/app/proposals/ProposalsApp";

/**
 * /proposals is one route with two screens by role (R-19 PR-12a supervisor, PR-12b owner). This suite covers the
 * role gate and that each role gets its own screen; the screens themselves have their own suites
 * (`SupervisorProposals.test.tsx`, `ApprovalsReview.test.tsx`).
 */

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
const ROUTER = { replace };
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ROUTER,
  useSearchParams: () => new URLSearchParams(search),
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
// Reads on mount, routed by path: the proposals list (both roles), the supervisor's constraints panel, and the
// owner's SOP overview (read only once an approved proposal is in the queue).
const EMPTY_WATCH = { from_date: "2026-10-01", to_date: "2026-10-07", categories: [] };
let constraintsResult: unknown = { kind: "error" };
let proposalsResult: unknown = { kind: "ok", data: { open: [], decided: [], watch: EMPTY_WATCH } };
const authedGetJson = vi.fn(async (...args: unknown[]) =>
  args[1] === "/api/v1/proposals" ? proposalsResult : constraintsResult,
);
vi.mock("@/lib/auth/client/api", () => ({
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
}));

const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
// A minimal awaiting_owner item for the owner's queue (the full card is covered by ApprovalsReview.test.tsx).
const waiting = (n: number) => ({
  proposal: {
    proposal_id: uuid(n),
    status: "awaiting_owner" as const,
    created_at_ms: n * 1000,
    range: { from_date: "2026-10-05", to_date: "2026-10-11" },
    focus_category: "CUSTOMER_SERVICE",
    suppression: null,
    blocked_rule: null,
    content: {
      intervention: { id: "add_step_detail", label_en: "Add detail", label_id: "Tambah detail" },
      rubric: [],
      target_step: null,
      change_title: `Proposal ${n}`,
      change_text: `New wording ${n}.`,
      rationale: `Why ${n}.`,
      metric: { category: "CUSTOMER_SERVICE", direction: "decrease" as const, description: `Metric ${n}`, baseline_count: 2, baseline_days: 2 },
      failure_condition: "No drop.",
      review_date: "2026-10-21",
      evidence: [],
      censored_floor: false,
    },
  },
  review: { supervisor: { decision: "feasible" as const, reason: null, decided_date: "2026-10-12" }, owner: null },
  notices: { late_constraints: [], evidence_stale: false, sop_changed: false, superseded: false },
});

const FAKE_AUTH = { kind: "fake-auth" };
const getIdTokenResult = vi.fn();
const FAKE_USER = { uid: "u1", getIdTokenResult };

beforeEach(() => {
  search = "";
  constraintsResult = { kind: "error" };
  proposalsResult = { kind: "ok", data: { open: [], decided: [], watch: EMPTY_WATCH } };
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
  getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp(lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <ProposalsApp config={CONFIG} />
    </LangProvider>,
  );
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

  it("owner claims: the Approvals screen renders (W8), with no Generate form and no date inputs", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
    renderApp();
    await waitFor(() => expect(screen.getByText("Nothing waiting for you.")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Approvals");
    expect(screen.getByRole("link", { name: "‹ Back to home" }).getAttribute("href")).toBe("/home");
    expect(screen.queryByRole("button", { name: "Generate proposal" })).toBeNull();
    expect(screen.queryByLabelText("From")).toBeNull();
    expect(screen.queryByText("New proposals go to a supervisor first. You approve them after the supervisor marks them feasible.")).toBeNull();
  });

  it("owner: the page title matches the nav label (Approvals)", async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText("Nothing waiting for you.")).not.toBeNull());
    const nav = screen.getByRole("navigation");
    expect(nav.textContent).toContain("Approvals");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Approvals");
    expect(nav.textContent).not.toContain("Proposals");
  });

  it("owner: ?id= opens that proposal (the Home waiting-row link), a non-UUID id is ignored", async () => {
    proposalsResult = { kind: "ok", data: { open: [waiting(1), waiting(2)], decided: [], watch: EMPTY_WATCH } };
    search = `?id=${uuid(2)}`;
    renderApp();
    expect(await screen.findByRole("heading", { level: 2, name: "Proposal 2" })).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Proposal 1" })).toBeNull();
    cleanup();

    search = "?id=not-a-uuid";
    renderApp();
    expect(await screen.findByRole("heading", { level: 2, name: "Proposal 1" })).not.toBeNull();
  });

  it("supervisor claims: the supervisor screen renders (watch panel, no approvals head)", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "supervisor" } });
    renderApp();
    await waitFor(() => expect(screen.getByText("WHAT BEE6 IS WATCHING")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Proposals");
    expect(screen.queryByRole("link", { name: "‹ Back to home" })).toBeNull();
    expect(screen.getByRole("navigation")).not.toBeNull();
  });

  it("a staff-role token shows the forbidden message and neither screen", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "staff" } });
    renderApp();
    await waitFor(() =>
      expect(screen.getByText("Only the owner or a supervisor can generate proposals.")).not.toBeNull(),
    );
    expect(screen.queryByText("Nothing waiting for you.")).toBeNull();
    expect(screen.queryByText("WHAT BEE6 IS WATCHING")).toBeNull();
  });

  it("a claims read failure fails closed to the forbidden message", async () => {
    getIdTokenResult.mockRejectedValue(new Error("boom"));
    renderApp();
    await waitFor(() =>
      expect(screen.getByText("Only the owner or a supervisor can generate proposals.")).not.toBeNull(),
    );
  });

  it("owner, Bahasa: the Approvals head and nav read Persetujuan", async () => {
    renderApp("id");
    await waitFor(() => expect(screen.getByText("Tidak ada yang menunggu Anda.")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Persetujuan");
  });
});
