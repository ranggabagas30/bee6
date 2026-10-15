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
  signOut: (...args: unknown[]) => signOut(...args),
}));

let authUserState: AuthUserState = { status: "signed_out" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({
  useAuthUser: () => authUserState,
}));

const authedGetJson = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({
  authedGetJson: (...args: unknown[]) => authedGetJson(...args),
}));

const FAKE_AUTH = { kind: "fake-auth" };
const FAKE_USER = { uid: "u1" };

function makeData(overrides: Partial<HomeResponse> = {}): HomeResponse {
  return {
    today: "2026-10-09",
    day_status: "on",
    fact_count: 0,
    lines: [],
    more: 0,
    ...overrides,
  };
}

beforeEach(() => {
  authUserState = { status: "signed_in", user: FAKE_USER } as unknown as AuthUserState;
  getClientAuth.mockReturnValue(FAKE_AUTH);
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
    await waitFor(() => expect(screen.getByText("Today")).not.toBeNull());
    expect(screen.getByText("Facts: 2")).not.toBeNull();
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
    authUserState = {
      status: "signed_in",
      user: { uid: "u1", getIdTokenResult: () => Promise.resolve({ claims: { role: "owner", outlet_id: "o1" } }) },
    } as unknown as AuthUserState;
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
