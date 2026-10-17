// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readCaptureBridge } from "@/app/demo/guide-bridge";
import { axeViolations } from "@/lib/testing/axe";

/**
 * R-25 T5 (docs/tasks/R-25-ui-fidelity.md section 9.4 proof b): the page-2 staff screen on a sandbox, asserted by
 * role, text and document order, no snapshots. The behaviour tests stay in page.test.tsx; this file pins what the
 * restyle must not drift from: the DOM order, the one headline status, and what the pilot keeps.
 */

// A stable router object, as the real one: the page re-runs its config load whenever `router` changes identity.
const router = { replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/capture" }));
vi.mock("@/lib/auth/client/firebase-client", () => ({ getClientAuth: () => null }));
vi.mock("@/lib/capture/dev-mode", () => ({ isDevControlsEnabled: () => false }));

const fetchCaptureConfig = vi.fn<(auth: unknown) => Promise<unknown>>();
const ok = async () => ({ ok: true });
vi.mock("@/lib/capture/browser/client", () => ({
  readDeviceAuth: () => ({ deviceToken: "t", deviceId: "d" }),
  clearDeviceAuth: vi.fn(),
  deviceAuthHeaders: () => ({}),
  fetchCaptureConfig: (auth: unknown) => fetchCaptureConfig(auth),
  postSessionStart: ok,
  postSessionEnd: ok,
  postSessionDiscard: ok,
  postDemoClosing: async () => ({ ok: true, data: { closing_reached: true } }),
  postDemoNextDay: vi.fn(),
}));

let lastCallbacks: { onStatus?: (s: Record<string, unknown>) => void } | null = null;
vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: async (_a: unknown, _c: unknown, cb: { onStatus?: (s: Record<string, unknown>) => void }) => {
    lastCallbacks = cb;
    return { stop: vi.fn(async () => ({ droppedCount: 0, queuedCount: 0 })) };
  },
}));

vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-1111-1111-000000000001" });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  lastCallbacks = null;
});

const OPEN = { open: "08:00", close: "22:00" };
const WEEK = { sun: OPEN, mon: OPEN, tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN };
const PROFILE = {
  max_ms: 600_000,
  script_id: "bakery-v2",
  day: 1,
  days_total: 3,
  days_done: 0,
  closing_reached: false,
  open_session: null,
  next_day: { allowed: false, reason: "day_not_ended" },
};
const base = { timezone: "Asia/Jakarta", weekly_hours: WEEK, last_ended: null, capture_mode: "room" };
const MON_1000_WIB = "2026-10-12T03:00:00Z";

async function renderPage() {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(MON_1000_WIB));
  const { default: CapturePage } = await import("@/app/capture/page");
  return render(<CapturePage />);
}

/** The screen's own polite headline status (not the language switch's, not the upload block's). */
const headlineStatus = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[role='status'].b6-sr-only")).find((el) => el.closest("header") === null)!;

/** True when `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const inOrder = (...els: Element[]) => els.slice(1).every((el, i) => before(els[i]!, el));

describe("sandbox capture screen (R-25 T5): document order and landmarks", () => {
  it("idle: top bar, stage, h1, sub, day line, Start, note, sign-out link, upload block", async () => {
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    const { container } = await renderPage();
    const start = await screen.findByRole("button", { name: "Start" });
    const header = container.querySelector("header")!;
    const stage = container.querySelector(".b6-stage")!;
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    expect(stage.classList.contains("b6-stage--idle")).toBe(true);
    const h1 = screen.getByRole("heading", { level: 1, name: "Ready to open" });
    const sub = screen.getByText("Tap Start to begin listening. Staff keep serving customers as normal.");
    const day = screen.getByText("Day 1 of 3 · Mon 12 Oct");
    const note = screen.getByTestId("capture-notice");
    const signOut = screen.getByRole("button", { name: "Sign out" });
    const upload = screen.getByTestId("upload-status");
    expect(inOrder(header, stage, h1, sub, day, start, note, signOut, upload)).toBe(true);
    expect(screen.getByText("Demo Bakery · Outlet 1")).toBeTruthy();
    // the board's one note, and the pilot's privacy line, are the same single element
    expect(screen.getAllByText("Speech becomes short work notes. Audio is not kept.")).toHaveLength(1);
    expect(screen.queryByText("Not started")).toBeNull(); // no StatusBanner on a sandbox
    expect(screen.queryByText("Shop phone")).toBeNull(); // the old heading is gone from sight (sr-only only in the debrief)
    // the header has no Sign out: the footer link is the only one
    expect(within(header).queryByRole("button", { name: /Sign out/ })).toBeNull();
  });

  it("running before closing: stage, h1 Listening, two-line sub, day line, End (really disabled), red sign-out link, note", async () => {
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    const { container } = await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    const h1 = await screen.findByRole("heading", { level: 1, name: "Listening" });
    const stage = container.querySelector(".b6-stage")!;
    expect(stage.classList.contains("b6-stage--listening")).toBe(true);
    const sub1 = screen.getByText(/Focus on your customers\./);
    expect(sub1.textContent).toBe("Focus on your customers.We'll keep the notes.");
    const day = screen.getByText("Day 1 of 3 · Mon 12 Oct");
    const end = screen.getByRole("button", { name: "End · available at closing time (22:00)" }) as HTMLButtonElement;
    expect(end.disabled).toBe(true);
    const signOut = screen.getByRole("button", { name: "Sign out (cancels today's session)" });
    const note = screen.getByTestId("capture-notice");
    const upload = screen.getByTestId("upload-status");
    expect(inOrder(container.querySelector("header")!, stage, h1, sub1, day, end, signOut, note, upload)).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel session" })).toBeNull();
  });

  it("after Jump to closing time: the closing sub line, End today enabled, then a muted Sign out", async () => {
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 1, name: "Listening" });
    await act(async () => {
      readCaptureBridge()!.actions.jumpToClosing();
    });
    const end = (await screen.findByRole("button", { name: "End today" })) as HTMLButtonElement;
    expect(end.disabled).toBe(false);
    const sub = screen.getByText("Closing time has passed. Tap End when operations are done.");
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(inOrder(sub, end, signOut)).toBe(true);
    expect(screen.queryByRole("button", { name: /cancels today/ })).toBeNull();
  });

  it("End today opens the confirm as a labelled sheet over the screen: Not yet keeps listening, focus returns to End", async () => {
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 1, name: "Listening" });
    await act(async () => {
      readCaptureBridge()!.actions.jumpToClosing();
    });
    const end = await screen.findByRole("button", { name: "End today" });
    end.focus();
    fireEvent.click(end);
    const dialog = screen.getByRole("dialog", { name: "End today's operations?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("The 1-hour debrief starts now. This cannot be undone.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Not yet, keep going" }));
    // the screen is still there underneath (End did not unmount), and nothing ended
    expect(screen.getByRole("heading", { level: 1, name: "Listening" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "End today" }));
  });

  it("one polite status carries the headline; the stage itself is silent (decorative)", async () => {
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    const { container } = await renderPage();
    await screen.findByRole("button", { name: "Start" });
    const statuses = Array.from(container.querySelectorAll("[role='status']")).filter((el) => el.closest("header") === null);
    // the screen's own headline status, plus the upload block's: nothing for the orb, progress or time
    expect(statuses).toHaveLength(2);
    const headline = statuses.find((el) => el.getAttribute("data-testid") !== "upload-status")!;
    expect(headline.getAttribute("aria-live")).toBe("polite");
    expect(headline.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 1, name: "Listening" });
    expect(headline.textContent).toBe("Listening");
    expect(container.querySelector(".b6-stage")!.closest("[role='status']")).toBeNull();
  });

  it("the privacy notice is on the page in every sandbox state, exactly once: idle, running, and the debrief after End", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              data: { debrief: { business_date: "2026-10-12", ends_at_ms: Date.now() + 3_600_000 }, questions: [], preparing: true },
            }),
          }) as Response,
      ),
    );
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 1, name: "Listening" });
    expect(screen.getAllByTestId("capture-notice")).toHaveLength(1);
    await act(async () => {
      readCaptureBridge()!.actions.jumpToClosing();
    });
    fireEvent.click(await screen.findByRole("button", { name: "End today" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await screen.findByText("Preparing your questions");
    expect(screen.getAllByTestId("capture-notice")).toHaveLength(1);
    expect(screen.getByTestId("capture-notice").textContent).toBe("Speech becomes short work notes. Audio is not kept.");
    vi.unstubAllGlobals();
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-1111-1111-000000000001" });
  });

  it("a cancelled day is announced through the same single headline status, not a second region", async () => {
    fetchCaptureConfig.mockResolvedValue({
      ...base,
      last_ended: { business_date: "2026-10-12", end_reason: "discarded", debrief_ends_at_ms: null },
      demo_session: PROFILE,
    });
    const { container } = await renderPage();
    const h1 = await screen.findByRole("heading", { level: 1, name: "Session cancelled" });
    const headline = headlineStatus(container);
    expect(headline.textContent).toBe("Session cancelled");
    expect(h1).toBeTruthy();
    const regions = Array.from(container.querySelectorAll("[aria-live='polite']")).filter((el) => el.closest("header") === null);
    expect(regions).toHaveLength(2); // this one and the upload block's
  });

  it("has no axe violations idle or listening (one h1, labelled controls, the decorative stage hidden)", async () => {
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    const { container } = await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 1, name: "Listening" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a mic problem keeps the page honest: the h1 says so, the help line shows, the orb stays idle, and it is announced", async () => {
    fetchCaptureConfig.mockResolvedValue({ ...base, demo_session: PROFILE });
    const { container } = await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByRole("heading", { level: 1, name: "Listening" });
    act(() =>
      lastCallbacks?.onStatus?.({
        state: "mic_error",
        queuedCount: 0,
        lastUploadHttpStatus: null,
        micError: "denied",
        droppedCount: 0,
        lostSinceSuccess: false,
        headFailedAttempts: 0,
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "Microphone problem · not listening" });
    expect(screen.getAllByText("Check the microphone permission in the browser, then try again.").length).toBeGreaterThan(0);
    expect(container.querySelector(".b6-stage")!.classList.contains("b6-stage--idle")).toBe(true);
    const headline = headlineStatus(container);
    expect(headline.textContent).toContain("Microphone problem · not listening");
  });
});

describe("pilot capture screen (R-25 T5): unchanged", () => {
  it("keeps the status banner, the old heading and the Cancel session button, and has no sign-out link", async () => {
    fetchCaptureConfig.mockResolvedValue(base);
    await renderPage();
    const start = await screen.findByRole("button", { name: "Start" });
    expect(screen.getByRole("heading", { level: 1, name: "Shop phone" })).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy(); // StatusBanner
    expect(screen.queryByText("Demo Bakery · Outlet 1")).toBeNull();
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Cancel session" })).toBeTruthy();
    expect(screen.getByTestId("capture-notice").textContent).toBe("Speech becomes short work notes. Audio is not kept.");
  });
});
