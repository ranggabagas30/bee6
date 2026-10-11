// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import type { StartDemoResult } from "@/app/demo/demo-client";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";

const CONFIG: FirebaseWebConfig = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" };
const KEY = "A".repeat(43);

const push = vi.fn();
const replace = vi.fn();
const ROUTER = { push, replace };
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));

const getClientAuth = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...a: unknown[]) => getClientAuth(...a),
  signOut: (...a: unknown[]) => signOut(...a),
  signInWithCustomToken: vi.fn(),
}));

const startDemo = vi.fn<(role: string, options: Record<string, unknown>) => Promise<StartDemoResult>>();
vi.mock("@/app/demo/demo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/demo/demo-client")>()),
  startDemo: (role: string, options: Record<string, unknown>) => startDemo(role, options),
}));

import { Landing } from "@/app/demo/Landing";
import { DEMO_STATE_KEY, readDemoState } from "@/app/demo/demo-client";

const FAKE_AUTH = { kind: "fake-auth" };

function renderLanding(lang: "en" | "id" = "en", config: FirebaseWebConfig | null = CONFIG) {
  return render(
    <LangProvider initial={lang}>
      <Landing config={config} />
    </LangProvider>,
  );
}
const status = () => screen.getByTestId("demo-status");
const button = (name: RegExp) => screen.getByRole("button", { name });

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
  consoleSpies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m as "log").mockImplementation(() => {}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  startDemo.mockReset();
  push.mockReset();
  replace.mockReset();
  getClientAuth.mockReset();
  vi.unstubAllGlobals();
});

describe("Landing content", () => {
  it("shows title, intro, suggested path and the fictional-data line in English", () => {
    renderLanding();
    expect(screen.getByRole("heading", { level: 1, name: "bee6: the SOP Improvement Agent" })).toBeTruthy();
    expect(screen.getByText(/This demo shop is fictional/)).toBeTruthy();
    expect(screen.getByText(/Suggested path \(about 4 minutes\)/)).toBeTruthy();
    expect(screen.getByText("Fictional demo data")).toBeTruthy();
  });

  it("is in Bahasa when the language says so", () => {
    renderLanding("id");
    expect(screen.getByRole("heading", { level: 1, name: "bee6: Agen Perbaikan SOP" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Coba sebagai Staf" })).toBeTruthy();
  });

  it("has the three Try-as buttons, Staff first, each at least 48 px tall", () => {
    renderLanding();
    const names = screen.getAllByRole("button").map((b) => b.textContent).filter((n) => n?.startsWith("Try as"));
    expect(names).toEqual(["Try as Staff", "Try as Supervisor", "Try as Owner"]);
    for (const name of [/Try as Staff/, /Try as Supervisor/, /Try as Owner/]) {
      expect(parseInt(button(name).style.minHeight, 10)).toBeGreaterThanOrEqual(48);
    }
  });
});

describe("Landing taps", () => {
  it("starts the demo once per tap with the right role and the restart-on-expiry policy", async () => {
    startDemo.mockResolvedValue({ kind: "started" });
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Supervisor/)));
    expect(startDemo).toHaveBeenCalledTimes(1);
    const [role, options] = startDemo.mock.calls[0]!;
    expect(role).toBe("supervisor");
    expect(options.onExpired).toBe("restart");
    expect(options.auth).toBe(FAKE_AUTH);
    expect(options.navigate).toBeUndefined(); // startDemo's default is a hard navigation
  });

  it("passes no auth when the server has no Firebase config", async () => {
    startDemo.mockResolvedValue({ kind: "started" });
    renderLanding("en", null);
    await act(async () => fireEvent.click(button(/Try as Staff/)));
    expect(startDemo.mock.calls[0]![1].auth).toBeNull();
  });

  it("shows the busy line, disables all three buttons, and ignores a second tap while the first is in flight", async () => {
    const d = deferred<StartDemoResult>();
    startDemo.mockReturnValue(d.promise);
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Staff/)));
    expect(within(status()).getByText("Preparing your demo shop…")).toBeTruthy();
    for (const name of [/Try as Staff/, /Try as Supervisor/, /Try as Owner/]) {
      expect((button(name) as HTMLButtonElement).disabled).toBe(true);
    }
    // A second tap through any route (disabled attr bypassed) still posts once.
    await act(async () => fireEvent.click(button(/Try as Staff/)));
    expect(startDemo).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ kind: "started" }));
    expect((button(/Try as Staff/) as HTMLButtonElement).disabled).toBe(false);
  });

  const REFUSALS: Array<[string, StartDemoResult, string[]]> = [
    ["rate limited with a wait", { kind: "rate_limited", retryAfterSeconds: 1800 }, ["Too many demo sessions from this network today.", "Try again in 30 min."]],
    ["rate limited until tomorrow", { kind: "rate_limited", retryAfterSeconds: 80_000 }, ["Too many demo sessions from this network today.", "Try again tomorrow."]],
    ["daily cap", { kind: "daily_cap", retryAfterSeconds: 7200 }, ["The demo has reached today's limit.", "Try again in about 2 h."]],
    ["daily cap without Retry-After", { kind: "daily_cap", retryAfterSeconds: null }, ["The demo has reached today's limit.", "Try again later."]],
    ["busy", { kind: "busy", retryAfterSeconds: 2 }, ["The demo is busy for a moment.", "Try again in a few seconds."]],
    ["not ready", { kind: "not_ready" }, ["The demo is not ready yet."]],
    ["generic error", { kind: "error" }, ["Something went wrong. Try again."]],
  ];
  it.each(REFUSALS)("explains a refusal in friendly words: %s", async (_name, result, lines) => {
    startDemo.mockResolvedValue(result);
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Owner/)));
    for (const line of lines) expect(status().textContent).toContain(line);
    // Moves keyboard focus to the answer, and the buttons are live again for another try.
    expect(document.activeElement).toBe(status());
    expect((button(/Try as Owner/) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a thrown auth start-up error becomes a friendly refusal and does not wedge the buttons (second tap works)", async () => {
    getClientAuth.mockImplementationOnce(() => {
      throw new Error("auth init failed");
    });
    startDemo.mockResolvedValue({ kind: "started" });
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Owner/)));
    expect(status().textContent).toContain("Something went wrong. Try again.");
    expect(startDemo).not.toHaveBeenCalled();
    expect((button(/Try as Owner/) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => fireEvent.click(button(/Try as Owner/)));
    expect(startDemo).toHaveBeenCalledTimes(1); // the in-flight guard was released
  });

  it("clears an old refusal when the next tap starts", async () => {
    startDemo.mockResolvedValueOnce({ kind: "not_ready" });
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Owner/)));
    expect(status().textContent).toContain("not ready");
    const d = deferred<StartDemoResult>();
    startDemo.mockReturnValueOnce(d.promise);
    await act(async () => fireEvent.click(button(/Try as Owner/)));
    expect(status().textContent).not.toContain("not ready");
    expect(status().textContent).toContain("Preparing");
    await act(async () => d.resolve({ kind: "started" }));
  });

  it("sends the visitor to sign-in when the server says demo mode is not on (404)", async () => {
    startDemo.mockResolvedValue({ kind: "off" });
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Staff/)));
    expect(replace).toHaveBeenCalledWith("/sign-in");
  });

  it("renders server error text as nothing: only dictionary lines reach the screen", async () => {
    startDemo.mockResolvedValue({ kind: "error" });
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Staff/)));
    expect(document.body.innerHTML).not.toMatch(/<script|onerror/i);
  });

  it("never logs anything", async () => {
    startDemo.mockResolvedValue({ kind: "error" });
    renderLanding();
    await act(async () => fireEvent.click(button(/Try as Staff/)));
    for (const s of consoleSpies) expect(s).not.toHaveBeenCalled();
  });
});

describe("Landing with an earlier visit in this tab", () => {
  it("says the session ended when the stored sandbox is past its expiry", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: 1_000, role: "owner" }));
    renderLanding();
    expect(status().textContent).toContain("Your demo session has ended.");
    expect(screen.queryByRole("button", { name: "Start a new demo" })).toBeNull();
  });

  it("offers Start a new demo while a sandbox is live, behind a confirm step, and does nothing on the first tap", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: "owner" }));
    renderLanding();
    fireEvent.click(button(/Start a new demo/));
    expect(readDemoState()?.sandbox_key).toBe(KEY); // first tap changes nothing
    expect(screen.getByText(/Discard this demo shop and start over/)).toBeTruthy();
    expect(startDemo).not.toHaveBeenCalled();
  });

  it("Stay in this demo cancels; Yes, start over forgets the sandbox and says so", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: "owner" }));
    renderLanding();
    fireEvent.click(button(/Start a new demo/));
    fireEvent.click(button(/Stay in this demo/));
    expect(screen.queryByText(/Discard this demo shop/)).toBeNull();
    expect(readDemoState()?.sandbox_key).toBe(KEY);

    fireEvent.click(button(/Start a new demo/));
    fireEvent.click(button(/Yes, start over/));
    expect(readDemoState()).toBeNull();
    expect(status().textContent).toContain("Demo cleared. Pick a role to begin again.");
    expect(document.activeElement).toBe(status());
    expect(screen.queryByRole("button", { name: "Start a new demo" })).toBeNull();
  });

  it("Yes, start over also signs the Firebase web user out and removes the device keys", async () => {
    const stored = { sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: "owner" };
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(stored));
    window.localStorage.setItem("bee6.device_token", "t");
    window.localStorage.setItem("bee6.device_id", "d");
    renderLanding();
    fireEvent.click(button(/Start a new demo/));
    fireEvent.click(button(/Yes, start over/));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith(FAKE_AUTH));
    expect(window.localStorage.getItem("bee6.device_token")).toBeNull();
    expect(window.localStorage.getItem("bee6.device_id")).toBeNull();
  });

  it("Yes, start over still works when there is no Firebase config or the auth client cannot start", async () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: "staff" }));
    getClientAuth.mockImplementation(() => {
      throw new Error("no auth");
    });
    renderLanding();
    fireEvent.click(button(/Start a new demo/));
    fireEvent.click(button(/Yes, start over/));
    expect(readDemoState()).toBeNull();
    expect(status().textContent).toContain("Demo cleared.");
  });

  it("moves focus to the confirm question, and back to the button when the visitor stays", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: "owner" }));
    renderLanding();
    fireEvent.click(button(/Start a new demo/));
    expect(document.activeElement).toBe(screen.getByText(/Discard this demo shop/));
    fireEvent.click(button(/Stay in this demo/));
    expect(document.activeElement).toBe(button(/Start a new demo/));
  });

  it("does not offer Start a new demo on a fresh tab", () => {
    renderLanding();
    expect(screen.queryByRole("button", { name: "Start a new demo" })).toBeNull();
  });
});
