// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function renderAccess(opts: { role?: SignInRole; lang?: "en" | "id"; config?: FirebaseWebConfig | null } = {}) {
  return render(
    <LangProvider initial={opts.lang ?? "en"}>
      <DemoAccess role={opts.role ?? "staff"} onFill={onFill} config={opts.config === undefined ? CONFIG : opts.config}>
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
  it("shows the staff code with a Fill in button and the private-copy line", () => {
    renderAccess({ role: "staff" });
    expect(screen.getByRole("region", { name: "Demo access" })).toBeTruthy();
    expect(screen.getByText("000000")).toBeTruthy();
    expect(screen.getByText("Each sign-in opens your own private copy of a fictional shop for 2 hours. Nothing you do affects anyone else.")).toBeTruthy();
    expect(parseInt(button("Fill in").style.minHeight, 10)).toBeGreaterThanOrEqual(48);
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
    renderAccess({ lang: "id" });
    expect(screen.getByRole("region", { name: "Akses demo" })).toBeTruthy();
    expect(screen.getByText(/Kode staf/)).toBeTruthy();
  });

  it.each([
    ["staff", { code: "000000" }],
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
    renderAccess({ role: "staff" });
    fireEvent.click(button("Fill in"));
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(status().textContent).not.toContain("Filled in");
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
  it("says the session ended when the stored sandbox is past its expiry, and offers no fresh-demo control", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: 1_000, role: "owner" }));
    renderAccess();
    expect(status().textContent).toContain("Your demo session has ended.");
    expect(screen.queryByRole("button", { name: "Start a fresh demo" })).toBeNull();
  });

  it("says nothing of an ending, and nothing about continuing, on a fresh browser", () => {
    renderAccess();
    expect(status().textContent).toBe("");
    expect(screen.queryByText(/You are continuing your demo/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Start a fresh demo" })).toBeNull();
  });

  it("says you are continuing the live demo and when it ends, and offers Start a fresh demo behind a confirm step", () => {
    live();
    renderAccess();
    expect(screen.getByText(/You are continuing your demo \(ends \d\d:\d\d\)\./)).toBeTruthy();
    fireEvent.click(button("Start a fresh demo"));
    expect(readDemoState()?.sandbox_key).toBe(KEY); // first tap changes nothing
    expect(screen.getByText(/Discard this demo shop and start over/)).toBeTruthy();
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("Stay in this demo cancels; Yes, start over forgets the sandbox and says so", () => {
    live();
    renderAccess();
    fireEvent.click(button("Start a fresh demo"));
    fireEvent.click(button("Stay in this demo"));
    expect(screen.queryByText(/Discard this demo shop/)).toBeNull();
    expect(readDemoState()?.sandbox_key).toBe(KEY);

    fireEvent.click(button("Start a fresh demo"));
    fireEvent.click(button("Yes, start over"));
    expect(readDemoState()).toBeNull();
    expect(status().textContent).toContain("Demo cleared. Pick a role to begin again.");
    expect(document.activeElement).toBe(status());
    expect(screen.queryByRole("button", { name: "Start a fresh demo" })).toBeNull();
  });

  it("Yes, start over also signs the Firebase web user out and removes the device keys", async () => {
    live();
    window.localStorage.setItem("bee6.device_token", "t");
    window.localStorage.setItem("bee6.device_id", "d");
    renderAccess();
    fireEvent.click(button("Start a fresh demo"));
    fireEvent.click(button("Yes, start over"));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    expect(window.localStorage.getItem("bee6.device_token")).toBeNull();
    expect(window.localStorage.getItem("bee6.device_id")).toBeNull();
  });

  it("a demo credential submitted while the sign-out is still running waits for it, so a late sign-out cannot undo the new sign-in", async () => {
    live();
    const d = deferred<void>();
    signOut.mockReturnValue(d.promise);
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess();
    fireEvent.click(button("Start a fresh demo"));
    fireEvent.click(button("Yes, start over"));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = hooks.interceptCode!("000000");
    });
    expect(startOrSwitch).not.toHaveBeenCalled();
    await act(async () => d.resolve());
    expect(await pending).toBe(true);
    expect(startOrSwitch).toHaveBeenCalledTimes(1);
  });

  it("starts the next demo even when the sign-out fails", async () => {
    live();
    signOut.mockRejectedValue(new Error("offline"));
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderAccess();
    fireEvent.click(button("Start a fresh demo"));
    fireEvent.click(button("Yes, start over"));
    await act(async () => void (await hooks.interceptCode!("000000")));
    expect(startOrSwitch).toHaveBeenCalledTimes(1);
  });

  it("Yes, start over still works when the auth client cannot start", () => {
    live("staff");
    getClientAuth.mockImplementation(() => {
      throw new Error("no auth");
    });
    renderAccess();
    fireEvent.click(button("Start a fresh demo"));
    fireEvent.click(button("Yes, start over"));
    expect(readDemoState()).toBeNull();
    expect(status().textContent).toContain("Demo cleared.");
  });

  it("moves focus to the confirm question, and back to the button when the visitor stays", () => {
    live();
    renderAccess();
    fireEvent.click(button("Start a fresh demo"));
    expect(document.activeElement).toBe(screen.getByText(/Discard this demo shop/));
    fireEvent.click(button("Stay in this demo"));
    expect(document.activeElement).toBe(button("Start a fresh demo"));
  });

  it("tampered storage is ignored: no continuing line, no ended line", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: "short", expires_at_ms: "soon", role: "root" }));
    renderAccess();
    expect(status().textContent).toBe("");
    expect(screen.queryByText(/You are continuing/)).toBeNull();
  });
});
