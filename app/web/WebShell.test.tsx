// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import type { Auth } from "@/lib/auth/client/firebase-client";
import { axeViolations } from "@/lib/testing/axe";
import { WebShell } from "@/app/web/WebShell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/auth/client/firebase-client", () => ({ signOut: vi.fn() }));

let authUserState: AuthUserState = { status: "loading" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: () => authUserState }));

const AUTH = { kind: "fake-auth" } as unknown as Auth;

function signedIn(claims: Record<string, unknown>) {
  authUserState = {
    status: "signed_in",
    user: { uid: "u1", getIdTokenResult: () => Promise.resolve({ claims }) },
  } as unknown as AuthUserState;
}
function renderShell(props: Partial<Parameters<typeof WebShell>[0]> = {}) {
  return render(
    <LangProvider initial="en">
      <WebShell auth={AUTH} current="reviews" {...props}>
        <h1>Page title</h1>
        <p>Page body</p>
      </WebShell>
    </LangProvider>,
  );
}
const nav = () => screen.queryByRole("navigation", { name: "Main" });
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  authUserState = { status: "loading" };
});
afterEach(cleanup);

describe("WebShell (R-25 T8)", () => {
  it("is the bar, then the left nav, then one main that holds the page's content", async () => {
    signedIn({ role: "supervisor", outlet_id: "o1" });
    renderShell();
    await waitFor(() => expect(nav()).toBeTruthy());
    const header = screen.getByRole("banner");
    const main = screen.getByRole("main");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(follows(header, nav()!)).toBe(true);
    expect(follows(nav()!, main)).toBe(true);
    expect(within(main).getByRole("heading", { level: 1, name: "Page title" })).toBeTruthy();
    expect(within(main).getByText("Page body")).toBeTruthy();
    // the nav is not inside main, and the contract class names are on the wrapper and on main
    expect(main.contains(nav())).toBe(false);
    expect(main.className).toContain("b6-main");
    expect(main.parentElement?.className).toContain("b6-dwrap");
  });

  it("marks the current item, and shows the owner's items for an owner", async () => {
    signedIn({ role: "owner", outlet_id: "o1" });
    renderShell({ current: "proposals" });
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(screen.getByRole("link", { name: "Approvals" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Connected devices" })).toBeNull();
  });

  it("draws the Proposals badge only from a given count", async () => {
    signedIn({ role: "supervisor", outlet_id: "o1" });
    renderShell({ proposalsBadge: 3 });
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(screen.getByRole("link", { name: /Proposals/ }).textContent).toContain("3");
  });

  it("while the claim is read the content is already there and the nav column is held; no nav until a web role", async () => {
    renderShell();
    expect(screen.getByText("Page body")).toBeTruthy();
    expect(nav()).toBeNull();
    expect(document.querySelector('[aria-hidden="true"][class*="navSlot"]')).not.toBeNull();
  });

  it("a device or unknown role gets the bar and the content, no nav and no held column", async () => {
    signedIn({ role: "device", outlet_id: "o1" });
    renderShell();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy());
    await Promise.resolve();
    expect(nav()).toBeNull();
    expect(document.querySelector('[class*="navSlot"]')).toBeNull();
  });

  it("with no auth: the bar and the content, no nav, no Sign out", () => {
    renderShell({ auth: null });
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(nav()).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.getByText("Page body")).toBeTruthy();
  });

  it("axe finds no violation", async () => {
    signedIn({ role: "supervisor", outlet_id: "o1", demo_exp_ms: Date.now() + 60_000 });
    const { container } = renderShell({ proposalsBadge: 2 });
    await waitFor(() => expect(nav()).toBeTruthy());
    expect(await axeViolations(container)).toEqual([]);
  });
});
