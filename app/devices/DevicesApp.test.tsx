// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { AuthUserState } from "@/lib/auth/client/use-auth-user";
import { axeViolations } from "@/lib/testing/axe";
import { DevicesApp } from "@/app/devices/DevicesApp";

const CONFIG: FirebaseWebConfig = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" };
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/auth/client/firebase-client", () => ({ getClientAuth: () => ({ kind: "fake-auth" }), signOut: vi.fn() }));

let authUserState: AuthUserState = { status: "loading" };
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: () => authUserState }));

function renderApp(config: FirebaseWebConfig | null = CONFIG, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <DevicesApp config={config} />
    </LangProvider>,
  );
}
const user = (role: string) => ({ uid: "u1", getIdTokenResult: () => Promise.resolve({ claims: { role, outlet_id: "o1" } }) });

beforeEach(() => {
  replace.mockClear();
  authUserState = { status: "loading" };
});
afterEach(cleanup);

describe("/devices placeholder (R-19 PR-6 §8.2; R-25 R11: coming soon, page-2 look)", () => {
  it("a signed-in supervisor sees the heading, the sub line, one COMING SOON card and the nav with Connected devices current", async () => {
    authUserState = { status: "signed_in", user: user("supervisor") } as unknown as AuthUserState;
    renderApp();
    expect(screen.getByRole("heading", { level: 1, name: "Connected devices" })).toBeTruthy();
    expect(screen.getByText("Phones that listen for this shop.")).toBeTruthy();
    expect(screen.getByText("COMING SOON")).toBeTruthy();
    expect(
      screen.getByText("Pairing codes for a new phone will be made here. For this demo the staff phone is already set up."),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("link", { name: "Connected devices" }).getAttribute("aria-current")).toBe("page"));
    // hard rule 7 + D2-05 OUT: no code generation, no device row, no device id
    expect(screen.queryByRole("button", { name: /generate|copy|QR|unpair/i })).toBeNull();
    expect(screen.queryByText(/No phone connected yet/)).toBeNull();
  });

  it("is one page with one main landmark and the bar above the nav above the content", async () => {
    authUserState = { status: "signed_in", user: user("supervisor") } as unknown as AuthUserState;
    renderApp();
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy());
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const header = screen.getByRole("banner");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const main = screen.getByRole("main");
    expect(header.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sends a signed-out visitor to /sign-in", () => {
    authUserState = { status: "signed_out" };
    renderApp();
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("says sign-in is not set up when the server has no web config", () => {
    renderApp(null);
    expect(screen.getByText("Sign-in is not set up on this server.")).toBeTruthy();
  });

  it("is in Bahasa when the language says so", () => {
    authUserState = { status: "signed_in", user: user("supervisor") } as unknown as AuthUserState;
    renderApp(CONFIG, "id");
    expect(screen.getByText("HP yang mendengarkan toko ini.")).toBeTruthy();
    expect(screen.getByText("SEGERA HADIR")).toBeTruthy();
  });

  it("axe finds no violation", async () => {
    authUserState = { status: "signed_in", user: user("supervisor") } as unknown as AuthUserState;
    const { container } = renderApp();
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy());
    expect(await axeViolations(container)).toEqual([]);
  });
});
