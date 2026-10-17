// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { FRESH_DEMO_SESSION, type DemoSessionProfile } from "@/lib/capture/contract";
import { publishProposalsProgress, publishProposalsScreen } from "@/lib/demo/proposals-signal";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { DEMO_STATE_KEY } from "@/app/demo/demo-client";
import { publishCaptureBridge, publishPairDone, clearPairDone, type CaptureBridge, type CaptureBridgeState } from "@/app/demo/guide-bridge";
import { SHEET_RESERVE_PX, SUPERVISOR_SEEN_KEY, WELCOME_SEEN_KEY, scriptStorageKey } from "@/app/demo/JudgeGuide";
import { PairForm } from "@/app/pair/PairForm";

/**
 * R-19 PR-5 (plan 7.2-7.3, 5.3-5.4): the judge guide. One contextual card, collapsed by default, phone sheet under
 * 900 px and laptop pill/side panel from 900 px, one language at a time. The /capture card reads the page's
 * published bridge; the web cards read GET /api/v1/demo/progress.
 */

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const postDemoNextDay = vi.fn();
vi.mock("@/lib/capture/browser/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capture/browser/client")>()),
  readDeviceAuth: () => ({ deviceToken: "t", deviceId: "d" }),
  postDemoNextDay: (...a: unknown[]) => postDemoNextDay(...a),
}));

const getIdToken = vi.fn(async () => "id-token");
const FAKE_AUTH = { currentUser: { getIdToken } };
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: () => FAKE_AUTH,
  getExistingClientAuth: () => FAKE_AUTH,
}));
// The reset control (PR-7, registered in guide-controls) reads the signed-in user's claims through useAuthUser.
let claims: Record<string, unknown> = {};
const USER = { uid: "u1", getIdTokenResult: async () => ({ claims }) }; // one stable user object, as Firebase gives
// R-21 D4: Firebase restores the user asynchronously on a hard load, so the guide must wait for `signed_in`.
let authStatus: "loading" | "signed_in" = "signed_in";
vi.mock("@/lib/auth/client/use-auth-user", () => ({
  useAuthUser: () => (authStatus === "signed_in" ? { status: "signed_in", user: USER } : { status: "loading" }),
}));

import { JudgeGuide } from "@/app/demo/JudgeGuide";

const CONFIG = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:1:web:a" };
const KEY = "A".repeat(43);
const profile = (over: Partial<DemoSessionProfile> = {}): DemoSessionProfile => ({ ...FRESH_DEMO_SESSION, ...over });

let wide = false;
function stubMatchMedia() {
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      return q === "(min-width: 900px)" ? wide : false;
    },
    media: q,
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  }));
  return { notify: () => listeners.forEach((fn) => fn()) };
}

function seedWeb(role: "supervisor" | "owner") {
  window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role }));
}

function renderGuide(lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <JudgeGuide config={CONFIG} />
    </LangProvider>,
  );
}

const jumpToClosing = vi.fn();
const refetchConfig = vi.fn(async () => {});
function bridge(state: Partial<CaptureBridgeState> = {}): CaptureBridge {
  return {
    state: { profile: profile(), phase: "ready", sessionId: null, linesThisSession: 0, closingBusy: false, closingError: null, micTrouble: false, uploadBusy: false, ...state },
    actions: { jumpToClosing, refetchConfig },
  };
}
const openGuide = () => fireEvent.click(screen.getByRole("button", { name: /Open the judge guide/ }));

beforeEach(() => {
  pathname = "/";
  wide = false;
  authStatus = "signed_in";
  stubMatchMedia();
  vi.stubGlobal("localStorage", createMemoryStorage());
  window.localStorage.setItem(WELCOME_SEEN_KEY, "1"); // R-25 fixes-2 §3: every test starts past the first visit (collapsed default)
  vi.stubGlobal("sessionStorage", createMemoryStorage());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { day: 2, days_done: 2, proposals_with_content: 0, feasible: 0, owner_decided: 0 } }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  publishCaptureBridge(null);
  clearPairDone();
  publishProposalsScreen(null);
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("entry auto-open (R-25 fixes-2 §3)", () => {
  beforeEach(() => window.localStorage.removeItem(WELCOME_SEEN_KEY));

  it("wide, on /, first visit: the panel is open by itself, no focus is stolen, the flag is not written yet", () => {
    wide = true;
    renderGuide();
    expect(screen.getByRole("complementary", { name: "Judge guide" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open the judge guide/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Welcome, judge" })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
    expect(window.localStorage.getItem(WELCOME_SEEN_KEY)).toBeNull();
  });

  it("the close button collapses it to the pill, focuses the pill and remembers it; a later render stays collapsed", () => {
    wide = true;
    renderGuide();
    fireEvent.click(screen.getByRole("button", { name: /Close the judge guide/ }));
    const pill = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(document.activeElement).toBe(pill);
    expect(window.localStorage.getItem(WELCOME_SEEN_KEY)).toBe("1");
    cleanup();
    renderGuide();
    expect(screen.getByRole("button", { name: /Open the judge guide/ })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Judge guide" })).toBeNull();
  });

  it("flag already set: collapsed (the pill)", () => {
    wide = true;
    window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
    renderGuide();
    expect(screen.getByRole("button", { name: /Open the judge guide/ })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Judge guide" })).toBeNull();
  });

  it("phone (< 900 px): never auto-opens; the flag stays unset", () => {
    wide = false;
    renderGuide();
    expect((screen.getByText(/About 20 minutes/).closest(".b6-sheet__body") as HTMLElement).hidden).toBe(true);
    expect(window.localStorage.getItem(WELCOME_SEEN_KEY)).toBeNull();
  });

  it.each(["/pair", "/sign-in"])("wide, on %s, first visit: collapsed (entry page only)", (path) => {
    wide = true;
    pathname = path;
    renderGuide();
    expect(screen.getByRole("button", { name: /Open the judge guide/ })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Judge guide" })).toBeNull();
  });

  it("Escape anywhere in the document closes the auto-opened panel and remembers it", () => {
    wide = true;
    renderGuide();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("button", { name: /Open the judge guide/ })).toBeTruthy();
    expect(window.localStorage.getItem(WELCOME_SEEN_KEY)).toBe("1");
  });

  it("a route change collapses it and remembers it", () => {
    wide = true;
    const { rerender } = renderGuide();
    pathname = "/pair";
    rerender(
      <LangProvider initial="en">
        <JudgeGuide config={CONFIG} />
      </LangProvider>,
    );
    expect(screen.getByRole("button", { name: /Open the judge guide/ })).toBeTruthy();
    expect(window.localStorage.getItem(WELCOME_SEEN_KEY)).toBe("1");
  });

  it("storage blocked: still opens on wide / and closing does not throw", () => {
    wide = true;
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    renderGuide();
    expect(screen.getByRole("complementary", { name: "Judge guide" })).toBeTruthy();
    expect(() => fireEvent.click(screen.getByRole("button", { name: /Close the judge guide/ }))).not.toThrow();
    expect(screen.getByRole("button", { name: /Open the judge guide/ })).toBeTruthy();
  });
});

describe("shell: collapsed by default, phone sheet vs laptop pill, one language", () => {
  it("on / renders the entry card inside a collapsed sheet; the handle names the stage; the body is hidden until a tap", () => {
    renderGuide();
    const region = screen.getByRole("region", { name: "Judge guide" });
    const handle = within(region).getByRole("button", { name: /Open the judge guide/ });
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.textContent).toContain("JUDGE GUIDE");
    expect(handle.textContent).toContain("DEMO");
    expect(handle.textContent).toContain("Welcome · pick Staff to start");
    expect(handle.textContent).not.toContain("Day 1 of 3"); // the clock chip is for the capture pages (the bridge knows the day)
    expect((screen.getByText(/About 20 minutes/).closest(".b6-sheet__body") as HTMLElement).hidden).toBe(true);
    openGuide();
    expect((screen.getByText(/About 20 minutes/).closest(".b6-sheet__body") as HTMLElement).hidden).toBe(false);
    expect(screen.getByRole("heading", { name: "Welcome, judge" })).toBeTruthy();
    expect(screen.getByText(/About 20 minutes/)).toBeTruthy();
    expect(screen.getByText("WELCOME, JUDGE")).toBeTruthy();
    expect(screen.getByText("To change role later: sign out, then pick a role again.")).toBeTruthy();
    expect(screen.getByText("Welcome")).toBeTruthy();
    // R-25 R19: the phone sheet has no 5-row journey list; the stage lives in the chip and the label line
    expect(screen.queryByText("Your journey")).toBeNull();
    expect(screen.queryByText("Owner · approve")).toBeNull();
    expect(document.querySelectorAll(".b6-sheet__body li").length).toBe(0);
    expect(document.querySelector(".b6-sheet__body .b6-cardbox")).not.toBeNull();
  });

  it("from 900 px it is a pill top-right that opens a side panel", () => {
    wide = true;
    renderGuide();
    const pill = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(pill.className).toContain("b6-panel-pill");
    expect(pill.querySelector(".b6-fab")).not.toBeNull(); // UI-108: kicker + chip + chevron, not a sentence
    expect(pill.textContent).toContain("JUDGE GUIDE");
    expect(pill.textContent).toContain("DEMO");
    fireEvent.click(pill);
    const panel = screen.getByRole("complementary", { name: "Judge guide" });
    expect(panel).toBeTruthy();
    expect(within(panel).getByText("JUDGE GUIDE")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Welcome, judge" })).toBeTruthy();
    expect(within(panel).queryByRole("list")).toBeNull(); // no journey list on the entry card
  });

  it("the phone sheet reserves bottom space so Start / End / Cancel stay reachable under the collapsed handle; the laptop pill reserves nothing", () => {
    const { container, unmount } = renderGuide();
    const spacer = container.querySelector("[data-testid='guide-sheet-reserve']") as HTMLElement;
    expect(spacer.style.height).toBe(`calc(${SHEET_RESERVE_PX}px + env(safe-area-inset-bottom))`);
    unmount();
    wide = true;
    const { container: c2 } = renderGuide();
    expect(c2.querySelector("[data-testid='guide-sheet-reserve']")).toBeNull();
  });

  it("collapses again after a route change", () => {
    const { rerender } = renderGuide();
    openGuide();
    expect(screen.getByRole("button", { name: /Close the judge guide/ })).toBeTruthy();
    pathname = "/pair";
    rerender(
      <LangProvider initial="en">
        <JudgeGuide config={CONFIG} />
      </LangProvider>,
    );
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Fill in the demo code");
  });

  it("ID mode shows the (provisional) Bahasa chrome AND Bahasa card copy (UI-009), never both languages at once; the 'Bahasa coming soon' note is for the script cards only", () => {
    renderGuide("id");
    const handle = screen.getByRole("button", { name: /Buka panduan juri/ });
    expect(handle.textContent).toContain("PANDUAN JURI");
    expect(handle.textContent).toContain("Selamat datang · pilih Staf untuk mulai");
    expect(handle.textContent).not.toContain("Welcome");
    fireEvent.click(handle);
    expect(screen.getByText("SELAMAT DATANG, JURI")).toBeTruthy();
    expect(screen.queryByText("Bahasa segera hadir; kartu ditampilkan dalam bahasa Inggris.")).toBeNull();
    expect(screen.queryByText("Perjalanan Anda")).toBeNull();
  });

  it("renders nothing on a web route without a live demo state in this browser, and nothing on /capture without the page's bridge", () => {
    pathname = "/day";
    const { container, unmount } = renderGuide();
    expect(container.innerHTML).toBe("");
    unmount();
    pathname = "/capture";
    const { container: c2 } = renderGuide();
    expect(c2.innerHTML).toBe("");
  });
});

describe("pair card: Fill in the demo code", () => {
  it("fills the real pairing field without submitting, and says so", () => {
    pathname = "/pair";
    const fetchMock = vi.mocked(fetch);
    render(
      <LangProvider initial="en">
        <PairForm />
        <JudgeGuide config={CONFIG} />
      </LangProvider>,
    );
    openGuide();
    expect(screen.getByText("STEP: PAIR THE DEVICE")).toBeTruthy();
    expect(screen.getByText("000000", { selector: "b" })).toBeTruthy(); // the code is bold in the card text
    fireEvent.click(screen.getByRole("button", { name: "Fill in 000000" }));
    expect((screen.getByLabelText("6-digit code") as HTMLInputElement).value).toBe("000000");
    // after the fill the control itself reads "Filled in" and is disabled (UI-015); a screen reader hears the next step
    // (the sheet collapsed after the fill: the control is still there, just hidden with the body)
    expect((screen.getByRole("button", { name: "Filled in", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Filled in. Tap Set up.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement).disabled).toBe(false);
  });

  // R-21 D7: on a 360 px phone the open sheet covers "Set up"; Fill in hands the page back.
  it("Fill in collapses the sheet so Set up is reachable", () => {
    pathname = "/pair";
    render(
      <LangProvider initial="en">
        <PairForm />
        <JudgeGuide config={CONFIG} />
      </LangProvider>,
    );
    openGuide();
    expect(screen.getByRole("button", { name: /Close the judge guide/ }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Fill in 000000" }));
    expect((screen.getByLabelText("6-digit code") as HTMLInputElement).value).toBe("000000");
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("/capture: the script card (plan 5.3-5.4)", () => {
  const listening = (lines: number, sessionId = "s1") => bridge({ phase: "listening", sessionId, linesThisSession: lines });

  it("ready: the Start card, with the day in the handle", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(bridge({ phase: "ready", profile: profile({ day: 2 }) })));
    renderGuide();
    const handle = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(handle.textContent).toContain("Tap Start, then read the cards");
    expect(handle.textContent).toContain("Day 2 of 3");
  });

  it("listening: ONE card at a time; I have spoken this is disabled until Bee6 heard 1 line of it; the next card replaces it and focus moves to its heading", async () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(listening(0)));
    renderGuide();
    // the handle says which card is on screen (UI-006): "Read card 1 of 5 aloud", with the day clock chip beside it
    const handle = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(handle.textContent).toContain("Read card 1 of 5 aloud");
    expect(handle.querySelector(".b6-clock")?.textContent).toBe("Day 1 of 3");
    openGuide();
    expect(screen.getByText("Card 1 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Opening/ })).toBeTruthy();
    expect(screen.getByText(/Good morning. I am opening the shop now/)).toBeTruthy();
    expect(screen.queryByText(/The first tray of egg tarts/)).toBeNull();
    // the board's why-line, and the stage label on top of the card box
    expect(screen.getByText("Read it word for word. You play every voice; the speaker name is not spoken. Pause about 2 seconds between speakers.")).toBeTruthy();
    expect(screen.getByText("Staff · day 1")).toBeTruthy();
    const spoken = screen.getByRole("button", { name: "I have spoken this · next card" }) as HTMLButtonElement;
    expect(spoken.disabled).toBe(true);
    expect(screen.getByText("Waiting for Bee6 to hear this card…")).toBeTruthy();
    expect(screen.queryByText(/Locked until all 5 cards are spoken/)).toBeNull(); // UI-034: not on the card
    expect(screen.queryByRole("button", { name: /Previous card/ })).toBeNull(); // card 1 has no previous card
    act(() => publishCaptureBridge(listening(1)));
    expect((screen.getByRole("button", { name: "I have spoken this · next card" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "I have spoken this · next card" }));
    expect(screen.getByText("Card 2 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /First bake/ })).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("First bake");
    fireEvent.click(handle); // collapsed again: the handle's one-line title follows the card on screen
    expect(handle.textContent).toContain("Read card 2 of 5 aloud");
    fireEvent.click(handle);
    // the lines heard on card 1 do not count for card 2
    expect((screen.getByRole("button", { name: "I have spoken this · next card" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Card 2 of 5");
    // the "Previous card" link shows card 1 read-only and returns
    fireEvent.click(screen.getByRole("button", { name: "‹ Previous card (re-read only)" }));
    expect(screen.getByText(/Good morning. I am opening the shop now/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /I have spoken this/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to card 2" }));
    expect(screen.getByRole("heading", { name: /First bake/ })).toBeTruthy();
  });

  it("the script text region is keyboard-reachable and the 5 progress bars follow the spoken cards (UI-034)", () => {
    pathname = "/capture";
    window.sessionStorage.setItem(scriptStorageKey("s1"), JSON.stringify({ spoken: ["d1-c1", "d1-c2"] }));
    act(() => publishCaptureBridge(listening(0)));
    renderGuide();
    openGuide();
    const region = screen.getByRole("region", { name: "Script card text" });
    expect(region.getAttribute("tabindex")).toBe("0");
    const bars = document.querySelectorAll(".b6-sheet__body [class*='_bars_'] > span");
    expect(bars.length).toBe(5);
    expect(Array.from(bars).filter((b) => /_barOn_/.test(b.className)).length).toBe(2);
  });

  it("ID mode: the 'Bahasa coming soon' note sits on the script card only, the other lines stay in English", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(listening(0)));
    renderGuide("id");
    fireEvent.click(screen.getByRole("button", { name: /Buka panduan juri/ }));
    expect(screen.getByText("Bahasa segera hadir; kartu ditampilkan dalam bahasa Inggris.")).toBeTruthy();
    expect(screen.getByText("Hari 1 dari 3")).toBeTruthy();
  });

  it("the phone-call card needs 1 heard line like every other card; the speaker tags are shown, never spoken", () => {
    pathname = "/capture";
    window.sessionStorage.setItem(scriptStorageKey("s2"), JSON.stringify({ spoken: ["d2-c1", "d2-c2"] }));
    act(() => publishCaptureBridge(bridge({ phase: "listening", sessionId: "s2", linesThisSession: 7, profile: profile({ day: 2 }) })));
    renderGuide();
    openGuide();
    expect(screen.getByText("Card 3 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /A phone order/ })).toBeTruthy();
    expect(screen.getAllByText("Staff").length).toBe(2);
    expect((screen.getByRole("button", { name: /I have spoken this/ }) as HTMLButtonElement).disabled).toBe(true);
    act(() => publishCaptureBridge(bridge({ phase: "listening", sessionId: "s2", linesThisSession: 8, profile: profile({ day: 2 }) })));
    expect((screen.getByRole("button", { name: /I have spoken this/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("progress survives a reload (sessionStorage per session) and a new session starts at card 1", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(listening(1)));
    const { unmount } = renderGuide();
    openGuide();
    fireEvent.click(screen.getByRole("button", { name: /I have spoken this/ }));
    expect(JSON.parse(window.sessionStorage.getItem(scriptStorageKey("s1"))!)).toEqual({ spoken: ["d1-c1"] });
    unmount();
    renderGuide();
    openGuide();
    expect(screen.getByText("Card 2 of 5")).toBeTruthy();
    cleanup();
    act(() => publishCaptureBridge(listening(0, "s-new")));
    renderGuide();
    openGuide();
    expect(screen.getByText("Card 1 of 5")).toBeTruthy();
  });

  it("after card 5 the same card becomes All 5 cards are spoken with Jump to closing time (calls the page's action, disabled while in flight); after the jump: Tap End today", () => {
    pathname = "/capture";
    window.sessionStorage.setItem(scriptStorageKey("s1"), JSON.stringify({ spoken: ["d1-c1", "d1-c2", "d1-c3", "d1-c4"] }));
    act(() => publishCaptureBridge(listening(4)));
    renderGuide();
    openGuide();
    expect(screen.getByText("Card 5 of 5")).toBeTruthy();
    act(() => publishCaptureBridge(listening(5)));
    // card 5 ends with "finish", not "next card"
    expect(screen.queryByRole("button", { name: "I have spoken this · next card" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "I have spoken this · finish" }));
    expect(screen.getByRole("heading", { name: "All 5 cards are spoken" })).toBeTruthy();
    expect(screen.getByText("ALL 5 CARDS SPOKEN")).toBeTruthy();
    expect(screen.getByText("Well done. Day 1's speech is captured. Jump to closing time, then tap End.")).toBeTruthy();
    expect(screen.queryByText(/Locked until/)).toBeNull();
    // "‹ Previous card (re-read only)" re-reads card 5 without marking anything
    fireEvent.click(screen.getByRole("button", { name: "‹ Previous card (re-read only)" }));
    expect(screen.getByRole("region", { name: "Script card text" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide the card" }));
    expect(screen.queryByRole("region", { name: "Script card text" })).toBeNull();
    // the guide stays open across listening -> all spoken (same flow)
    fireEvent.click(screen.getByRole("button", { name: "Jump to closing time" }));
    expect(jumpToClosing).toHaveBeenCalledTimes(1);
    act(() => publishCaptureBridge({ ...listening(5), state: { ...listening(5).state, closingBusy: true } }));
    expect((screen.getByRole("button", { name: "Jumping…" }) as HTMLButtonElement).disabled).toBe(true);
    act(() =>
      publishCaptureBridge({
        ...listening(5),
        state: { ...listening(5).state, closingError: { key: "C-sess-closing-not-enough", vars: { have: 3, need: 5 } } },
      }),
    );
    // The page already announces this failure (one role=alert under End); the guide's copy is visible but silent.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Bee6 has not heard enough yet (3 of 5). Wait a few seconds for the last card to upload, then try again.")).toBeTruthy();
    act(() => publishCaptureBridge(bridge({ phase: "closing", sessionId: "s1", linesThisSession: 5 })));
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("All cards spoken · jump to closing");
    // a later session (day 2) starts at card 1: the all-spoken state belongs to the session that spoke the cards
    act(() => publishCaptureBridge(listening(0, "s-day2")));
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Read card 1 of 5 aloud");
  });

  // R-21 F-2: the End confirm is page content under the open sheet; a tap outside the sheet collapses it.
  it("closing: a pointerdown outside the open sheet (the page's End today) collapses it; one inside does not", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(bridge({ phase: "closing", sessionId: "s1", linesThisSession: 5 })));
    renderGuide();
    const pageButton = document.createElement("button");
    document.body.appendChild(pageButton);
    openGuide();
    fireEvent.pointerDown(screen.getByRole("heading", { name: /End today/ }));
    expect(screen.getByRole("button", { name: /Close the judge guide/ }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(pageButton);
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).getAttribute("aria-expanded")).toBe("false");
    pageButton.remove();
  });

  it("the mic hint appears only on engine trouble while nothing new was heard", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(listening(0)));
    renderGuide();
    openGuide();
    expect(screen.queryByText("Not picking up your voice?")).toBeNull();
    act(() => publishCaptureBridge({ ...listening(0), state: { ...listening(0).state, micTrouble: true } }));
    expect(screen.getByText("Not picking up your voice?")).toBeTruthy();
    expect(screen.getByText("Check the microphone is allowed.")).toBeTruthy();
    expect(screen.queryByText(/Bee6 is catching up/)).toBeNull();
  });

  it("an upload stall shows the catching-up line under 'Waiting for Bee6', and never the mic hint (R-23)", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(listening(0)));
    renderGuide();
    openGuide();
    expect(screen.queryByText(/Bee6 is catching up/)).toBeNull();
    act(() => publishCaptureBridge({ ...listening(0), state: { ...listening(0).state, uploadBusy: true } }));
    const waiting = screen.getByText("Waiting for Bee6 to hear this card…");
    const catching = screen.getByText(
      "Bee6 is catching up: the transcription service is busy. Keep reading; this card unlocks when it has been heard.",
    );
    expect(waiting.compareDocumentPosition(catching) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Not picking up your voice?")).toBeNull();
  });

  it("with a real mic problem AND a stalled upload, the stall line wins and the mic hint stays hidden", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge({ ...listening(0), state: { ...listening(0).state, micTrouble: true, uploadBusy: true } }));
    renderGuide();
    openGuide();
    expect(screen.getByText(/Bee6 is catching up/)).toBeTruthy();
    expect(screen.queryByText("Not picking up your voice?")).toBeNull();
  });

  it("the catching-up line is gone once the card can be marked spoken", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge({ ...listening(1), state: { ...listening(1).state, uploadBusy: true } }));
    renderGuide();
    openGuide();
    expect(screen.queryByText(/Bee6 is catching up/)).toBeNull();
  });
});

describe("/capture: the debrief cards and Jump to tomorrow (plan 4.4, 7.2)", () => {
  const debrief = (next_day: DemoSessionProfile["next_day"], phase: CaptureBridgeState["phase"] = "debrief_done", day: 1 | 2 | 3 = 1) =>
    bridge({ phase, profile: profile({ day, next_day }) });

  it("refetches the config when the phone enters the debrief (after End), and re-polls every 10 s while the server says busy or preparing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    pathname = "/capture";
    act(() => publishCaptureBridge(bridge({ phase: "listening", sessionId: "s1" })));
    renderGuide();
    expect(refetchConfig).not.toHaveBeenCalled();
    act(() => publishCaptureBridge(debrief({ allowed: false, reason: "preparing" }, "debrief_preparing")));
    expect(refetchConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refetchConfig).toHaveBeenCalledTimes(2);
    // preparing -> questions is a debrief phase change: one more refetch at once, then the 10 s poll goes on (busy)
    act(() => publishCaptureBridge(debrief({ allowed: false, reason: "busy" }, "debrief_question")));
    expect(refetchConfig).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refetchConfig).toHaveBeenCalledTimes(4);
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_question")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refetchConfig).toHaveBeenCalledTimes(4); // no poll once the jump is allowed
    // the debrief's end (timed out or PR-3's done flag) refetches once more, so Start / the lock line are current
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_done")));
    expect(refetchConfig).toHaveBeenCalledTimes(5);
  });

  // R-25 UI-112: the question card has no Jump control, even though the server would allow the jump; the 409 confirm
  // path stays for the complete card.
  it("UI-112: while questions are open (debrief_question) there is no Jump to tomorrow button, whatever the server allows; the card says when it appears", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_question")));
    renderGuide();
    openGuide();
    expect(screen.getByRole("heading", { name: "Answer what really happened" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Jump to tomorrow/ })).toBeNull();
    expect(screen.getByText("When every question is answered or skipped, this guide shows Jump to tomorrow.")).toBeTruthy();
    expect(screen.queryByText(/Leave \d+ questions unanswered/)).toBeNull();
  });

  it("UI-112: the Jump button is there on the complete card (debrief_done)", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_done", 2)));
    renderGuide();
    openGuide();
    expect(screen.getByRole("button", { name: "Jump to tomorrow" })).toBeTruthy();
  });

  it("busy and preparing show their line with NO retry tap; max_days shows its line and never offers the button", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(debrief({ allowed: false, reason: "busy" })));
    renderGuide();
    openGuide();
    expect(screen.getByText("Bee6 is busy with today's notes. Try again in a few seconds.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Jump to tomorrow" })).toBeNull();
    act(() => publishCaptureBridge(debrief({ allowed: false, reason: "max_days" }, "debrief_done", 3)));
    expect(screen.getByText("All 3 demo days are done. Sign out and continue as Supervisor.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Jump to tomorrow" })).toBeNull();
    expect(postDemoNextDay).not.toHaveBeenCalled();
  });

  it("allowed: Jump to tomorrow posts expected_day = the profile's day, then refetches the config and says which day it is", async () => {
    pathname = "/capture";
    postDemoNextDay.mockResolvedValueOnce({ ok: true, data: { day: 2 } });
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null })));
    renderGuide();
    openGuide();
    const refetchesBefore = refetchConfig.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Jump to tomorrow" }));
    await waitFor(() => expect(postDemoNextDay).toHaveBeenCalledWith({ deviceToken: "t", deviceId: "d" }, { expected_day: 1, confirm_unanswered: false }));
    await waitFor(() => expect(refetchConfig.mock.calls.length).toBe(refetchesBefore + 1));
    expect(screen.getByRole("status").textContent).toBe("It is now day 2 of 3. Tap Start.");
  });

  it("409 unanswered_questions: an inline confirm (no modal) with the count; Jump anyway retries with confirm_unanswered: true; Answer them first closes it", async () => {
    pathname = "/capture";
    postDemoNextDay.mockResolvedValueOnce({ ok: false, status: 409, code: "unanswered_questions", details: { unanswered: 2 } });
    postDemoNextDay.mockResolvedValueOnce({ ok: true, data: { day: 3 } });
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_done", 2)));
    renderGuide();
    openGuide();
    fireEvent.click(screen.getByRole("button", { name: "Jump to tomorrow" }));
    expect(await screen.findByText("Leave 2 questions unanswered?")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("If you jump to tomorrow now, today's debrief ends and these questions are recorded as unverified.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Answer them first" }));
    expect(screen.queryByText("Leave 2 questions unanswered?")).toBeNull();
    postDemoNextDay.mockReset();
    postDemoNextDay.mockResolvedValueOnce({ ok: false, status: 409, code: "unanswered_questions", details: { unanswered: 1 } });
    postDemoNextDay.mockResolvedValueOnce({ ok: true, data: { day: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "Jump to tomorrow" }));
    fireEvent.click(await screen.findByRole("button", { name: "Jump anyway" }));
    await waitFor(() => expect(postDemoNextDay).toHaveBeenLastCalledWith(expect.anything(), { expected_day: 2, confirm_unanswered: true }));
  });

  it("the debrief cards are day-aware: day 1 says look around as Supervisor first and never mentions the phone order; day 2 says jump to run day 3; day 3 says sign out", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(bridge({ phase: "debrief_done", profile: profile({ day: 1, days_done: 1, next_day: { allowed: true, reason: null } }) })));
    renderGuide();
    const handle = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(handle.textContent).toContain("Jump to tomorrow for day 2");
    expect(handle.textContent).toContain("STAGE 2 OF 5"); // days_done 1 on the phone, supervisor not visited: stage 2
    openGuide();
    expect(screen.getByRole("heading", { name: "Today is done" })).toBeTruthy();
    expect(screen.getByText("Supervisor · look around")).toBeTruthy(); // the stage label (UI-040)
    expect(screen.getByText("NEXT")).toBeTruthy();
    expect(screen.getByText(/Day 1 of 3 is done\. First sign out and look around as Supervisor/)).toBeTruthy();
    expect(screen.queryByText(/After day 3, sign out and continue as Supervisor/)).toBeNull();
    expect(screen.getByRole("button", { name: "Jump to tomorrow" })).toBeTruthy();
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_done", 2)));
    expect(screen.queryByText(/Day 1 of 3 is done/)).toBeNull();
    expect(screen.getByText(/Jump to tomorrow to run day 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Close the judge guide/ })); // the open handle has no title line
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Jump to tomorrow for day 3");
    act(() => publishCaptureBridge(debrief({ allowed: false, reason: "max_days" }, "debrief_done", 3)));
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Sign out and continue as Supervisor");
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_question", 1)));
    openGuide(); // a card change collapses the phone sheet
    expect(screen.getByRole("heading", { name: "Answer what really happened" })).toBeTruthy();
    expect(screen.getByText("DEBRIEF TIP")).toBeTruthy();
    expect(screen.queryByText(/phone order/i)).toBeNull();
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_question", 2)));
    expect(screen.getByText(/The phone order did happen, so answer Yes/)).toBeTruthy();
  });

  it("Jump to tomorrow carries the date the page publishes (UI-040); without it the label stays plain", () => {
    pathname = "/capture";
    const done = debrief({ allowed: true, reason: null }, "debrief_done", 1);
    act(() => publishCaptureBridge({ ...done, state: { ...done.state, nextDate: "2026-10-18" } }));
    renderGuide();
    openGuide();
    expect(screen.getByRole("button", { name: "Jump to tomorrow · Sun 18 Oct" })).toBeTruthy();
    act(() => publishCaptureBridge(done));
    expect(screen.getByRole("button", { name: "Jump to tomorrow" })).toBeTruthy();
  });

  it("a refusal from the route shows its own line (never server text); a double tap makes one request", async () => {
    pathname = "/capture";
    let release: (v: unknown) => void = () => {};
    postDemoNextDay.mockImplementationOnce(() => new Promise((r) => (release = r)));
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null })));
    renderGuide();
    openGuide();
    const btn = screen.getByRole("button", { name: "Jump to tomorrow" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(postDemoNextDay).toHaveBeenCalledTimes(1);
    release({ ok: false, status: 409, code: "proposal_exists", details: null });
    expect(await screen.findByText(/Bee6 has already written a proposal from these days/)).toBeTruthy();
    expect(screen.queryByText(/Open questions need/)).toBeNull();
  });
});

describe("web routes: progress and the supervisor-visited flag", () => {
  // R-25 R7 (UI-052): arriving on a supervisor page right after day 1 used to flip the pill to STAGE 3 at once, because
  // the visited flag is set the moment the page mounts. The guide now holds stage 2 on the supervisor pages.
  it("supervisor on /day: fetches the progress with the ID token, sets the visited flag, and the stage stays Supervisor · look around (stage 2)", async () => {
    pathname = "/day";
    seedWeb("supervisor");
    vi.mocked(fetch).mockImplementation(async (url) => {
      expect(String(url)).toBe("/api/v1/demo/progress");
      return new Response(JSON.stringify({ data: { day: 1, days_done: 1, proposals_with_content: 0, feasible: 0, owner_decided: 0 } }), { status: 200 });
    });
    renderGuide();
    await waitFor(() => expect(window.localStorage.getItem(SUPERVISOR_SEEN_KEY)).toBe("1"));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("STAGE 2 OF 5");
    openGuide();
    expect(screen.getByRole("heading", { name: "The day record" })).toBeTruthy();
    // R-25 T6 (D2-02-open): the stage label and a "Do this now" list, first row current, no 5-row journey list
    expect(screen.getByText("Supervisor · look around")).toBeTruthy();
    expect(screen.getByText("Do this now")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Do this now" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Confirm the note that needs your check"), expect.stringContaining("Open Proposals")]),
    );
    expect(rows[0]!.getAttribute("aria-current")).toBe("step");
    expect(screen.queryByText("Your journey")).toBeNull();
  });

  // R-21 D4: on a hard load Firebase has not restored the user yet; authedGetJson would answer signed_out without a
  // request and the pill would sit at stage 1 until the next route change.
  it("D4: waits for the signed-in user before reading the progress, then reads it once and the pill shows the real stage", async () => {
    pathname = "/sop";
    seedWeb("supervisor");
    authStatus = "loading";
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { day: 3, days_done: 3, proposals_with_content: 0, feasible: 0, owner_decided: 0 } }), { status: 200 }));
    const view = () => (
      <LangProvider initial="en">
        <JudgeGuide config={CONFIG} />
      </LangProvider>
    );
    const { rerender } = render(view());
    await act(async () => {});
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("STAGE 1 OF 5");
    authStatus = "signed_in";
    rerender(view());
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("STAGE 4 OF 5"));
    const progressCalls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u) === "/api/v1/demo/progress");
    expect(progressCalls).toHaveLength(1);
  });

  it("supervisor on /proposals after 2 days: Ask Bee6; owner on /proposals: the approvals card", async () => {
    pathname = "/proposals";
    seedWeb("supervisor");
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Ask Bee6 for a proposal"));
    cleanup();
    seedWeb("owner");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { day: 3, days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 0 } }), { status: 200 }));
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("STAGE 5 OF 5"));
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Approve one, reject the other");
  });

  it("/home: the owner card carries PR-7's Reset control, mounted only while the guide is open (one trigger, no second notice); a supervisor's claims get no control", async () => {
    pathname = "/home";
    seedWeb("owner");
    claims = { role: "owner", outlet_id: "sbx-1", demo_exp_ms: Date.now() + 3_600_000 };
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Owner home"));
    // Collapsed: the control is not in the tree at all (not merely hidden), so it reads the Firebase app only once the
    // page has initialised it and the judge opens the card.
    expect(screen.queryByRole("button", { name: "Reset the demo", hidden: true })).toBeNull();
    openGuide();
    expect(await screen.findAllByRole("button", { name: "Reset the demo" })).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Demo reset to day 1");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset the demo" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Close the judge guide/ }));
    expect(screen.queryByRole("button", { name: "Reset the demo", hidden: true })).toBeNull();
    cleanup();
    claims = { role: "supervisor", outlet_id: "sbx-1", demo_exp_ms: Date.now() + 3_600_000 };
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Owner home"));
    openGuide();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Reset the demo" })).toBeNull();
  });

  // The reset dialog is portaled to document.body, and React synthetic events climb the React tree: an Escape pressed
  // inside the dialog also reaches the Sheet / SidePanel keydown. The shells ignore a keydown from outside their own
  // DOM, so the dialog alone decides what Escape does (dismiss when idle, nothing while a request is in flight).
  describe.each([
    ["phone sheet", false],
    ["laptop panel", true],
  ])("/home, %s: Escape inside the reset dialog never collapses the guide", (_shell, isWide) => {
    const guideStaysOpen = () => {
      if (isWide) expect(screen.getByRole("complementary", { name: "Judge guide" })).toBeTruthy();
      else expect(screen.getByRole("button", { name: /Close the judge guide/ }).getAttribute("aria-expanded")).toBe("true");
    };
    async function openResetDialog() {
      pathname = "/home";
      wide = isWide;
      seedWeb("owner");
      claims = { role: "owner", outlet_id: "sbx-1", demo_exp_ms: Date.now() + 3_600_000 };
      renderGuide();
      openGuide();
      await screen.findByRole("heading", { name: "Owner home" }); // the pill names only the stage, so wait on the open card
      const trigger = await screen.findByRole("button", { name: "Reset the demo" });
      fireEvent.click(trigger);
      expect(screen.getByRole("dialog")).toBeTruthy();
      return trigger;
    }

    it("Escape on the dialog's Cancel closes only the dialog: the guide stays open and the trigger has focus", async () => {
      const trigger = await openResetDialog();
      const cancel = screen.getByRole("button", { name: "Cancel" });
      expect(document.activeElement).toBe(cancel);
      fireEvent.keyDown(cancel, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      guideStaysOpen();
      expect(document.activeElement).toBe(trigger);
    });

    it("Escape while the reset request is in flight leaves the dialog on screen and the guide open", async () => {
      vi.mocked(fetch).mockImplementation(async (url) =>
        String(url).endsWith("/api/v1/demo/reset")
          ? new Promise<Response>(() => {}) // never settles: the dialog stays busy
          : new Response(JSON.stringify({ data: { day: 3, days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 2 } }), { status: 200 }),
      );
      await openResetDialog();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset the demo" }));
      const busy = await screen.findByRole("button", { name: "Resetting…" });
      expect((busy as HTMLButtonElement).disabled).toBe(true);
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Resetting…" })).toBeTruthy();
      guideStaysOpen();
    });
  });

  // After-merge wiring: /proposals reports its screen and its writes through lib/demo/proposals-signal.
  it("/proposals follows the page's published screen at once: Asking Bee6 while generating, the hand-over on feasible, All decided for the owner", async () => {
    pathname = "/proposals";
    seedWeb("supervisor");
    renderGuide();
    const handle = () => screen.getByRole("button", { name: /Open the judge guide/ }).textContent;
    await waitFor(() => expect(handle()).toContain("Ask Bee6 for a proposal"));
    act(() => publishProposalsScreen("generating"));
    expect(handle()).toContain("Asking Bee6");
    act(() => publishProposalsScreen("feasible"));
    expect(handle()).toContain("Over to the Owner");
    act(() => publishProposalsScreen("list"));
    expect(handle()).toContain("Ask Bee6 for a proposal");
    cleanup();
    seedWeb("owner");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { day: 3, days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 1 } }), { status: 200 }));
    renderGuide();
    await waitFor(() => expect(handle()).toContain("Approve one, reject the other"));
    act(() => publishProposalsScreen("all_decided"));
    expect(handle()).toContain("All decided");
  });

  it("a published screen counts only on /proposals (a stale signal never changes another route's card)", async () => {
    pathname = "/sop";
    seedWeb("supervisor");
    act(() => publishProposalsScreen("generating"));
    renderGuide();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("The shop's SOP");
  });

  it("re-reads the progress the moment the page reports a write (an ask, a feasible mark, a rejection, an approval), without reopening the guide", async () => {
    pathname = "/proposals";
    seedWeb("supervisor");
    renderGuide();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { day: 3, days_done: 3, proposals_with_content: 1, feasible: 1, owner_decided: 0 } }), { status: 200 }));
    act(() => publishProposalsProgress());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toBe("/api/v1/demo/progress");
    // the stage list moved on the fresh counters (every proposal feasible: Owner · approve)
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("STAGE 5 OF 5"));
  });

  it("a failed progress fetch keeps the default card (no error text from the server)", async () => {
    pathname = "/proposals";
    seedWeb("supervisor");
    vi.mocked(fetch).mockResolvedValue(new Response("oops", { status: 500 }));
    renderGuide();
    openGuide();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Waiting for evidence" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("oops");
  });
});

// Integration QA D1 (wiring branch): opening the guide re-reads the progress; when the counters had moved since the
// last read, the new card's key tripped the collapse-on-card-change rule and the guide shut itself ~50 ms after the
// tap. A card change that comes only from a progress read never collapses the guide; page-driven changes still do.
describe("D1: a progress-driven card change never collapses the guide", () => {
  const STALE = { day: 2, days_done: 2, proposals_with_content: 0, feasible: 0, owner_decided: 0 };
  const MOVED = { day: 3, days_done: 3, proposals_with_content: 2, feasible: 0, owner_decided: 0 };
  const progressResponse = (p: object) => new Response(JSON.stringify({ data: p }), { status: 200 });

  describe.each([
    ["phone sheet", false],
    ["laptop panel", true],
  ])("%s", (_shell, isWide) => {
    const guideIsOpen = () =>
      isWide
        ? screen.queryByRole("complementary", { name: "Judge guide" }) !== null
        : screen.getByRole("button", { name: /judge guide/ }).getAttribute("aria-expanded") === "true";

    it("counters changed since the last read (no page signal): ONE tap opens it, the re-read moves the card, and it stays open", async () => {
      pathname = "/proposals";
      wide = isWide;
      seedWeb("supervisor");
      vi.mocked(fetch).mockResolvedValue(progressResponse(STALE));
      renderGuide();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      // Two proposals were written meanwhile (the QA probe mutates the sandbox behind the page's back).
      vi.mocked(fetch).mockResolvedValue(progressResponse(MOVED));
      openGuide();
      expect(guideIsOpen()).toBe(true);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole("heading", { name: "Check each proposal" })).toBeTruthy();
      expect(guideIsOpen()).toBe(true);
    });

    it("a page-signalled progress re-read while the guide is open moves the card without closing it", async () => {
      pathname = "/proposals";
      wide = isWide;
      seedWeb("supervisor");
      vi.mocked(fetch).mockResolvedValue(progressResponse(STALE));
      renderGuide();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      openGuide();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole("heading", { name: "Ask Bee6 for a proposal" })).toBeTruthy();
      vi.mocked(fetch).mockResolvedValue(progressResponse(MOVED));
      act(() => publishProposalsProgress());
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
      expect(await screen.findByRole("heading", { name: "Check each proposal" })).toBeTruthy();
      expect(guideIsOpen()).toBe(true);
    });

    it("a page-driven card change still collapses it: the list turns into Asking Bee6 after an Ask", async () => {
      pathname = "/proposals";
      wide = isWide;
      seedWeb("supervisor");
      vi.mocked(fetch).mockResolvedValue(progressResponse(STALE));
      renderGuide();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      openGuide();
      expect(await screen.findByRole("heading", { name: "Ask Bee6 for a proposal" })).toBeTruthy();
      act(() => publishProposalsScreen("generating"));
      expect(guideIsOpen()).toBe(false);
    });
  });
});

describe("R-19 PR-5 QA fixes: scroll body, 48 px controls, open-session card, busy jump", () => {
  it("D3: the sheet's scroll body is a keyboard-focusable named region (axe scrollable-region-focusable), even when nothing inside is focusable", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(bridge({ phase: "listening", sessionId: "s1", linesThisSession: 0 })));
    renderGuide();
    openGuide();
    const body = document.querySelector(".b6-sheet__body") as HTMLElement;
    expect(body.getAttribute("tabindex")).toBe("0");
    expect(body.getAttribute("role")).toBe("region");
    // named by the card heading, so a screen reader says which card it is scrolling
    expect(screen.getByRole("region", { name: "Read this card aloud" })).toBe(body);
  });

  it("D3: the laptop panel's scroll body is focusable and named the same way", () => {
    wide = true;
    renderGuide();
    openGuide();
    const body = document.querySelector(".b6-panel__body") as HTMLElement;
    expect(body.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("region", { name: "Welcome, judge" })).toBe(body);
  });

  it("D4: every guide control is at least 48 px high: I have spoken this, Previous card, Jump, Fill in, and the panel close", () => {
    pathname = "/capture";
    window.sessionStorage.setItem(scriptStorageKey("s1"), JSON.stringify({ spoken: ["d1-c1"] }));
    act(() => publishCaptureBridge(bridge({ phase: "listening", sessionId: "s1", linesThisSession: 0 })));
    renderGuide();
    openGuide();
    const body = document.querySelector(".b6-sheet__body") as HTMLElement;
    const controls = Array.from(body.querySelectorAll<HTMLElement>("button"));
    expect(controls.map((c) => c.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("I have spoken this"), "‹ Previous card (re-read only)"]));
    for (const c of controls) expect(parseFloat(c.style.minHeight), c.textContent ?? "").toBeGreaterThanOrEqual(48);
    cleanup();
    pathname = "/pair";
    renderGuide();
    openGuide();
    expect(parseFloat((screen.getByRole("button", { name: "Fill in 000000" }) as HTMLElement).style.minHeight)).toBeGreaterThanOrEqual(48);
  });

  it("D6: a POST 409 busy on Jump to tomorrow disables the button, shows the transient line (no alert), and re-polls the config until the reason clears", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    pathname = "/capture";
    postDemoNextDay.mockResolvedValueOnce({ ok: false, status: 409, code: "busy", details: null });
    act(() => publishCaptureBridge(bridge({ phase: "debrief_done", profile: profile({ day: 1, next_day: { allowed: true, reason: null } }) })));
    renderGuide();
    openGuide();
    const refetchesBefore = refetchConfig.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Jump to tomorrow" }));
    });
    expect(screen.getByText("Bee6 is busy with today's notes. Try again in a few seconds.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    const btn = screen.getByRole("button", { name: "Jump to tomorrow" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(postDemoNextDay).toHaveBeenCalledTimes(1); // no retry tap
    expect(refetchConfig.mock.calls.length).toBe(refetchesBefore);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refetchConfig.mock.calls.length).toBe(refetchesBefore + 1); // re-polled by itself
    // the re-read says the jump is allowed again: the button is back, the busy line is gone
    expect((screen.getByRole("button", { name: "Jump to tomorrow" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Bee6 is busy with today's notes. Try again in a few seconds.")).toBeNull();
  });

  describe("the open-session card matches the page's OpenSessionView", () => {
    const open = (closing_reached: boolean) => ({ session_id: "00000000-0000-4000-8000-000000000001", started_at_ms: 1, closing_reached, auto_stop_at_ms: 2 });
    it("closing reached: End today, no Cancel", () => {
      pathname = "/capture";
      act(() => publishCaptureBridge(bridge({ phase: "open_session", profile: profile({ open_session: open(true), closing_reached: true }) })));
      renderGuide();
      openGuide();
      expect(screen.getByRole("heading", { name: "Tap End today" })).toBeTruthy();
      expect(document.body.textContent).toMatch(/Closing time has passed\. Tap End today to start the 60-minute debrief/);
      expect(document.body.textContent).toMatch(/NEXT/);
      expect(document.body.textContent).not.toMatch(/Cancel today/);
    });
    it("not reached: Cancel today, no End", () => {
      pathname = "/capture";
      act(() => publishCaptureBridge(bridge({ phase: "open_session", profile: profile({ open_session: open(false) }) })));
      renderGuide();
      openGuide();
      expect(screen.getByRole("heading", { name: "Today's session was interrupted" })).toBeTruthy();
      expect(document.body.textContent).toMatch(/Tap Cancel today on the screen/);
      expect(document.body.textContent).not.toMatch(/End today/);
    });
  });
});

// R-25 R7: the stage with the page context, and R12: the paired card after /pair reports the device as paired.
describe("R-25 contracts: supervisor stage 2 and the paired card", () => {
  const dayOne = { day: 1, days_done: 1, proposals_with_content: 0, feasible: 0, owner_decided: 0 };
  const stageText = () => screen.getByRole("button", { name: /Open the judge guide/ }).textContent;

  it("stays at STAGE 2 on every supervisor page after day 1, with the visited flag already stored", async () => {
    window.localStorage.setItem(SUPERVISOR_SEEN_KEY, "1");
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ data: dayOne }), { status: 200 }));
    for (const route of ["/day", "/proposals", "/sop", "/reviews", "/devices"]) {
      cleanup();
      pathname = route;
      seedWeb("supervisor");
      renderGuide();
      await waitFor(() => expect(fetch).toHaveBeenCalled());
      await act(async () => {});
      expect(stageText(), route).toContain("STAGE 2 OF 5");
    }
  });

  it("the same progress on the staff phone with the visited flag moves on to STAGE 3", async () => {
    window.localStorage.setItem(SUPERVISOR_SEEN_KEY, "1");
    pathname = "/capture";
    act(() => publishCaptureBridge(bridge({ profile: profile({ day: 2, days_done: 1 }) })));
    renderGuide();
    expect(stageText()).toContain("STAGE 3 OF 5");
  });

  it("the pair card says Fill in the code until the paired checklist reports, then points at the listening page (and not for another route)", () => {
    pathname = "/pair";
    renderGuide();
    expect(stageText()).toContain("Fill in the demo code");
    act(() => void publishPairDone());
    expect(stageText()).toContain("Open the listening page");
    openGuide();
    expect(screen.getByRole("heading", { name: "Open the listening page" })).toBeTruthy();
    // the NEXT kicker and the bold button name are drawn by the card chrome, not by the card strings
    expect(screen.getByText("NEXT")).toBeTruthy();
    expect(screen.getByText("Open the listening page", { selector: "b" })).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "P" && /^Tap Open the listening page\. Then tap Start and read the script cards that appear in this guide\.$/.test(el.textContent ?? ""))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fill in/ })).toBeNull();
  });

  it("the paired signal is dropped when the route leaves /pair, so an unpaired return shows the code card again", () => {
    pathname = "/pair";
    const { rerender } = renderGuide();
    act(() => void publishPairDone());
    expect(stageText()).toContain("Open the listening page");
    pathname = "/sign-in";
    rerender(
      <LangProvider initial="en">
        <JudgeGuide config={CONFIG} />
      </LangProvider>,
    );
    pathname = "/pair";
    rerender(
      <LangProvider initial="en">
        <JudgeGuide config={CONFIG} />
      </LangProvider>,
    );
    expect(stageText()).toContain("Fill in the demo code");
  });
});

describe("R-25 T6: the board chrome (handle, web panel, Do this now)", () => {
  it("the web panel on the owner home: stage label, kicker + STAGE chip in the header, the first Do this now row done once both proposals are feasible", async () => {
    wide = true;
    pathname = "/home";
    seedWeb("owner");
    claims = { role: "owner", outlet_id: "sbx-1", demo_exp_ms: Date.now() + 3_600_000 };
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ data: { day: 3, days_done: 3, proposals_with_content: 2, feasible: 2, owner_decided: 0 } }), { status: 200 }),
    );
    renderGuide();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {});
    const pill = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(pill.textContent).toContain("STAGE 5 OF 5");
    fireEvent.click(pill);
    const panel = screen.getByRole("complementary", { name: "Judge guide" });
    expect(within(panel).getByText("STAGE 5 OF 5")).toBeTruthy();
    expect(within(panel).getByText("Owner · approve")).toBeTruthy();
    const rows = within(within(panel).getByRole("list", { name: "Do this now" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("done");
    expect(rows[1]!.getAttribute("aria-current")).toBe("step");
    expect(rows[2]!.textContent).toContain("not yet");
  });

  it("the handle's day clock is a .b6-clock chip beside the chevron on the capture pages, never part of the title", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(bridge({ phase: "ready", profile: profile({ day: 3, days_done: 2 }) })));
    renderGuide();
    const handle = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(handle.querySelector(".b6-clock")?.textContent).toBe("Day 3 of 3");
    expect(handle.querySelector(".b6-chip--teal")?.textContent).toBe("STAGE 3 OF 5");
    expect(handle.textContent).not.toMatch(/Tap Start, then read the cards · Day/);
    // open: the title line goes away, the clock stays (board: the open handle row is kicker + chip, clock, chevron)
    fireEvent.click(handle);
    expect(handle.textContent).not.toContain("Tap Start, then read the cards");
    expect(handle.querySelector(".b6-clock")).not.toBeNull();
  });

  it("all spoken: Jump to closing time shows the real closing time when the page publishes it", () => {
    pathname = "/capture";
    window.sessionStorage.setItem(scriptStorageKey("s1"), JSON.stringify({ spoken: ["d1-c1", "d1-c2", "d1-c3", "d1-c4", "d1-c5"] }));
    const b = bridge({ phase: "listening", sessionId: "s1", linesThisSession: 5, closeHm: "21:00" });
    act(() => publishCaptureBridge(b));
    renderGuide();
    openGuide();
    expect(screen.getByRole("button", { name: "Jump to closing time · 21:00" })).toBeTruthy();
  });
});
