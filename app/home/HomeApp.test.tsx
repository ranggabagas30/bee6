// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { HomeResponse } from "@/lib/home/contract";
import { HomeApp } from "@/app/home/HomeApp";

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
  // PR-7's ResetDemoButton / ResetNotice read the already-initialised app.
  getExistingClientAuth: () => getClientAuth.mock.results[0]?.value ?? null,
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({
  useAuthUser: () => authUserState,
}));

const authedGetJson = vi.fn();
const authedPostJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
  authedPostJson: (...args: unknown[]) => authedPostJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" };
const PILOT_OWNER = { role: "owner", outlet_id: "o1" };
const DEMO_OWNER = { role: "owner", outlet_id: "sbx-0123456789ab", demo_exp_ms: 1_900_000_000_000 };
const userWith = (claims: Record<string, unknown>) => ({ uid: "u1", getIdTokenResult: () => Promise.resolve({ claims }) });
const FAKE_USER = userWith(PILOT_OWNER);

const zero = { approved: 0, rejected: 0 };
function makeData(overrides: Partial<HomeResponse> = {}): HomeResponse {
  return {
    today: "2026-10-09",
    day_status: "on",
    fact_count: 0,
    lines: [],
    more: 0,
    progress: { week: zero, month: zero, since_start: zero },
    waiting_approval: { count: 0, items: [] },
    next_review: { date: null, change_title: null },
    ...overrides,
  };
}

beforeEach(() => {
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
  window.history.replaceState(null, "", "/home");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderApp() {
  return render(
    <LangProvider initial="en">
      <HomeApp config={CONFIG} />
    </LangProvider>,
  );
}

describe("HomeApp", () => {
  it("signed_out replaces to /sign-in", async () => {
    authUserState = { status: "signed_out" };
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });

  it("ok fetches /api/v1/home and renders the home view", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: makeData({ fact_count: 2 }) });
    renderApp();
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(1));
    expect(authedGetJson).toHaveBeenCalledWith(FAKE_AUTH, "/api/v1/home", expect.anything());
    await waitFor(() => expect(screen.getByText("Today in five lines")).not.toBeNull());
    expect(screen.getByText("Facts: 2")).not.toBeNull();
  });

  // ── R-19 PR-8 (plan 9.2): mist ground, the PR-7 reset area, the reset notice ──

  it("renders on the mist ground: the decoration is the page's first child, aria-hidden", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: makeData() });
    const { container } = renderApp();
    await waitFor(() => expect(screen.getByText("Today in five lines")).not.toBeNull());
    const mist = container.querySelector(".b6-mist");
    expect(mist).not.toBeNull();
    expect(mist!.getAttribute("aria-hidden")).toBe("true");
    expect(mist!.parentElement!.firstElementChild).toBe(mist);
  });

  it("a pilot owner (no demo claim) sees no 'Reset the demo' control", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: makeData() });
    renderApp();
    await waitFor(() => expect(screen.getByText("Today in five lines")).not.toBeNull());
    await waitFor(() => expect(authedGetJson).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Reset the demo" })).toBeNull();
  });

  it("a demo owner sees the PR-7 'Reset the demo' control in the reset area", async () => {
    authUserState = { status: "signed_in", user: userWith(DEMO_OWNER) } as unknown as AuthUserState;
    authedGetJson.mockResolvedValue({ kind: "ok", data: makeData() });
    renderApp();
    await waitFor(() => expect(screen.getByText("Today in five lines")).not.toBeNull());
    const button = await screen.findByRole("button", { name: "Reset the demo" });
    expect(button.closest("[data-testid='reset-area']")).not.toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("after a reset (?demo_reset=1) the 'Demo reset to day 1' notice shows once and the flag leaves the URL", async () => {
    window.history.replaceState(null, "", "/home?demo_reset=1");
    authedGetJson.mockResolvedValue({ kind: "ok", data: makeData() });
    renderApp();
    const notice = await screen.findByRole("status", { name: "" }, { timeout: 2000 }).catch(() => null);
    await waitFor(() => expect(screen.getByText("Demo reset to day 1")).not.toBeNull());
    expect(notice === null || notice.isConnected).toBe(true);
    expect(window.location.search).toBe("");
    await waitFor(() => expect(screen.getByText("Today in five lines")).not.toBeNull());
    expect(screen.getAllByText("Demo reset to day 1")).toHaveLength(1);
  });

  it("without the flag there is no reset notice", async () => {
    authedGetJson.mockResolvedValue({ kind: "ok", data: makeData() });
    renderApp();
    await waitFor(() => expect(screen.getByText("Today in five lines")).not.toBeNull());
    expect(screen.queryByText("Demo reset to day 1")).toBeNull();
  });

  it("forbidden replaces to /day (not an error message)", async () => {
    authedGetJson.mockResolvedValue({ kind: "forbidden" });
    renderApp();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/day"));
  });

  it("error shows a retry button that refetches", async () => {
    authedGetJson.mockResolvedValueOnce({ kind: "error" });
    renderApp();
    await waitFor(() => expect(screen.getByText("Could not load the notes.")).not.toBeNull());

    authedGetJson.mockResolvedValueOnce({ kind: "ok", data: makeData() });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(authedGetJson).toHaveBeenCalledTimes(2));
  });

  it("a 401 that survives the client's own retry (signed_out) signs out and replaces to /sign-in", async () => {
    authedGetJson.mockResolvedValue({ kind: "signed_out" });
    signOut.mockResolvedValue(undefined);
    renderApp();
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
  });
  it("keeps the same top bar and nav nodes across the loading -> ok transition (no remount, no layout jump)", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    authedGetJson.mockReturnValue(new Promise((r) => (resolveFetch = r)));
    renderApp();
    const nav = await screen.findByRole("navigation");
    const banner = screen.getByRole("banner");
    resolveFetch({ kind: "ok", data: makeData() });
    await waitFor(() => expect(authedGetJson).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(banner.isConnected).toBe(true);
    expect(nav.isConnected).toBe(true);
    expect(screen.getByRole("banner")).toBe(banner);
    expect(screen.getByRole("navigation")).toBe(nav);
  });
});
