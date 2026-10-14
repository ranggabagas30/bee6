// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { FRESH_DEMO_SESSION, type DemoSessionProfile } from "@/lib/capture/contract";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { DEMO_STATE_KEY } from "@/app/demo/demo-client";
import { publishCaptureBridge, type CaptureBridge, type CaptureBridgeState } from "@/app/demo/guide-bridge";
import { SHEET_RESERVE_PX, SUPERVISOR_SEEN_KEY, scriptStorageKey } from "@/app/demo/JudgeGuide";
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
vi.mock("@/lib/auth/client/firebase-client", () => ({
  getClientAuth: () => ({ currentUser: { getIdToken } }),
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
    state: { profile: profile(), phase: "ready", sessionId: null, linesThisSession: 0, closingBusy: false, closingError: null, micTrouble: false, ...state },
    actions: { jumpToClosing, refetchConfig },
  };
}
const openGuide = () => fireEvent.click(screen.getByRole("button", { name: /Open the judge guide/ }));

beforeEach(() => {
  pathname = "/";
  wide = false;
  stubMatchMedia();
  vi.stubGlobal("localStorage", createMemoryStorage());
  vi.stubGlobal("sessionStorage", createMemoryStorage());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { day: 2, days_done: 2, proposals_with_content: 0, feasible: 0, owner_decided: 0 } }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  publishCaptureBridge(null);
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shell: collapsed by default, phone sheet vs laptop pill, one language", () => {
  it("on / renders the entry card inside a collapsed sheet; the handle names the stage; the body is hidden until a tap", () => {
    renderGuide();
    const region = screen.getByRole("region", { name: "Judge guide" });
    const handle = within(region).getByRole("button", { name: /Open the judge guide/ });
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.textContent).toContain("JUDGE GUIDE · STAGE 1 OF 5");
    expect(handle.textContent).toContain("Welcome, judge");
    expect((screen.getByText(/About 20 minutes/).closest(".b6-sheet__body") as HTMLElement).hidden).toBe(true);
    openGuide();
    expect((screen.getByText(/About 20 minutes/).closest(".b6-sheet__body") as HTMLElement).hidden).toBe(false);
    expect(screen.getByRole("heading", { name: "Welcome, judge" })).toBeTruthy();
    expect(screen.getByText(/About 20 minutes/)).toBeTruthy();
    expect(screen.getByText("To change role later: sign out, then pick again.")).toBeTruthy();
    expect(screen.getByText("Staff · day 1")).toBeTruthy();
    expect(screen.getByText("Owner · approve")).toBeTruthy();
  });

  it("from 900 px it is a pill top-right that opens a side panel", () => {
    wide = true;
    renderGuide();
    const pill = screen.getByRole("button", { name: /Open the judge guide/ });
    expect(pill.className).toContain("b6-panel-pill");
    expect(pill.textContent).toContain("Judge guide · Stage 1 of 5");
    fireEvent.click(pill);
    expect(screen.getByRole("complementary", { name: "Judge guide" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Welcome, judge" })).toBeTruthy();
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
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Set up the staff phone");
  });

  it("ID mode shows the (provisional) Bahasa chrome and the 'Bahasa coming soon' note, never both languages at once", () => {
    renderGuide("id");
    fireEvent.click(screen.getByRole("button", { name: /Buka panduan juri/ }));
    expect(screen.getByText("Bahasa segera hadir; kartu ditampilkan dalam bahasa Inggris.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your journey" })).toBeNull();
    expect(screen.getByRole("region", { name: "Perjalanan Anda" })).toBeTruthy();
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
    expect(screen.getByText(/Tap Fill in 000000, then Set up/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fill in 000000" }));
    expect((screen.getByLabelText("6-digit code") as HTMLInputElement).value).toBe("000000");
    expect(screen.getByText("Filled in. Tap Set up.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement).disabled).toBe(false);
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
    openGuide();
    expect(screen.getByText("Card 1 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Opening" })).toBeTruthy();
    expect(screen.getByText(/Good morning. I am opening the shop now/)).toBeTruthy();
    expect(screen.queryByText(/The first tray of egg tarts/)).toBeNull();
    const spoken = screen.getByRole("button", { name: "I have spoken this" }) as HTMLButtonElement;
    expect(spoken.disabled).toBe(true);
    expect(screen.getByText("Waiting for Bee6 to hear this card…")).toBeTruthy();
    expect(screen.getByText("Locked until all 5 cards are spoken (0 of 5 done).")).toBeTruthy();
    act(() => publishCaptureBridge(listening(1)));
    expect((screen.getByRole("button", { name: "I have spoken this" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "I have spoken this" }));
    expect(screen.getByText("Card 2 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "First bake" })).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("First bake");
    expect(screen.getByText("Locked until all 5 cards are spoken (1 of 5 done).")).toBeTruthy();
    // the lines heard on card 1 do not count for card 2
    expect((screen.getByRole("button", { name: "I have spoken this" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Card 2 of 5");
    // the live region announces the new card; the "Previous card" link shows card 1 read-only and returns
    fireEvent.click(screen.getByRole("button", { name: "‹ Previous card (re-read only)" }));
    expect(screen.getByText(/Good morning. I am opening the shop now/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I have spoken this" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to card 2" }));
    expect(screen.getByRole("heading", { name: "First bake" })).toBeTruthy();
  });

  it("the phone-call card needs 1 heard line like every other card; the speaker tags are shown, never spoken", () => {
    pathname = "/capture";
    window.sessionStorage.setItem(scriptStorageKey("s2"), JSON.stringify({ spoken: ["d2-c1", "d2-c2"] }));
    act(() => publishCaptureBridge(bridge({ phase: "listening", sessionId: "s2", linesThisSession: 7, profile: profile({ day: 2 }) })));
    renderGuide();
    openGuide();
    expect(screen.getByText("Card 3 of 5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "A phone order" })).toBeTruthy();
    expect(screen.getAllByText("Staff").length).toBe(3);
    expect((screen.getByRole("button", { name: "I have spoken this" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => publishCaptureBridge(bridge({ phase: "listening", sessionId: "s2", linesThisSession: 8, profile: profile({ day: 2 }) })));
    expect((screen.getByRole("button", { name: "I have spoken this" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("progress survives a reload (sessionStorage per session) and a new session starts at card 1", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(listening(1)));
    const { unmount } = renderGuide();
    openGuide();
    fireEvent.click(screen.getByRole("button", { name: "I have spoken this" }));
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
    fireEvent.click(screen.getByRole("button", { name: "I have spoken this" }));
    expect(screen.getByRole("heading", { name: "All 5 cards are spoken" })).toBeTruthy();
    expect(screen.queryByText(/Locked until/)).toBeNull();
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
    expect(screen.getByRole("alert").textContent).toBe("Bee6 has not heard enough yet (3 of 5). Wait a few seconds for the last card to upload, then try again.");
    act(() => publishCaptureBridge(bridge({ phase: "closing", sessionId: "s1", linesThisSession: 5 })));
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Tap End today");
    // a later session (day 2) starts at card 1: the all-spoken state belongs to the session that spoke the cards
    act(() => publishCaptureBridge(listening(0, "s-day2")));
    expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Read this card aloud");
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
  });
});

describe("/capture: the debrief cards and Jump to tomorrow (plan 4.4, 7.2)", () => {
  const debrief = (next_day: DemoSessionProfile["next_day"], phase: CaptureBridgeState["phase"] = "debrief_question", day: 1 | 2 | 3 = 1) =>
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
    act(() => publishCaptureBridge(debrief({ allowed: false, reason: "busy" })));
    expect(refetchConfig).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refetchConfig).toHaveBeenCalledTimes(4);
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refetchConfig).toHaveBeenCalledTimes(4); // no poll once the jump is allowed
    // the debrief's end (timed out or PR-3's done flag) refetches once more, so Start / the lock line are current
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_done")));
    expect(refetchConfig).toHaveBeenCalledTimes(5);
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
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_question", 2)));
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

  it("the debrief cards are day-aware: day 1 says look around as Supervisor first and never mentions the phone order; day 2 keeps the phone-order and after-day-3 wording", () => {
    pathname = "/capture";
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_done", 1)));
    renderGuide();
    openGuide();
    expect(screen.getByRole("heading", { name: "Today is done" })).toBeTruthy();
    expect(screen.getByText(/After day 1, you can sign out and look around as Supervisor first/)).toBeTruthy();
    expect(screen.queryByText(/After day 3, sign out and continue as Supervisor/)).toBeNull();
    expect(screen.getByRole("button", { name: "Jump to tomorrow" })).toBeTruthy();
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_done", 2)));
    expect(screen.queryByText(/After day 1/)).toBeNull();
    expect(screen.getByText(/After day 3, sign out and continue as Supervisor/)).toBeTruthy();
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_question", 1)));
    openGuide(); // a card change collapses the phone sheet
    expect(screen.getByRole("heading", { name: "Answer what really happened" })).toBeTruthy();
    expect(screen.queryByText(/phone order/i)).toBeNull();
    act(() => publishCaptureBridge(debrief({ allowed: true, reason: null }, "debrief_question", 2)));
    expect(screen.getByText(/The phone order did happen, so answer Yes/)).toBeTruthy();
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
  it("supervisor on /day: fetches the progress with the ID token, sets the visited flag, and the stage moves to Staff days 2-3", async () => {
    pathname = "/day";
    seedWeb("supervisor");
    vi.mocked(fetch).mockImplementation(async (url) => {
      expect(String(url)).toBe("/api/v1/demo/progress");
      return new Response(JSON.stringify({ data: { day: 1, days_done: 1, proposals_with_content: 0, feasible: 0, owner_decided: 0 } }), { status: 200 });
    });
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("STAGE 3 OF 5"));
    expect(window.localStorage.getItem(SUPERVISOR_SEEN_KEY)).toBe("1");
    openGuide();
    expect(screen.getByRole("heading", { name: "The day record" })).toBeTruthy();
    expect(screen.getByText(/fresh egg tarts question under Customer service/)).toBeTruthy();
  });

  it("supervisor on /proposals after 2 days: Ask Bee6; owner on /proposals: the approvals card; /home: the owner card with no reset control registered yet", async () => {
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
    cleanup();
    pathname = "/home";
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: /Open the judge guide/ }).textContent).toContain("Owner home"));
    openGuide();
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
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
