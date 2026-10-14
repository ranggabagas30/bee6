// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { axeViolations } from "@/lib/testing/axe";
import { WebTopBar } from "@/app/web/WebTopBar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/auth/client/firebase-client", () => ({ signOut: vi.fn() }));

let authUserState: AuthUserState = { status: "loading" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: () => authUserState }));

const AUTH = { kind: "fake-auth" } as unknown as Auth;

/** A Firebase user whose fresh ID token carries these claims. */
function userWithClaims(claims: Record<string, unknown> | Error) {
  return {
    uid: "u1",
    getIdTokenResult: () => (claims instanceof Error ? Promise.reject(claims) : Promise.resolve({ claims })),
  };
}
function signedIn(claims: Record<string, unknown> | Error) {
  authUserState = { status: "signed_in", user: userWithClaims(claims) } as unknown as AuthUserState;
}

function renderBar(props: Partial<Parameters<typeof WebTopBar>[0]> = {}, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <WebTopBar auth={AUTH} showSignOut {...props} />
    </LangProvider>,
  );
}
const nav = () => screen.queryByRole("navigation", { name: /Main|Menu utama/ });

beforeEach(() => {
  authUserState = { status: "loading" };
});
afterEach(cleanup);

describe("WebTopBar (R-19 PR-6 §8.2)", () => {
  it("keeps the brand, the language switch and Sign out", () => {
    signedIn({ role: "supervisor", outlet_id: "o1" });
    renderBar();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByText("bee6")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Choose language" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("a supervisor claim shows the supervisor nav and a Supervisor role chip, no demo chip", async () => {
    signedIn({ role: "supervisor", outlet_id: "o1" });
    renderBar({ current: "day" });
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(screen.getByRole("link", { name: "Day record" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Connected devices" })).toBeTruthy();
    expect(screen.getByText("Supervisor")).toBeTruthy();
    expect(screen.queryByText("DEMO DATA")).toBeNull();
  });

  it("an owner claim shows the owner nav and an Owner chip", async () => {
    signedIn({ role: "owner", outlet_id: "o1" });
    renderBar({ current: "home" });
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(screen.getByRole("link", { name: "Approvals" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Connected devices" })).toBeNull();
    expect(screen.getByText("Owner")).toBeTruthy();
  });

  it("a demo sandbox claim (demo_exp_ms) adds the DEMO DATA chip", async () => {
    signedIn({ role: "owner", outlet_id: "o1", demo_exp_ms: Date.now() + 60_000 });
    renderBar();
    await waitFor(() => expect(screen.getByText("DEMO DATA")).toBeTruthy());
  });

  it("renders no nav and no chip while loading, when signed out, with a device or unknown role, or when the claim cannot be read", async () => {
    renderBar();
    expect(nav()).toBeNull();
    cleanup();

    authUserState = { status: "signed_out" };
    renderBar();
    expect(nav()).toBeNull();
    cleanup();

    signedIn({ role: "device", outlet_id: "o1" });
    renderBar();
    await Promise.resolve();
    expect(nav()).toBeNull();
    cleanup();

    signedIn(new Error("no token"));
    renderBar();
    await Promise.resolve();
    expect(nav()).toBeNull();
    expect(screen.queryByText(/Supervisor|Owner/)).toBeNull();
  });

  it("a user object without getIdTokenResult fails closed: no nav", async () => {
    authUserState = { status: "signed_in", user: { uid: "u1" } } as unknown as AuthUserState;
    renderBar();
    await Promise.resolve();
    expect(nav()).toBeNull();
  });

  it("with no auth there is no nav and no Sign out", () => {
    renderBar({ auth: null, showSignOut: false });
    expect(nav()).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("is in Bahasa when the language says so", async () => {
    signedIn({ role: "owner", outlet_id: "o1", demo_exp_ms: 1 });
    renderBar({}, "id");
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Menu utama" })).toBeTruthy());
    expect(screen.getByText("Pemilik")).toBeTruthy();
    expect(screen.getByText("DATA DEMO")).toBeTruthy();
  });

  it("axe finds no violation", async () => {
    signedIn({ role: "supervisor", outlet_id: "o1", demo_exp_ms: 1 });
    const { container } = renderBar({ current: "proposals" });
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(await axeViolations(container)).toEqual([]);
  });
});
