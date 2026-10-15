// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { SopChangeView, SopOverview } from "@/lib/sop/contract";
import { SopApp } from "@/app/sop/SopApp";

const CONFIG: FirebaseWebConfig = {
  apiKey: "key-1",
  authDomain: "proj.firebaseapp.com",
  projectId: "proj",
  appId: "1:1:web:abc",
};

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const getClientAuth = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...args: unknown[]) => getClientAuth(...args),
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: () => authUserState }));

const authedGetJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" };
const getIdTokenResult = vi.fn();
const FAKE_USER = { uid: "u1", getIdTokenResult };

const step = (id: string, role: "staff" | "supervisor" | "owner" = "staff") => ({
  step_id: id,
  title: `Title ${id}`,
  text: `Text ${id}`,
  role,
});
const changeView = (version: number, overrides: Partial<SopChangeView> = {}): SopChangeView => ({
  version,
  previous_version: version - 1,
  effective_from_date: "2026-10-16",
  approved_date: "2026-10-15",
  kind: "modify",
  before: step("stock-01"),
  after: { ...step("stock-01"), text: `New text v${version}` },
  change_title: `Change title v${version}`,
  metric: { category: "CUSTOMER_SERVICE", direction: "decrease", description: "d", baseline_count: 3, baseline_days: 7 },
  failure_condition: "f",
  review_date: "2026-10-23",
  outcome: null,
  ...overrides,
});
const overview = (o: Partial<SopOverview> = {}): SopOverview => ({
  today: "2026-10-15",
  latest: { version: 1, effective_from_date: null, steps: [step("a-01"), step("b-01", "supervisor")] },
  in_force_version: 1,
  changes: [],
  ...o,
});

beforeEach(() => {
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
  getIdTokenResult.mockResolvedValue({ claims: { role: "owner" } });
  authedGetJson.mockResolvedValue({ kind: "ok", data: overview() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <LangProvider initial="en">
      <SopApp config={CONFIG} />
    </LangProvider>,
  );
}

describe("SopApp header", () => {
  it("5.T4 seed only shows 'Version 1'", async () => {
    renderApp();
    await screen.findByText("Version 1");
  });

  it("5.T4 v2 in force shows 'Version 2, in force since ...'", async () => {
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: overview({
        latest: { version: 2, effective_from_date: "2026-10-16", steps: [step("a-01")] },
        in_force_version: 2,
        changes: [changeView(2)],
      }),
    });
    renderApp();
    await screen.findByText("Version 2, in force since Fri 16 Oct");
  });

  it("5.T4 v2 pending shows when it starts and which version applies until then", async () => {
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: overview({
        latest: { version: 2, effective_from_date: "2026-10-16", steps: [step("a-01")] },
        in_force_version: 1,
        changes: [changeView(2)],
      }),
    });
    renderApp();
    await screen.findByText("Version 2 starts on Fri 16 Oct. Until then, version 1 applies.");
  });

  it("5.T4 no SOP shows the empty state (owner: with the upload-coming line) and no sections", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: overview({ latest: null, in_force_version: null }) });
    renderApp();
    await screen.findByText("No SOP yet.");
    expect(screen.getByText("Uploading an SOP is coming soon. The demo uses a ready-made SOP.")).not.toBeNull();
    expect(screen.queryByText("Changes")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Steps in version/ })).toBeNull();
    expect(document.querySelector("ol")).toBeNull(); // the nav is a <ul>; the steps list is the only <ol>
  });
});

describe("SopApp sections", () => {
  it("5.T5 changes render newest first, and the latest steps list shows each step with its role", async () => {
    authedGetJson.mockResolvedValue({
      kind: "ok",
      data: overview({
        latest: { version: 3, effective_from_date: "2026-10-18", steps: [step("a-01"), step("b-01", "supervisor")] },
        in_force_version: 2,
        changes: [changeView(3), changeView(2)],
      }),
    });
    renderApp();
    await screen.findByText("Change title v3");
    const titles = screen.getAllByText(/^Change title v/).map((n) => n.textContent);
    expect(titles).toEqual(["Change title v3", "Change title v2"]);
    expect(screen.getByRole("heading", { name: "Steps in version 3" })).not.toBeNull();
    const items = Array.from(document.querySelector("ol")!.querySelectorAll("li")); // the nav <ul> has its own items
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Title a-01");
    expect(items[0]!.textContent).toContain("Done by: Staff");
    expect(items[1]!.textContent).toContain("Done by: Supervisor");
  });

  it("5.T5 no changes shows the empty line", async () => {
    renderApp();
    await screen.findByText("No changes yet. The SOP changes only through approved proposals.");
  });
});

describe("SopApp states", () => {
  it("5.T6 a staff role sees the forbidden text and makes no request", async () => {
    getIdTokenResult.mockResolvedValue({ claims: { role: "staff" } });
    renderApp();
    await screen.findByText("Only the owner or a supervisor can see the SOP changes.");
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("5.T6 a claims read failure fails closed", async () => {
    getIdTokenResult.mockRejectedValue(new Error("boom"));
    renderApp();
    await screen.findByText("Only the owner or a supervisor can see the SOP changes.");
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("5.T6 a forbidden result shows the forbidden text", async () => {
    authedGetJson.mockResolvedValue({ kind: "forbidden" });
    renderApp();
    await screen.findByText("Only the owner or a supervisor can see the SOP changes.");
  });

  it("5.T6 signed_out signs out and redirects", async () => {
    authedGetJson.mockResolvedValue({ kind: "signed_out" });
    renderApp();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("5.T6 an error result shows the generic text", async () => {
    authedGetJson.mockResolvedValue({ kind: "error" });
    renderApp();
    await screen.findByText("Something went wrong. Try again.");
  });

  it("a signed-out user is sent to /sign-in without any request", async () => {
    authUserState = { status: "signed_out" };
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(authedGetJson).not.toHaveBeenCalled();
  });

  it("no config shows the sign-in-not-configured message", () => {
    render(
      <LangProvider initial="en">
        <SopApp config={null} />
      </LangProvider>,
    );
    expect(screen.getByText("Sign-in is not set up on this server.")).not.toBeNull();
  });

  it("5.T7 makes exactly one GET to /api/v1/sop on mount", async () => {
    renderApp();
    await screen.findByText("Version 1");
    expect(authedGetJson).toHaveBeenCalledTimes(1);
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/sop", expect.anything());
  });
});

describe("SopApp version switch (R-19 PR-9a §9.1)", () => {
  const v2 = (): SopOverview =>
    overview({
      latest: { version: 2, effective_from_date: "2026-10-16", steps: [step("a-01"), { ...step("stock-01"), text: "New text v2" }] },
      in_force_version: 2,
      changes: [changeView(2)],
    });

  it("lists versions by date, oldest first, with the newest marked current and selected", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: v2() });
    renderApp();
    const group = await screen.findByRole("group", { name: "SOP version" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["First version", "16/10/26 · current"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(screen.getByRole("heading", { name: "Steps in version 2" })).not.toBeNull();
    expect(screen.getByText("IMPROVED · NEW ON 16/10/26")).not.toBeNull();
    expect(document.querySelector("del")?.textContent).toBe("Text stock-01");
    // The steps list (the only <ol>) shows the new text; the Changes section below repeats it in its after block.
    expect(document.querySelector("ol")!.textContent).toContain("New text v2");
  });

  it("switching to the first version shows its steps with the old wording and no badge", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: v2() });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "First version" }));
    expect(screen.getByRole("heading", { name: "Steps in version 1" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "First version" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/NEW ON/)).toBeNull();
    expect(document.querySelector("del")).toBeNull();
    const items = Array.from(document.querySelector("ol")!.querySelectorAll("li"));
    expect(document.querySelector("ol")!.textContent).not.toContain("New text v2");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual(["Title a-01", "Title stock-01"]);
    expect(items[1]!.textContent).toContain("Text stock-01");
  });

  it("a seed-only SOP shows 'First version · current' as plain text, with no switch", async () => {
    renderApp();
    await screen.findByText("First version · current");
    expect(screen.queryByRole("group", { name: "SOP version" })).toBeNull();
    expect(screen.queryByText(/NEW ON/)).toBeNull();
  });

  it("shows the read-only footer and no Add SOP, Download or Open in Sheets control", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: v2() });
    renderApp();
    await screen.findByText("Read-only. Steps change only through an approved proposal.");
    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("link")].map((n) => n.textContent ?? "");
    expect(controls.some((c) => /Add SOP|Download|Open in Sheets/i.test(c))).toBe(false);
    expect(document.body.textContent).not.toMatch(/Add SOP page|Download|Open in Sheets/);
  });

  it("the empty state has no footer and no switch", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: overview({ latest: null, in_force_version: null }) });
    renderApp();
    await screen.findByText("No SOP yet.");
    expect(screen.queryByText("Read-only. Steps change only through an approved proposal.")).toBeNull();
    expect(screen.queryByText(/First version/)).toBeNull();
  });
});
