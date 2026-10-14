// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { StartDemoResult } from "@/app/demo/demo-client";
import type { DemoPanelHooks } from "@/app/sign-in/panel-hooks";
import { useDemoHooks } from "@/app/sign-in/demo-hooks";
import type { SignInRole } from "@/app/sign-in/roles";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { axeViolations } from "@/lib/testing/axe";

const CONFIG: FirebaseWebConfig = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" };
const KEY = "A".repeat(43);

const getClientAuth = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...a: unknown[]) => getClientAuth(...a),
  signOut: (...a: unknown[]) => signOut(...a),
  signInWithCustomToken: vi.fn(),
}));

const startOrSwitch = vi.fn<(role: string, options: Record<string, unknown>) => Promise<StartDemoResult>>();
vi.mock("@/app/demo/demo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/demo/demo-client")>()),
  startOrSwitch: (role: string, options: Record<string, unknown>) => startOrSwitch(role, options),
}));

import { DemoAccess } from "@/app/demo/DemoAccess";
import { DEMO_STATE_KEY, readDemoState } from "@/app/demo/demo-client";

const FAKE_AUTH = { kind: "fake-auth" };

/** Captures the hooks DemoAccess hands to the panel, and shows the prefill so tests can see it. */
let hooks: DemoPanelHooks = {};
function Panel() {
  const h = useDemoHooks();
  useEffect(() => {
    hooks = h;
  });
  return <div data-testid="panel" />;
}
const onFill = vi.fn();

function renderAccess(opts: { role?: SignInRole; lang?: "en" | "id"; config?: FirebaseWebConfig | null; barShowsEnded?: boolean } = {}) {
  return render(
    <LangProvider initial={opts.lang ?? "en"}>
      <DemoAccess role={opts.role ?? "staff"} onFill={onFill} config={opts.config === undefined ? CONFIG : opts.config} barShowsEnded={opts.barShowsEnded}>
        <Panel />
      </DemoAccess>
    </LangProvider>,
  );
}
const status = () => screen.getByTestId("demo-status");
const button = (name: RegExp | string) => screen.getByRole("button", { name });
const live = (role: string = "owner", ms = 3_600_000) =>
  window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + ms, role }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  getClientAuth.mockReturnValue(FAKE_AUTH);
  signOut.mockReset().mockResolvedValue(undefined);
  hooks = {};
  onFill.mockReset();
  consoleSpies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m as "log").mockImplementation(() => {}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  startOrSwitch.mockReset();
  getClientAuth.mockReset();
  vi.unstubAllGlobals();
});

describe("DemoAccess box", () => {
  it("for staff shows the private-copy line only: no code and no Fill in (W8: the judge guide carries 000000)", () => {
    renderAccess({ role: "staff" });
    expect(screen.getByRole("region", { name: "Demo access" })).toBeTruthy();
    expect(screen.queryByText("000000")).toBeNull();
    expect(screen.queryByRole("button", { name: "Fill in" })).toBeNull();
    expect(screen.getByText("Each sign-in opens your own private copy of a fictional shop for 2 hours. Nothing you do affects anyone else.")).toBeTruthy();
  });

  it.each([
    ["supervisor", "supervisor.judge@example.com"],
    ["owner", "owner.judge@example.com"],
  ] as const)("shows the %s email and the shared password", (role, email) => {
    renderAccess({ role });
    expect(screen.getByText(email)).toBeTruthy();
    expect(screen.getByText("bee6-demo")).toBeTruthy();
  });

  it("the credentials are selectable text in one tap", () => {
    renderAccess({ role: "owner" });
    expect(screen.getByText("owner.judge@example.com").style.userSelect).toBe("all");
  });

  it("is in Bahasa when the language says so", () => {
    renderAccess({ lang: "id", role: "owner" });
    expect(screen.getByRole("region", { name: "Akses demo" })).toBeTruthy();
    expect(screen.getByText(/Kata sandi/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Isi otomatis" })).toBeTruthy();
  });

  it.each([
    ["supervisor", { email: "supervisor.judge@example.com", password: "bee6-demo" }],
    ["owner", { email: "owner.judge@example.com", password: "bee6-demo" }],
  ] as const)("Fill in hands the %s credential to the panel (every tap), says so, and never submits", (role, values) => {
    renderAccess({ role });
    fireEvent.click(button("Fill in"));
    fireEvent.click(button("Fill in"));
    expect(onFill).toHaveBeenCalledTimes(2);
    expect(onFill).toHaveBeenLastCalledWith(values);
    expect(status().textContent).toBe("Filled in. Submit to continue.");
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("the Filled in line goes away when a demo is started", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess({ role: "owner" });
    fireEvent.click(button("Fill in"));
    await act(async () => void (await hooks.interceptEmail!("owner.judge@example.com", "bee6-demo")));
    expect(status().textContent).not.toContain("Filled in");
  });

  it("onStarted (R-19 PR-6, /pair): a started demo hands the start a no-op navigation and calls onStarted; the screen shows the next step itself", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    const onStarted = vi.fn();
    render(
      <LangProvider initial="en">
        <DemoAccess role="staff" onFill={onFill} config={CONFIG} onStarted={onStarted}>
          <Panel />
        </DemoAccess>
      </LangProvider>,
    );
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(typeof startOrSwitch.mock.calls[0]![1].navigate).toBe("function");
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it("onStarted is not called on a refusal", async () => {
    startOrSwitch.mockResolvedValue({ kind: "not_ready" });
    const onStarted = vi.fn();
    render(
      <LangProvider initial="en">
        <DemoAccess role="staff" onFill={onFill} config={CONFIG} onStarted={onStarted}>
          <Panel />
        </DemoAccess>
      </LangProvider>,
    );
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("axe finds no violation", async () => {
    const { container } = renderAccess({ role: "owner" });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("DemoAccess intercepts", () => {
  it("opens the role the credential names, once, with this browser's auth and no navigate override", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess({ role: "supervisor" });
    let handled: boolean | undefined;
    await act(async () => {
      handled = await hooks.interceptEmail!("OWNER.JUDGE@example.com", "bee6-demo");
    });
    expect(handled).toBe(true);
    expect(startOrSwitch).toHaveBeenCalledTimes(1);
    const [role, options] = startOrSwitch.mock.calls[0]!;
    expect(role).toBe("owner");
    expect(options.auth).toBe(FAKE_AUTH);
    expect(options.navigate).toBeUndefined(); // the default is a hard navigation
  });

  it("does not handle input that is not a demo credential", async () => {
    renderAccess({ role: "staff" });
    let code: boolean | undefined;
    let email: boolean | undefined;
    await act(async () => {
      code = await hooks.interceptCode!("123456");
      email = await hooks.interceptEmail!("a@b.c", "bee6-demo");
    });
    expect(code).toBe(false);
    expect(email).toBe(false);
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("passes no auth when the server has no Firebase config", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess({ config: null });
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(startOrSwitch.mock.calls[0]![1].auth).toBeNull();
  });

  it("shows the busy line while the request runs and ignores a second submit in flight", async () => {
    const d = deferred<StartDemoResult>();
    startOrSwitch.mockReturnValue(d.promise);
    renderAccess();
    let first!: Promise<boolean>;
    await act(async () => {
      first = hooks.interceptCode!("000000");
    });
    expect(within(status()).getByText("Preparing your demo shop…")).toBeTruthy();
    let second: boolean | undefined;
    await act(async () => {
      second = await hooks.interceptCode!("000000");
    });
    expect(second).toBe(true); // handled (swallowed), not sent to the real pair route
    expect(startOrSwitch).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ kind: "started" }));
    expect(await first).toBe(true);
  });

  it("after a successful start, a repeat submit while the page is still navigating makes no second request", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess();
    await act(async () => void (await hooks.interceptCode!("000000")));
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(startOrSwitch).toHaveBeenCalledTimes(1);
  });

  it("after a refusal the next submit is allowed again", async () => {
    startOrSwitch.mockResolvedValueOnce({ kind: "not_ready" }).mockResolvedValueOnce({ kind: "started" });
    renderAccess();
    await act(async () => void (await hooks.interceptCode!("000000")));
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(startOrSwitch).toHaveBeenCalledTimes(2);
  });

  const REFUSALS: Array<[string, StartDemoResult, string[]]> = [
    ["rate limited with a wait", { kind: "rate_limited", retryAfterSeconds: 1800 }, ["Too many demo sessions from this network today.", "Try again in 30 min."]],
    ["rate limited until tomorrow", { kind: "rate_limited", retryAfterSeconds: 80_000 }, ["Too many demo sessions from this network today.", "Try again tomorrow."]],
    ["daily cap", { kind: "daily_cap", retryAfterSeconds: 7200 }, ["The demo has reached today's limit.", "Try again in about 2 h."]],
    ["daily cap without Retry-After", { kind: "daily_cap", retryAfterSeconds: null }, ["The demo has reached today's limit.", "Try again later."]],
    ["busy", { kind: "busy", retryAfterSeconds: 2 }, ["The demo is busy for a moment.", "Try again in a few seconds."]],
    ["not ready", { kind: "not_ready" }, ["The demo is not ready yet."]],
    ["server says demo is off", { kind: "off" }, ["The demo is not ready yet."]],
    ["generic error", { kind: "error" }, ["Something went wrong. Try again."]],
  ];
  it.each(REFUSALS)("explains a refusal in friendly words and moves focus to the answer: %s", async (_name, result, lines) => {
    startOrSwitch.mockResolvedValue(result);
    renderAccess();
    let handled: boolean | undefined;
    await act(async () => {
      handled = await hooks.interceptCode!("000000");
    });
    expect(handled).toBe(true);
    for (const line of lines) expect(status().textContent).toContain(line);
    expect(document.activeElement).toBe(status());
  });

  it("a thrown auth start-up error becomes a friendly refusal and does not wedge the box", async () => {
    getClientAuth.mockImplementationOnce(() => {
      throw new Error("auth init failed");
    });
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess();
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(status().textContent).toContain("Something went wrong. Try again.");
    expect(startOrSwitch).not.toHaveBeenCalled();
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(startOrSwitch).toHaveBeenCalledTimes(1);
  });

  it("clears an old refusal when the next attempt starts", async () => {
    startOrSwitch.mockResolvedValueOnce({ kind: "not_ready" });
    renderAccess();
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(status().textContent).toContain("not ready");
    const d = deferred<StartDemoResult>();
    startOrSwitch.mockReturnValueOnce(d.promise);
    await act(async () => {
      void hooks.interceptCode!("000000");
    });
    expect(status().textContent).not.toContain("not ready");
    expect(status().textContent).toContain("Preparing");
    await act(async () => d.resolve({ kind: "started" }));
  });

  it("never renders server text, never logs", async () => {
    startOrSwitch.mockResolvedValue({ kind: "error" });
    renderAccess();
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(document.body.innerHTML).not.toMatch(/<script|onerror/i);
    for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  });
});

describe("DemoAccess with an earlier visit in this browser", () => {
  it("on /sign-in says the session ended when the stored sandbox is past its expiry: the DemoBar is hidden there (any role tab)", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: 1_000, role: "owner" }));
    renderAccess({ role: "staff" });
    expect(status().textContent).toContain("Your demo session has ended.");
  });

  it("with the DemoBar showing the ended sentence (/pair) the box does not repeat it", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: 1_000, role: "staff" }));
    renderAccess({ role: "staff", barShowsEnded: true });
    expect(screen.queryByText("Your demo session has ended.")).toBeNull();
    expect(status().textContent).toBe("");
  });

  it("says nothing of an ending, and nothing about continuing, on a fresh browser", () => {
    renderAccess();
    expect(status().textContent).toBe("");
    expect(screen.queryByText(/You are continuing your demo/)).toBeNull();
  });

  it("says you are continuing the live demo and when it ends; there is no fresh-demo control any more (R-19 PR-6 §8.1: the owner resets)", () => {
    live();
    renderAccess();
    expect(screen.getByText(/You are continuing your demo \(ends \d\d:\d\d\)\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /fresh|start over/i })).toBeNull();
    expect(screen.queryByText(/Discard this demo shop/)).toBeNull();
    expect(readDemoState()?.sandbox_key).toBe(KEY);
  });

  it("a demo credential typed over a live sandbox switches inside it (the request carries the key path through startOrSwitch)", async () => {
    live("staff");
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess({ role: "owner" });
    await act(async () => void (await hooks.interceptEmail!("owner.judge@example.com", "bee6-demo")));
    expect(startOrSwitch).toHaveBeenCalledTimes(1);
    expect(startOrSwitch.mock.calls[0]![0]).toBe("owner");
  });

  it("tampered storage is ignored: no continuing line, no ended line", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: "short", expires_at_ms: "soon", role: "root" }));
    renderAccess();
    expect(status().textContent).toBe("");
    expect(screen.queryByText(/You are continuing/)).toBeNull();
  });
});
