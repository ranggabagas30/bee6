// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Auth, User } from "firebase/auth";
import { DemoResetResponseSchema } from "@/lib/demo/contract";
import { ResetDemoButton, ResetNotice } from "@/app/demo/ResetDemoButton";

const authedPostJson = vi.fn();
const getExistingClientAuth = vi.fn();
const useAuthUser = vi.fn();
vi.mock("@/lib/auth/client/api", () => ({ authedPostJson: (...a: unknown[]) => authedPostJson(...a) }));
vi.mock("@/lib/auth/client/firebase-client", () => ({ getExistingClientAuth: () => getExistingClientAuth() }));
vi.mock("@/lib/auth/client/use-auth-user", () => ({ useAuthUser: (...a: unknown[]) => useAuthUser(...a) }));

const AUTH = { id: "auth" } as unknown as Auth;
const userWith = (claims: Record<string, unknown> | Error): User =>
  ({ getIdTokenResult: () => (claims instanceof Error ? Promise.reject(claims) : Promise.resolve({ claims })) }) as unknown as User;
const OWNER = { role: "owner", outlet_id: "sbx-0123456789ab", demo_exp_ms: 1_900_000_000_000 };

function signedIn(claims: Record<string, unknown> | Error) {
  getExistingClientAuth.mockReturnValue(AUTH);
  useAuthUser.mockReturnValue({ status: "signed_in", user: userWith(claims) });
}

async function renderOwner(lang: "en" | "id" = "en", navigate = vi.fn()) {
  signedIn(OWNER);
  const view = render(<ResetDemoButton lang={lang} navigate={navigate} />);
  await screen.findByRole("button", { name: lang === "en" ? "Reset the demo" : "Atur ulang demo" });
  return { ...view, navigate };
}

beforeEach(() => {
  authedPostJson.mockReset();
  getExistingClientAuth.mockReset();
  useAuthUser.mockReset();
});
afterEach(cleanup);

describe("ResetDemoButton is owner-only by itself", () => {
  it.each([
    ["no Firebase app", () => { getExistingClientAuth.mockReturnValue(null); useAuthUser.mockReturnValue({ status: "signed_out" }); }],
    ["still loading", () => { getExistingClientAuth.mockReturnValue(AUTH); useAuthUser.mockReturnValue({ status: "loading" }); }],
    ["signed out", () => { getExistingClientAuth.mockReturnValue(AUTH); useAuthUser.mockReturnValue({ status: "signed_out" }); }],
    ["a supervisor", () => signedIn({ ...OWNER, role: "supervisor" })],
    ["a staff or device claim", () => signedIn({ ...OWNER, role: "staff" })],
    ["an owner without the demo claim (a pilot owner)", () => signedIn({ role: "owner", outlet_id: "pilot-1" })],
    ["a claims read that fails", () => signedIn(new Error("offline"))],
  ])("renders nothing for %s", async (_name, arrange) => {
    arrange();
    const { container } = render(<ResetDemoButton lang="en" />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an owner of a demo sandbox sees the trigger and no dialog yet", async () => {
    await renderOwner();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("ResetDemoButton confirm dialog", () => {
  it("opens the plan's dialog with the safe choice focused; Cancel closes it, sends nothing and returns focus", async () => {
    await renderOwner();
    const trigger = screen.getByRole("button", { name: "Reset the demo" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog", { name: "Reset this demo?" });
    expect(dialog.textContent).toContain("This sets this demo copy back to day 1, with the original SOP and no proposals. Make sure no staff phone is listening.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(authedPostJson).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes it (nothing sent)", async () => {
    await renderOwner();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(authedPostJson).not.toHaveBeenCalled();
  });

  it("Tab and Shift+Tab stay inside the dialog (it is modal)", async () => {
    await renderOwner();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const reset = screen.getByRole("button", { name: "Reset" });
    reset.focus();
    fireEvent.keyDown(reset, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(reset);
  });

  it("Reset sends exactly { confirm: 'reset' } once (a double tap is ignored), disables both buttons meanwhile, then navigates to the owner Home with the notice flag", async () => {
    let finish!: (v: unknown) => void;
    authedPostJson.mockReturnValue(new Promise((r) => (finish = r)));
    const { navigate } = await renderOwner();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    const confirm = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(authedPostJson).toHaveBeenCalledTimes(1);
    expect(authedPostJson).toHaveBeenCalledWith(AUTH, "/api/v1/demo/reset", { confirm: "reset" }, DemoResetResponseSchema);
    expect((screen.getByRole("button", { name: "Resetting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy(); // not dismissible mid-flight
    await act(async () => finish({ kind: "ok", data: { reset: true } }));
    expect(navigate).toHaveBeenCalledWith("/home?demo_reset=1");
  });

  it("a 409 busy keeps the dialog open with the busy line and brings the buttons back", async () => {
    authedPostJson.mockResolvedValue({ kind: "conflict", code: "busy" });
    const { navigate } = await renderOwner();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Bee6 is busy right now. Try again in a few seconds.");
    expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["error", { kind: "error" }],
    ["signed out", { kind: "signed_out" }],
    ["forbidden", { kind: "forbidden" }],
    ["an expired sandbox", { kind: "conflict", code: "SANDBOX_EXPIRED" }],
    ["invalid", { kind: "invalid" }],
  ])("%s shows the plan's failure line (never server text) and does not navigate", async (_n, result) => {
    authedPostJson.mockResolvedValue(result);
    const { navigate } = await renderOwner();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The reset did not finish. Go to the entry page and start a new demo.");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a thrown request is the same failure line, not an unhandled rejection", async () => {
    authedPostJson.mockRejectedValue(new Error("boom"));
    await renderOwner();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The reset did not finish.");
  });

  // Wiring-PR QA note: a live region must not sit in the tree as an EMPTY role=alert (screen readers announce "alert"
  // for nothing, and axe flags it). The failure line is mounted only with its text; the busy line is a polite region.
  it("renders no role=alert while nothing failed: not with the trigger alone, not with the dialog open, not while the request is in flight", async () => {
    let finish!: (v: unknown) => void;
    authedPostJson.mockReturnValue(new Promise((r) => (finish = r)));
    await renderOwner();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelectorAll("[role='alert']")).toHaveLength(0);
    await act(async () => finish({ kind: "conflict", code: "busy" }));
    // and when a failure does land, the alert carries its text from the first render (never an empty alert first)
    const alert = screen.getByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
  });

  it("Bahasa copy (PROVISIONAL) follows the lang prop", async () => {
    await renderOwner("id");
    fireEvent.click(screen.getByRole("button", { name: "Atur ulang demo" }));
    expect(screen.getByRole("alertdialog", { name: "Atur ulang demo ini?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Batal" })).toBeTruthy();
  });

  it("the dialog is laid out for a 360 px screen: it never exceeds the viewport width and its buttons are at least 44 px tall", async () => {
    await renderOwner();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.style.width).toBe("min(100%, 420px)");
    expect(dialog.style.maxWidth).toBe("100%");
    for (const name of ["Cancel", "Reset"]) expect(Number.parseInt(screen.getByRole("button", { name }).style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    expect(dialog.parentElement!.style.padding).not.toBe("");
  });
});

describe("two mounted controls (the Home page's and the judge guide's) share ONE dialog", () => {
  async function renderTwo() {
    signedIn(OWNER);
    render(
      <>
        <section aria-label="page">
          <ResetDemoButton lang="en" navigate={vi.fn()} />
        </section>
        <section aria-label="guide">
          <ResetDemoButton lang="en" navigate={vi.fn()} />
        </section>
      </>,
    );
    await screen.findAllByRole("button", { name: "Reset the demo" });
    return {
      pageTrigger: within(screen.getByRole("region", { name: "page" })).getByRole("button", { name: "Reset the demo" }),
      guideTrigger: within(screen.getByRole("region", { name: "guide" })).getByRole("button", { name: "Reset the demo" }),
    };
  }

  it("opening from the guide puts exactly one alertdialog in the DOM, and the page's trigger adds none while it is open", async () => {
    const { pageTrigger, guideTrigger } = await renderTwo();
    fireEvent.click(guideTrigger);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    fireEvent.click(pageTrigger);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(guideTrigger); // focus goes back to the trigger that opened it
    // closed: the other trigger can open it again, still only one
    fireEvent.click(pageTrigger);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  });

  it("unmounting the control that opened the dialog (the guide collapsing) closes it, so the other one is not locked out", async () => {
    signedIn(OWNER);
    const { rerender } = render(
      <>
        <ResetDemoButton lang="en" navigate={vi.fn()} />
        <section aria-label="guide">
          <ResetDemoButton lang="en" navigate={vi.fn()} />
        </section>
      </>,
    );
    await screen.findAllByRole("button", { name: "Reset the demo" });
    fireEvent.click(within(screen.getByRole("region", { name: "guide" })).getByRole("button", { name: "Reset the demo" }));
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    rerender(
      <>
        <ResetDemoButton lang="en" navigate={vi.fn()} />
      </>,
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  });
});

describe("ResetNotice", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("shows 'Demo reset to day 1' only when the URL carries the flag the button sets", () => {
    window.history.replaceState(null, "", "/home?demo_reset=1");
    render(<ResetNotice lang="en" />);
    expect(screen.getByRole("status").textContent).toContain("Demo reset to day 1");
  });

  it("drops the flag from the URL once shown (a refresh must not announce the reset again), keeping other params and the hash", async () => {
    window.history.replaceState(null, "", "/home?demo_reset=1&tab=a#top");
    const first = render(<ResetNotice lang="en" />);
    await screen.findByRole("status"); // still shown after the URL was cleaned
    expect(window.location.search).toBe("?tab=a");
    expect(window.location.hash).toBe("#top");
    first.unmount();
    const refreshed = render(<ResetNotice lang="en" />); // a refresh: the param is gone
    expect(refreshed.container.innerHTML).toBe("");
  });

  it("renders nothing on a plain /home, or with any other value", () => {
    window.history.replaceState(null, "", "/home");
    const a = render(<ResetNotice lang="en" />);
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    window.history.replaceState(null, "", "/home?demo_reset=0");
    const b = render(<ResetNotice lang="en" />);
    expect(b.container.innerHTML).toBe("");
  });
});
