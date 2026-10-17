// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { FirebaseWebConfig } from "@/lib/auth/web-config";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";

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
const signOut = vi.fn();
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: (...a: unknown[]) => getClientAuth(...a),
  signOut: (...a: unknown[]) => signOut(...a),
  signInWithCustomToken: vi.fn(),
}));

import { DemoBar, hhmm as barHhmm, useDemoExpiryHHMM } from "@/app/demo/DemoBar";
import { DEMO_STATE_KEY } from "@/app/demo/demo-client";

// A judge's custom-token uid is demo-<role>-<sandbox>; Rangga's own email/password accounts are not.
const DEMO_UID = "demo-owner-sbx1";
const readyGate = { current: Promise.resolve() as Promise<void> };
const FAKE_AUTH: { kind: string; currentUser: { uid: string } | null; authStateReady: () => Promise<void> } = {
  kind: "fake-auth",
  currentUser: { uid: DEMO_UID },
  authStateReady: () => readyGate.current,
};

function seed(role: "owner" | "supervisor" | "staff", expiresAtMs: number) {
  window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: expiresAtMs, role }));
}
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** The top bars read the expiry through this hook; the probe stands in for them. */
function ExpiryProbe() {
  return <p data-testid="expiry">{useDemoExpiryHHMM() ?? "none"}</p>;
}
function renderProbe() {
  return render(
    <LangProvider initial="en">
      <ExpiryProbe />
      <DemoBar config={CONFIG} />
    </LangProvider>,
  );
}
const expiryText = () => screen.getByTestId("expiry").textContent;
function renderBar(lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <DemoBar config={CONFIG} />
    </LangProvider>,
  );
}

beforeEach(() => {
  pathname = "/day";
  vi.stubGlobal("localStorage", createMemoryStorage());
  FAKE_AUTH.currentUser = { uid: DEMO_UID };
  readyGate.current = Promise.resolve();
  getClientAuth.mockReturnValue(FAKE_AUTH);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  push.mockReset();
  getClientAuth.mockReset();
  signOut.mockReset();
  vi.unstubAllGlobals();
});

describe("DemoBar visibility", () => {
  it("renders nothing without a demo state in this tab", () => {
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a malformed stored state", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, "{oops");
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });

  it.each([9007199254740991, 8.64e15 + 1])("a stored expiry beyond the Date range (%d) is treated as tampered: no bar, and never the text NaN", (ms) => {
    seed("owner", ms);
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("the time helper never returns NaN text for an unrepresentable date", () => {
    expect(barHhmm(9007199254740991)).toBe("—");
    expect(barHhmm(Number.NaN)).toBe("—");
    expect(barHhmm(Date.UTC(2030, 5, 1, 12, 34))).toMatch(/^\d\d:\d\d$/);
  });

  it("a second tab of the same browser mounts the live region for the same sandbox, and follows a change made in the other tab", () => {
    const first = Date.now() + 3_600_000;
    const { container } = renderProbe();
    expect(expiryText()).toBe("none");
    expect(screen.queryByRole("status")).toBeNull();
    // Another tab started a visit: localStorage changes and a storage event arrives here.
    seed("owner", first);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: DEMO_STATE_KEY })));
    expect(expiryText()).toBe(hhmm(first));
    expect(screen.getByRole("status").textContent).toBe("");
    // ...then switched role there (a new 2 h session).
    const second = Date.now() + 7_200_000;
    seed("staff", second);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: DEMO_STATE_KEY })));
    expect(expiryText()).toBe(hhmm(second));
    // ...then ended the visit there.
    window.localStorage.removeItem(DEMO_STATE_KEY);
    act(() => void window.dispatchEvent(new StorageEvent("storage", { key: DEMO_STATE_KEY })));
    expect(expiryText()).toBe("none");
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("[data-testid=demo-bar-status]")).toBeNull();
  });

  it("is hidden on the landing page, which has its own controls", () => {
    seed("owner", Date.now() + 3_600_000);
    pathname = "/";
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });
});

// R-25 R6: the slot's room (`b6-topbar-reserved` on <html>) is gone with the visible bar; DemoBar never sets it and
// leaves the other classes on <html> alone.
describe("DemoBar holds no room on <html>", () => {
  afterEach(() => {
    document.documentElement.className = "";
  });

  it.each<[string, string, number]>([
    ["live", "/day", 3_600_000],
    ["live on /pair", "/pair", 3_600_000],
    ["ended on /pair", "/pair", -1000],
    ["ended on /sign-in", "/sign-in", -1000],
  ])("%s: no b6-topbar-reserved is added and the other classes stay", async (_n, route, delta) => {
    document.documentElement.className = "font-a b6-panel-reserved";
    seed("owner", Date.now() + delta);
    pathname = route;
    renderBar();
    await act(async () => {});
    expect(Array.from(document.documentElement.classList).sort()).toEqual(["b6-panel-reserved", "font-a"]);
  });
});

describe("DemoBar live session (R-25 R6: headless, the expiry moves to the top bars)", () => {
  it("draws nothing while the demo is live: no text, no controls, no landmark, no yellow styling; only the empty live region is mounted", () => {
    seed("staff", Date.now() + 3_600_000);
    const { container } = renderBar();
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
    expect(container.innerHTML).not.toMatch(/fff7d6|8a6d00|b6-topbar/i);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(document.body.textContent).not.toMatch(/Demo · Signed in as|Ends at|Switch to/);
  });

  it("speaks no Bahasa line either while live", () => {
    seed("owner", Date.now() + 3_600_000);
    const { container } = renderBar("id");
    expect(container.textContent).toBe("");
  });

  it("never calls the demo session route by itself (no switch, no restart)", () => {
    seed("staff", Date.now() + 3_600_000);
    vi.stubGlobal("fetch", vi.fn());
    renderBar();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("useDemoExpiryHHMM (R-25 R6: the 2 h expiry for the outlet line of the top bars)", () => {
  it("returns the device-local HH:MM of the live session's expiry", () => {
    const expires = Date.now() + 3_600_000;
    seed("staff", expires);
    renderProbe();
    expect(expiryText()).toBe(hhmm(expires));
    expect(expiryText()).toMatch(/^\d\d:\d\d$/);
  });

  it("works for every role, on every route (the bar hides its box on / and /sign-in, the hook does not)", () => {
    const expires = Date.now() + 3_600_000;
    for (const role of ["staff", "supervisor", "owner"] as const) {
      for (const route of ["/", "/sign-in", "/pair", "/day"]) {
        cleanup();
        seed(role, expires);
        pathname = route;
        renderProbe();
        expect(expiryText(), `${role} ${route}`).toBe(hhmm(expires));
      }
    }
  });

  it("is null with no state (every pilot browser), for a malformed record and for an expiry beyond the Date range", () => {
    renderProbe();
    expect(expiryText()).toBe("none");
    cleanup();
    window.localStorage.setItem(DEMO_STATE_KEY, "{oops");
    renderProbe();
    expect(expiryText()).toBe("none");
    cleanup();
    seed("owner", 8.64e15 + 1);
    renderProbe();
    expect(expiryText()).toBe("none");
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("is null once the session has ended, and flips by itself at the expiry instant while the bar is mounted", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    seed("owner", Date.now() - 1000);
    renderProbe();
    expect(expiryText()).toBe("none");
    cleanup();
    seed("owner", Date.now() + 5_000);
    renderProbe();
    expect(expiryText()).toMatch(/^\d\d:\d\d$/);
    act(() => void vi.advanceTimersByTime(5_001));
    expect(expiryText()).toBe("none");
  });
});

describe("DemoBar clears the judge phone's device keys once the demo has ended", () => {
  const keys = () => [window.localStorage.getItem("bee6.device_token"), window.localStorage.getItem("bee6.device_id")];
  beforeEach(() => {
    window.localStorage.setItem("bee6.device_token", "t");
    window.localStorage.setItem("bee6.device_id", "d");
  });

  it("keeps them while the sandbox is live", () => {
    seed("staff", Date.now() + 3_600_000);
    renderBar();
    expect(keys()).toEqual(["t", "d"]);
  });

  it("removes them when the stored sandbox is already past expiry", () => {
    seed("staff", Date.now() - 1000);
    renderBar();
    expect(keys()).toEqual([null, null]);
  });

  it("removes them when the clock passes the expiry while the bar is open", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    seed("staff", Date.now() + 5_000);
    renderBar();
    expect(keys()).toEqual(["t", "d"]);
    act(() => void vi.advanceTimersByTime(5_001));
    expect(keys()).toEqual([null, null]);
  });

  it("removes them on /sign-in too, where the bar itself is hidden", () => {
    seed("staff", Date.now() - 1000);
    pathname = "/sign-in";
    renderBar();
    expect(keys()).toEqual([null, null]);
  });
});

describe("DemoBar signs the Firebase web user out when the demo ends", () => {
  it("does not touch the user while the sandbox is live", () => {
    seed("owner", Date.now() + 3_600_000);
    renderBar();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs the user out when the timer ends the demo, and keeps the ended record so /sign-in can say so", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    const expires = Date.now() + 5_000;
    seed("owner", expires);
    renderBar();
    expect(signOut).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(5_001));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(FAKE_AUTH);
    expect(JSON.parse(window.localStorage.getItem(DEMO_STATE_KEY)!)).toEqual({ expires_at_ms: expires, role: "owner" }); // the key is dropped once the demo has ended
  });

  it("does so on /sign-in too, where the bar itself is hidden", async () => {
    seed("owner", Date.now() - 1000);
    pathname = "/sign-in";
    renderBar();
    await act(async () => {});
    expect(signOut).toHaveBeenCalledWith(FAKE_AUTH);
  });

  it("leaves a normal email/password session alone, on every mount, while an expired demo record is stored", async () => {
    FAKE_AUTH.currentUser = { uid: "k3Jx9OwnerAccountUid" }; // not a judge's demo- uid
    seed("owner", Date.now() - 1000);
    renderBar();
    await act(async () => {});
    cleanup();
    renderBar(); // a reload / hard navigation mounts the bar again
    await act(async () => {});
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
  });

  it("signs a demo- user out once Firebase has finished restoring the session", async () => {
    let release!: () => void;
    readyGate.current = new Promise<void>((r) => (release = r));
    FAKE_AUTH.currentUser = null; // not restored yet
    seed("owner", Date.now() - 1000);
    renderBar();
    await act(async () => {});
    expect(signOut).not.toHaveBeenCalled(); // still waiting for readiness
    FAKE_AUTH.currentUser = { uid: DEMO_UID };
    await act(async () => release());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(FAKE_AUTH);
  });

  it("does nothing to the user when nobody is signed in (a staff judge phone)", async () => {
    FAKE_AUTH.currentUser = null;
    seed("staff", Date.now() - 1000);
    renderBar();
    await act(async () => {});
    expect(signOut).not.toHaveBeenCalled();
  });

  it("a sign-out that fails does not break the ended bar", async () => {
    signOut.mockRejectedValue(new Error("offline"));
    seed("owner", Date.now() - 1000);
    renderBar();
    await act(async () => {});
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
  });

  it("without a web config there is nothing to sign out of and the bar still ends", () => {
    seed("staff", Date.now() - 1000);
    render(
      <LangProvider initial="en">
        <DemoBar config={null} />
      </LangProvider>,
    );
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
  });
});

describe("DemoBar expiry", () => {
  it("shows the ended notice only (no restart link, no switch buttons) when the stored sandbox is past expiry; the way back is the entry page", () => {
    seed("owner", Date.now() - 1000);
    renderBar();
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("flips to the ended state on its own when the clock passes the expiry", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    seed("owner", Date.now() + 5_000);
    renderBar();
    expect(screen.queryByText("Your demo session has ended.")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    act(() => {
      vi.advanceTimersByTime(5_001);
    });
    expect(screen.getByText("Your demo session has ended.")).toBeTruthy();
  });

  it("announces the ended state to a screen reader: the ended line is a status", () => {
    seed("owner", Date.now() - 1000);
    renderBar();
    expect(screen.getByRole("status").textContent).toBe("Your demo session has ended.");
  });

  it("announces a timer-driven end through the one live region that was already mounted (empty) while the demo was live", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    seed("owner", Date.now() + 5_000);
    renderBar();
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(5_001));
    expect(screen.getAllByRole("status")).toEqual([region]); // the same element, not a new one with the text already in it
    expect(region.textContent).toBe("Your demo session has ended.");
  });

  it("does not steal focus when the timer ends the demo", () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T08:00:00Z") });
    seed("owner", Date.now() + 5_000);
    renderBar();
    const before = document.activeElement;
    act(() => void vi.advanceTimersByTime(5_001));
    expect(screen.getByRole("status").textContent).toBe("Your demo session has ended.");
    expect(document.activeElement).toBe(before);
  });

  // R-25 R6: the ended line is the one visible piece left; it is an amber alert box (rare state, no board). The
  // wrapper is the same element before and after, so the live region inside it keeps its identity.
  it("the ended line is an amber alert box; while live the same wrapper carries no box class", () => {
    seed("owner", Date.now() + 3_600_000);
    const live = renderBar();
    expect(live.container.firstElementChild!.className).toBe("");
    cleanup();
    seed("owner", Date.now() - 1000);
    const ended = renderBar();
    const box = ended.container.firstElementChild!;
    expect(box.classList.contains("b6-alert")).toBe(true);
    expect(box.classList.contains("b6-alert--amber")).toBe(true);
    expect(box.contains(screen.getByRole("status"))).toBe(true);
  });

  it("on /sign-in the ended state is left to the sign-in page's own link (no double message)", () => {
    seed("owner", Date.now() - 1000);
    pathname = "/sign-in";
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });

  it("R-21 D5: on /sign-in a live sandbox mounts nothing (the page's own line carries the ending time)", () => {
    seed("owner", Date.now() + 3_600_000);
    pathname = "/sign-in";
    const { container } = renderBar();
    expect(container.innerHTML).toBe("");
  });
});
