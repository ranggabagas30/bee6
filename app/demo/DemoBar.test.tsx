// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { StartDemoResult } from "@/app/demo/demo-client";

const CONFIG: FirebaseWebConfig = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" };
const KEY = "A".repeat(43);

let pathname = "/day";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ROUTER,
}));
const push = vi.fn();
const ROUTER = { push, replace: vi.fn() };

const getClientAuth = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...a: unknown[]) => getClientAuth(...a),
  signOut: vi.fn(),
  signInWithCustomToken: vi.fn(),
}));

const startDemo = vi.fn<(role: string, options: Record<string, unknown>) => Promise<StartDemoResult>>();
vi.mock("@/app/demo/demo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/demo/demo-client")>()),
  startDemo: (role: string, options: Record<string, unknown>) => startDemo(role, options),
}));

import { DemoBar } from "@/app/demo/DemoBar";
import { DEMO_STATE_KEY } from "@/app/demo/demo-client";

const FAKE_AUTH = { kind: "fake-auth" };

function seed(role: "owner" | "supervisor" | "staff", expiresAtMs: number) {
  window.sessionStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: expiresAtMs, role }));
}
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function renderBar(lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <DemoBar config={CONFIG} />
    </LangProvider>,
  );
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const status = () => screen.getByTestId("demo-bar-status");

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  pathname = "/day";
  window.sessionStorage.clear();
  getClientAuth.mockReturnValue(FAKE_AUTH);
  consoleSpies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m as "log").mockImplementation(() => {}));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  startDemo.mockReset();
  push.mockReset();
  getClientAuth.mockReset();
});

describe("DemoBar visibility", () => {
  it("renders nothing without a demo state in this tab", () => {
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a malformed stored state", () => {
    window.sessionStorage.setItem(DEMO_STATE_KEY, "{oops");
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });

  it("is hidden on the landing page, which has its own controls", () => {
    seed("owner", Date.now() + 3_600_000);
    pathname = "/";
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });
});

describe("DemoBar live session", () => {
  it("shows the role and the local end time, and switches to the other two roles only", () => {
    const expires = Date.now() + 3_600_000;
    seed("staff", expires);
    renderBar();
    expect(screen.getByText(`Demo · You are: Staff · Ends at ${hhmm(expires)}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to Supervisor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to Owner" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch to Staff" })).toBeNull();
    for (const b of screen.getAllByRole("button")) expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(48);
  });

  it("is a labelled region and speaks Bahasa", () => {
    const expires = Date.now() + 3_600_000;
    seed("owner", expires);
    renderBar("id");
    expect(screen.getByText(`Demo · Anda: Pemilik · Berakhir pukul ${hhmm(expires)}`)).toBeTruthy();
    expect(screen.getByRole("complementary", { name: /Demo · Anda: Pemilik/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ganti ke Staf" })).toBeTruthy();
  });

  it("switches once per tap, in the same sandbox, stopping (not restarting) on expiry", async () => {
    seed("staff", Date.now() + 3_600_000);
    startDemo.mockResolvedValue({ kind: "started" });
    renderBar();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    expect(startDemo).toHaveBeenCalledTimes(1);
    const [role, options] = startDemo.mock.calls[0]!;
    expect(role).toBe("owner");
    expect(options.onExpired).toBe("stop");
    expect(options.auth).toBe(FAKE_AUTH);
  });

  it("disables both switches while one is in flight and ignores a second tap", async () => {
    seed("staff", Date.now() + 3_600_000);
    const d = deferred<StartDemoResult>();
    startDemo.mockReturnValue(d.promise);
    renderBar();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    expect((screen.getByRole("button", { name: "Switch to Owner" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Switch to Supervisor" }) as HTMLButtonElement).disabled).toBe(true);
    expect(status().textContent).toContain("Preparing your demo shop…");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    expect(startDemo).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ kind: "started" }));
    expect((screen.getByRole("button", { name: "Switch to Owner" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    [{ kind: "rate_limited", retryAfterSeconds: 600 } as const, ["Too many demo sessions", "Try again in 10 min."]],
    [{ kind: "busy", retryAfterSeconds: 2 } as const, ["The demo is busy for a moment.", "Try again in a few seconds."]],
    [{ kind: "error" } as const, ["Something went wrong. Try again."]],
  ])("keeps the bar and explains a refusal: %j", async (result, lines) => {
    seed("staff", Date.now() + 3_600_000);
    startDemo.mockResolvedValue(result);
    renderBar();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    for (const line of lines) expect(status().textContent).toContain(line);
    expect(document.activeElement).toBe(status());
    expect(screen.getByRole("button", { name: "Switch to Owner" })).toBeTruthy();
  });

  it("after a good switch, focus lands on the bar's role line so a screen reader hears the new role", async () => {
    seed("staff", Date.now() + 3_600_000);
    startDemo.mockResolvedValue({ kind: "started" });
    renderBar();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    expect(document.activeElement?.textContent).toMatch(/^Demo · You are:/);
  });

  it("when the server says the sandbox is gone, shows the ended state with a way to start again (never a silent new sandbox)", async () => {
    seed("staff", Date.now() + 3_600_000);
    startDemo.mockImplementation(async () => {
      window.sessionStorage.removeItem(DEMO_STATE_KEY); // what startDemo does on a 409 with onExpired: stop
      return { kind: "sandbox_expired" };
    });
    renderBar();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Start a new demo" });
    expect(link.getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
    expect(startDemo).toHaveBeenCalledTimes(1);
  });

  it("forgets a locally noticed end once the visitor is back at the landing page, so the next sandbox is not greeted as ended", async () => {
    seed("staff", Date.now() + 3_600_000);
    startDemo.mockImplementation(async () => {
      window.sessionStorage.removeItem(DEMO_STATE_KEY);
      return { kind: "sandbox_expired" };
    });
    const view = renderBar();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();

    pathname = "/"; // soft navigation via the restart link
    view.rerender(
      <LangProvider initial="en">
        <DemoBar config={CONFIG} />
      </LangProvider>,
    );
    seed("owner", Date.now() + 3_600_000); // a new visit started
    pathname = "/home";
    act(() => window.dispatchEvent(new Event("bee6:demo-change")));
    view.rerender(
      <LangProvider initial="en">
        <DemoBar config={CONFIG} />
      </LangProvider>,
    );
    expect(screen.queryByText("Your demo session has ended.")).toBeNull();
    expect(screen.getByRole("button", { name: "Switch to Staff" })).toBeTruthy();
  });

  it("never logs", async () => {
    seed("staff", Date.now() + 3_600_000);
    startDemo.mockResolvedValue({ kind: "error" });
    renderBar();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Switch to Owner" })));
    for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  });
});

describe("DemoBar expiry", () => {
  it("shows the ended state with a restart link, and no switch buttons, when the stored sandbox is past expiry", () => {
    seed("owner", Date.now() - 1000);
    renderBar();
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start a new demo" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
  });

  it("flips to the ended state on its own when the clock passes the expiry", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    seed("owner", Date.now() + 5_000);
    renderBar();
    expect(screen.getByRole("button", { name: "Switch to Staff" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
  });

  it("the ended state's restart link is at least 48 px tall", () => {
    seed("owner", Date.now() - 1000);
    renderBar();
    expect(parseInt(screen.getByRole("link", { name: "Start a new demo" }).style.minHeight, 10)).toBeGreaterThanOrEqual(48);
  });

  it("on /sign-in the ended state is left to the sign-in page's own link (no double message)", () => {
    seed("owner", Date.now() - 1000);
    pathname = "/sign-in";
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });

  it("on /sign-in a live sandbox still shows the bar", () => {
    seed("owner", Date.now() + 3_600_000);
    pathname = "/sign-in";
    renderBar();
    expect(screen.getByRole("button", { name: "Switch to Staff" })).toBeTruthy();
  });
});
