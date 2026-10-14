// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEBRIEF_DONE_FLAG_KEY, DEBRIEF_DONE_SUMMARY_KEY } from "@/lib/debrief/constants";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * /capture (R-P1 rewrite): Mulai, Selesai and Batalkan replace the old
 * opening/closing auto-gate (UX-03 §5.4-§5.6, technical spec §8). A session
 * only ever starts on a Mulai tap and only ever stops on Selesai, Batalkan or
 * dev-mode Pause/Stop — never automatically at an opening or closing time.
 */

const replace = vi.fn();
const router = { replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const isDevControlsEnabled = vi.fn(() => false);
vi.mock("@/lib/capture/dev-mode", () => ({
  isDevControlsEnabled: () => isDevControlsEnabled(),
}));

const readDeviceAuth = vi.fn<() => { deviceToken: string; deviceId: string } | null>(
  () => null,
);
const fetchCaptureConfig = vi.fn<(auth: unknown) => Promise<unknown>>();
const postSessionStart = vi.fn<
  (auth: unknown, body: unknown) => Promise<{ ok: boolean; status?: number; code?: string }>
>(async () => ({ ok: true }));
const postSessionEnd = vi.fn<
  (auth: unknown, id: string, body: unknown) => Promise<{ ok: boolean; status?: number; code?: string }>
>(async () => ({ ok: true }));
const postSessionDiscard = vi.fn<
  (auth: unknown, id: string, body: unknown) => Promise<{ ok: boolean; status?: number; code?: string }>
>(async () => ({ ok: true }));
// R-19 PR-4a: "Jump to closing time" (sandbox only). Success by default; a test overrides it for the 409 branches.
const postDemoClosing = vi.fn<
  (auth: unknown, id: string) => Promise<{ ok: boolean; status?: number; code?: string; details?: unknown }>
>(async () => ({ ok: true, data: { closing_reached: true } }) as never);

// R-19 PR-4b: the local demo sign-out removes the device pair (no server call).
const clearDeviceAuth = vi.fn();

vi.mock("@/lib/capture/browser/client", () => ({
  readDeviceAuth: () => readDeviceAuth(),
  clearDeviceAuth: () => clearDeviceAuth(),
  deviceAuthHeaders: () => ({}),
  fetchCaptureConfig: (auth: unknown) => fetchCaptureConfig(auth),
  postSessionStart: (auth: unknown, body: unknown) => postSessionStart(auth, body),
  postSessionEnd: (auth: unknown, id: string, body: unknown) => postSessionEnd(auth, id, body),
  postSessionDiscard: (auth: unknown, id: string, body: unknown) =>
    postSessionDiscard(auth, id, body),
  postDemoClosing: (auth: unknown, id: string) => postDemoClosing(auth, id),
}));

interface FakeCallbacks {
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
}
interface FakeSession {
  stop: ReturnType<typeof vi.fn>;
}
const fakeSessions: FakeSession[] = [];
/** The callbacks of the most recent startCaptureSession call (to push engine events into the page). */
let lastCallbacks: FakeCallbacks | null = null;
/**
 * A stuck upload: the fake stop() then settles only at its `drainMs` bound (5 s unless the caller passes one), the
 * way the real session.ts stop() does, so a test can prove the bound the page actually gets.
 */
let holdStops = false;
/** The engine's dropped count the fake stop() reports (a number only). */
let fakeDroppedCount = 0;
const startCaptureSession = vi.fn(
  async (
    _auth: unknown,
    _config: unknown,
    cb: FakeCallbacks,
    _sessionId?: string,
  ): Promise<FakeSession> => {
    const session: FakeSession = {
      stop: vi.fn((options?: { drainMs?: number }) =>
        holdStops
          ? new Promise<{ droppedCount: number }>((resolve) => {
              setTimeout(() => resolve({ droppedCount: fakeDroppedCount }), options?.drainMs ?? 5_000);
            })
          : Promise.resolve({ droppedCount: fakeDroppedCount }),
      ),
    };
    fakeSessions.push(session);
    lastCallbacks = cb;
    cb.onEvent?.({ type: "state_changed", state: "listening", queuedCount: 0 });
    return session;
  },
);
vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: (
    auth: unknown,
    config: unknown,
    cb: FakeCallbacks,
    sessionId?: string,
  ) => startCaptureSession(auth, config, cb, sessionId),
}));

let uuidCounter = 0;
// Re-installed after every test: the debrief describes below call `vi.unstubAllGlobals()` to drop their fetch stub,
// which would otherwise also drop this one for every later test (the outer hook runs after the inner ones).
function stubCrypto() {
  vi.stubGlobal("crypto", {
    randomUUID: () => `11111111-1111-1111-1111-${String(++uuidCounter).padStart(12, "0")}`,
  });
}
stubCrypto();

afterEach(() => {
  cleanup();
  stubCrypto();
  vi.clearAllMocks();
  vi.useRealTimers();
  readDeviceAuth.mockReturnValue(null);
  isDevControlsEnabled.mockReturnValue(false);
  fakeSessions.length = 0;
  lastCallbacks = null;
  holdStops = false;
  fakeDroppedCount = 0;
  uuidCounter = 0;
  postDemoClosing.mockImplementation(async () => ({ ok: true, data: { closing_reached: true } }) as never);
});

async function importCapturePage() {
  const { default: CapturePage } = await import("@/app/capture/page");
  return CapturePage;
}

/** Strict config shape (web-backend-rbac §6.6.2): no consent key, no opening/closing. */
function config(
  weekly: Record<string, { open: string; close: string } | null>,
  lastEnded: { business_date: string; end_reason: string; debrief_ends_at_ms: number | null } | null = null,
) {
  const closed = { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null };
  return {
    timezone: "Asia/Jakarta",
    weekly_hours: { ...closed, ...weekly },
    last_ended: lastEnded,
  };
}

/**
 * R-19: the full sandbox journey profile (lib/capture/contract.ts DemoSessionProfileSchema). The old two-key
 * `{max_ms, script_id}` shape no longer parses on the server, so the page fixtures carry the real one: a fresh
 * sandbox on day 1 of 3 with the 10-minute hard stop.
 */
const DEMO_PROFILE = {
  max_ms: 600_000,
  script_id: "bakery-v1",
  day: 1,
  days_total: 3,
  days_done: 0,
  closing_reached: false,
  open_session: null,
  next_day: { allowed: false, reason: "day_not_ended" },
};

function pinClock(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

async function renderReady(auth = { deviceToken: "t", deviceId: "d" }) {
  readDeviceAuth.mockReturnValue(auth);
  const CapturePage = await importCapturePage();
  return render(<CapturePage />);
}

describe("CapturePage idle state: the Mulai button (UX-03 §5.4)", () => {
  it("is enabled inside the Mulai window, with no note", async () => {
    // Wed 2026-09-30 10:00 WIB: inside 01:00-18:00 (close 22:00 - 4h).
    pinClock("2026-09-30T03:00:00Z");
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    await renderReady();
    const btn = await screen.findByRole("button", { name: "Start" });
    expect(btn.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("is disabled with the window-passed note after the cut-off", async () => {
    // Mon 2026-10-12 23:30 WIB: after the 18:00 cut-off (close 22:00 - 4h).
    pinClock("2026-10-12T16:30:00Z");
    fetchCaptureConfig.mockResolvedValue(
      config({
        sun: null,
        mon: { open: "08:00", close: "22:00" },
        tue: { open: "08:00", close: "22:00" },
      }),
    );
    await renderReady();
    const btn = await screen.findByRole("button", { name: "Start" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    await waitFor(() =>
      expect(
        screen.getByText(
          "The Start cut-off today passed at 18:00. Today is recorded as a day off. Next Start Tue 13 Oct at 01:00.",
        ),
      ).toBeTruthy(),
    );
  });

  it("a tap while disabled does nothing (no startCaptureSession call)", async () => {
    pinClock("2026-10-12T16:30:00Z");
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    const btn = await screen.findByRole("button", { name: "Start" });
    fireEvent.click(btn);
    await Promise.resolve();
    expect(startCaptureSession).not.toHaveBeenCalled();
    expect(postSessionStart).not.toHaveBeenCalled();
  });

  it("shows the idle-help line only when Mulai is offered", async () => {
    pinClock("2026-09-30T03:00:00Z");
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    await renderReady();
    await screen.findByRole("button", { name: "Start" });
    expect(screen.getByText("Tap Start to begin today's session.")).toBeTruthy();
  });
});

describe("CapturePage: tapping Mulai (UX-03 §5.4, web spec §6.6.3)", () => {
  async function renderOffered() {
    pinClock("2026-09-30T03:00:00Z"); // Wed 10:00 WIB, inside the window
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    await renderReady();
    return screen.findByRole("button", { name: "Start" });
  }

  it("success: posts the session start, then starts the engine and shows Listening", async () => {
    const btn = await renderOffered();
    fireEvent.click(btn);
    await waitFor(() => expect(postSessionStart).toHaveBeenCalledTimes(1));
    const [, body] = postSessionStart.mock.calls[0]!;
    expect(body).toMatchObject({ session_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  });

  it("the same client-generated session_id is sent to the start route and the engine", async () => {
    const btn = await renderOffered();
    fireEvent.click(btn);
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    const sentId = (postSessionStart.mock.calls[0]![1] as { session_id: string }).session_id;
    const [, , , engineSessionId] = startCaptureSession.mock.calls[0]!;
    expect(engineSessionId).toBe(sentId);
  });

  it("422 from the route never starts the engine, and shows the dictionary fallback (never raw text)", async () => {
    postSessionStart.mockResolvedValueOnce({ ok: false, status: 422, code: "VALIDATION_ERROR" });
    const btn = await renderOffered();
    fireEvent.click(btn);
    await waitFor(() => expect(postSessionStart).toHaveBeenCalledTimes(1));
    expect(startCaptureSession).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Could not process that. Try again.")).toBeTruthy());
  });

  it("409 from the route never starts the engine", async () => {
    postSessionStart.mockResolvedValueOnce({ ok: false, status: 409, code: "CONFLICT" });
    const btn = await renderOffered();
    fireEvent.click(btn);
    await waitFor(() => expect(postSessionStart).toHaveBeenCalledTimes(1));
    expect(startCaptureSession).not.toHaveBeenCalled();
  });

  it("a network failure (no response) still starts the engine (capture must not depend on the network)", async () => {
    postSessionStart.mockResolvedValueOnce({ ok: false, status: undefined, code: undefined });
    const btn = await renderOffered();
    fireEvent.click(btn);
    await waitFor(() => expect(postSessionStart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
  });

  it("double-tap while the start is in flight calls startCaptureSession once", async () => {
    let resolveStart: (v: { ok: true }) => void;
    postSessionStart.mockImplementationOnce(
      () => new Promise((resolve) => { resolveStart = resolve; }),
    );
    const btn = await renderOffered();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(postSessionStart).toHaveBeenCalledTimes(1));
    resolveStart!({ ok: true });
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
  });
});

describe("CapturePage running state: Selesai (UX-03 §5.5, technical spec §8.3 rule 4)", () => {
  async function renderRunning(startedIso: string) {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(startedIso));
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    const btn = await (async () => {
      await renderReady();
      return screen.findByRole("button", { name: "Start" });
    })();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  }

  it("before start+4h: shows the 'from HH:MM' note, no End button", async () => {
    await renderRunning("2026-10-12T01:00:00Z"); // Mon 08:00 WIB
    expect(screen.queryByRole("button", { name: "End" })).toBeNull();
    expect(screen.getByText("You can tap End from 12:00.")).toBeTruthy();
  });

  it("at start+4h: the End button appears", async () => {
    await renderRunning("2026-10-12T01:00:00Z");
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
  });

  it("tapping End opens the confirm panel; Belum, lanjut closes it with nothing changed", async () => {
    await renderRunning("2026-10-12T01:00:00Z");
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(screen.getByText("End today's operations?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not yet, keep going" }));
    expect(screen.queryByText("End today's operations?")).toBeNull();
    expect(postSessionEnd).not.toHaveBeenCalled();
  });

  it("Ya, selesai posts the end, stops the engine and shows the Ended state", async () => {
    await renderRunning("2026-10-12T01:00:00Z");
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    const [, sessionId, body] = postSessionEnd.mock.calls[0]!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({ end_reason: "selesai" });
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Ended")).toBeTruthy());
    expect(screen.queryByText("Listening")).toBeNull();
  });

  it("the confirm panel's next-Start date skips a closed weekday (technical spec §8.7)", async () => {
    // Mon session, Tue closed, Wed open: the next-day note must say Wed, not Tue.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z")); // Mon 08:00 WIB
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: null, wed: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(
      screen.getByText("The 1-hour debrief starts now. This cannot be undone. You can tap Start again Wed 14 Oct at 01:00."),
    ).toBeTruthy();
  });
});

describe("CapturePage running state: Batalkan (UX-03 §5.6, technical spec §8.9)", () => {
  async function renderRunning() {
    pinClock("2026-10-12T01:00:00Z"); // Mon 08:00 WIB
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  }

  it("Ya, hapus sesi is disabled for the first second after the panel opens", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    await renderRunning();
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    const deleteBtn = screen.getByRole("button", {
      name: "Yes, delete session",
    }) as HTMLButtonElement;
    expect(deleteBtn.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deleteBtn.disabled).toBe(false);
  });

  it("Tetap simpan sesi closes the panel with nothing changed", async () => {
    await renderRunning();
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the session" }));
    expect(screen.queryByText(/Cancel the session started at/)).toBeNull();
    expect(postSessionDiscard).not.toHaveBeenCalled();
    expect(screen.getByText("Listening")).toBeTruthy();
  });

  it("Ya, hapus sesi posts the discard, stops the engine and shows Session cancelled", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    await renderRunning();
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
    await waitFor(() => expect(postSessionDiscard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Session cancelled")).toBeTruthy());
    expect(screen.queryByText("Listening")).toBeNull();
  });

  it("the panel closes itself after 15s with no tap, and nothing changes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    await renderRunning();
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(screen.queryByText(/Cancel the session started at/)).toBeNull();
    expect(postSessionDiscard).not.toHaveBeenCalled();
    expect(screen.getByText("Listening")).toBeTruthy();
  });

  it("202 (cleanup pending) is treated the same as 200", async () => {
    postSessionDiscard.mockResolvedValueOnce({ ok: true });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    await renderRunning();
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
    await waitFor(() => expect(screen.getByText("Session cancelled")).toBeTruthy());
  });

  it("the cancel panel's next-Start date skips a closed weekday (technical spec §8.7)", async () => {
    // Mon session, Tue closed, Wed open: the body text must say Wed, not Tue.
    pinClock("2026-10-12T01:00:00Z"); // Mon 08:00 WIB
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: null, wed: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    expect(
      screen.getByText(
        "Its audio and notes will be deleted. This cannot be undone. Today does not count. You can tap Start again Wed 14 Oct at 01:00.",
      ),
    ).toBeTruthy();
  });
});

describe("CapturePage: auto-stop enforcement (technical spec §8.7)", () => {
  async function renderRunning(startedIso: string) {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(startedIso));
    // Mon 08:00-22:00 WIB: close 22:00 WIB, auto-stop = close + 1h = 23:00 WIB.
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  }

  it("auto-stops on the next 30s tick once past close(D)+1h, with no confirm dialog", async () => {
    await renderRunning("2026-10-12T01:00:00Z"); // Mon 08:00 WIB
    // Mon 08:00 WIB -> auto-stop at Mon 23:00 WIB is 15h away; advance one
    // extra tick past it so a 30s-tick boundary lands strictly after it.
    await vi.advanceTimersByTimeAsync(15 * 60 * 60_000 + 30_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    const [, sessionId, body] = postSessionEnd.mock.calls[0]!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({ end_reason: "auto_stop" });
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Ended automatically at 23:00")).toBeTruthy());
    expect(screen.queryByText("Listening")).toBeNull();
    expect(screen.queryByText("End today's operations?")).toBeNull();
  });

  it("does not auto-stop well before close(D)+1h", async () => {
    await renderRunning("2026-10-12T01:00:00Z"); // Mon 08:00 WIB
    // Past the 4h Selesai cut-off, but 11h short of the 15h auto-stop mark.
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    expect(postSessionEnd).not.toHaveBeenCalled();
    expect(screen.getByText("Listening")).toBeTruthy();
  });
});

// R-19 PR-3 (§6.3): on a sandbox the debrief opens itself right after End, so the questions route is
// answered here with the server's `preparing` and no question yet (the labels land 2-4 min later).
function stubPreparingQuestions() {
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
}
afterEach(() => vi.unstubAllGlobals());

// The done screen is reached by the completion flag (what DebriefFlow writes on entering `done`), seeded for
// the debrief the page opens at End: endsAtMs = the End instant (fake clock, frozen) + 1 h.
const DEBRIEF_MS = 3_600_000;
// This test environment has no usable `window.localStorage`, so the flag goes into an in-memory Storage
// installed on `window` for the test (removed again by `vi.unstubAllGlobals()`).
function seedDoneFlag(endsAtMs: number, answered = 2, skipped = 1) {
  const mem = new Map<string, string>([
    [DEBRIEF_DONE_FLAG_KEY, String(endsAtMs)],
    [DEBRIEF_DONE_SUMMARY_KEY, JSON.stringify({ answered, skipped })],
  ]);
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  } as Storage;
  vi.stubGlobal("localStorage", storage);
}

describe("CapturePage with the R-18 demo profile (sandbox only)", () => {
  const MON_2230_WIB = "2026-10-12T15:30:00Z"; // past the pilot's 18:00 Mulai cut-off
  const demoConfig = (extra: Record<string, unknown> = {}) => ({
    ...config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    capture_mode: "room",
    demo_session: DEMO_PROFILE,
    ...extra,
  });
  async function renderDemoRunning(iso = MON_2230_WIB, extra: Record<string, unknown> = {}) {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(iso));
    fetchCaptureConfig.mockResolvedValue(demoConfig(extra));
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  }
  /** Plan 5.4/5.5: the drawer's last-card Finish is the phone's "Jump to closing time" until PR-5 moves it to the guide. */
  async function reachClosing() {
    await screen.findByRole("region", { name: "Demo script" });
    for (let i = 0; i < 9; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await waitFor(() => expect(postDemoClosing).toHaveBeenCalledTimes(1));
    return (await screen.findByRole("button", { name: "End today" })) as HTMLButtonElement;
  }
  const END_LOCKED = "End · available at closing time (22:00)";

  it("Mulai is offered at 22:30 WIB, where the same config without the profile says the cut-off passed", async () => {
    pinClock(MON_2230_WIB);
    fetchCaptureConfig.mockResolvedValue(demoConfig());
    await renderReady();
    const btn = await screen.findByRole("button", { name: "Start" });
    expect(btn.getAttribute("aria-disabled")).not.toBe("true");
  });

  // Plan 5.5: End is always rendered on a sandbox, really disabled (not only aria-disabled) with the exact
  // label until "Jump to closing time", then enabled as "End today". No "from HH:MM" note either way.
  it("End is on screen at once, disabled with the closing-time label, not after 4 hours", async () => {
    await renderDemoRunning("2026-10-12T03:00:00Z"); // 10:00 WIB: the pilot would say "from 14:00"
    const end = screen.getByRole("button", { name: END_LOCKED }) as HTMLButtonElement;
    expect(end.disabled).toBe(true);
    expect(end.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByText(/You can tap End from/)).toBeNull();
    expect(screen.queryByRole("button", { name: "End today" })).toBeNull();
    fireEvent.click(end);
    expect(screen.queryByText("End today's operations?")).toBeNull();
  });

  it("after the closing 200 the same button is enabled as 'End today' and opens the End dialog", async () => {
    await renderDemoRunning();
    const end = await reachClosing();
    expect(end.disabled).toBe(false);
    expect(postDemoClosing.mock.calls[0]![1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.queryByRole("button", { name: END_LOCKED })).toBeNull();
    fireEvent.click(end);
    expect(screen.getByText("End today's operations?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "selesai" });
  });

  it("closing 409 not_enough_speech {have, need}: the exact copy, End stays locked, a retry works", async () => {
    await renderDemoRunning();
    postDemoClosing.mockImplementationOnce(async () => ({
      ok: false,
      status: 409,
      code: "not_enough_speech",
      details: { have: 3, need: 5 },
    }));
    await screen.findByRole("region", { name: "Demo script" });
    for (let i = 0; i < 9; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Bee6 has not heard enough yet (3 of 5). Wait a few seconds for the last card to upload, then try again.",
      ),
    );
    expect((screen.getByRole("button", { name: END_LOCKED }) as HTMLButtonElement).disabled).toBe(true);
    expect(postSessionEnd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await screen.findByRole("button", { name: "End today" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closing failure without details (network, or another 409): the generic line, End stays locked", async () => {
    await renderDemoRunning();
    postDemoClosing.mockImplementationOnce(async () => ({ ok: false, status: undefined, code: undefined, details: null }));
    await screen.findByRole("region", { name: "Demo script" });
    for (let i = 0; i < 9; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not process that. Try again."));
    expect((screen.getByRole("button", { name: END_LOCKED }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("after Jump to closing time the sandbox no longer offers Cancel session (the server refuses it with 409 closing_reached)", async () => {
    await renderDemoRunning();
    expect(screen.getByRole("button", { name: "Cancel session" })).toBeTruthy();
    await reachClosing();
    expect(screen.queryByRole("button", { name: "Cancel session" })).toBeNull();
    expect(screen.getByRole("button", { name: "End today" })).toBeTruthy();
  });

  // Q6: "Day n of 3 · date" on the phone, sandbox only.
  it("shows 'Day 1 of 3 · Mon 12 Oct' before and during the session; the pilot shows no such line", async () => {
    pinClock(MON_2230_WIB);
    fetchCaptureConfig.mockResolvedValue(demoConfig());
    await renderReady();
    await screen.findByRole("button", { name: "Start" });
    expect(screen.getByText("Day 1 of 3 · Mon 12 Oct")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(screen.getByText("Day 1 of 3 · Mon 12 Oct")).toBeTruthy();
    cleanup();
    const { demo_session: _drop, ...pilot } = demoConfig();
    fetchCaptureConfig.mockResolvedValue(pilot);
    await renderReady();
    await screen.findByRole("button", { name: "Start" });
    expect(screen.queryByText(/Day \d of \d/)).toBeNull();
  });

  it("day 2 of 3 reads from the profile", async () => {
    pinClock(MON_2230_WIB);
    fetchCaptureConfig.mockResolvedValue(demoConfig({ demo_session: { ...DEMO_PROFILE, day: 2, days_done: 1 } }));
    await renderReady();
    await screen.findByRole("button", { name: "Start" });
    expect(screen.getByText("Day 2 of 3 · Mon 12 Oct")).toBeTruthy();
  });

  it("hard-stops at start + 10:00 with end_reason auto_stop and no confirm dialog (not at the 30 s tick)", async () => {
    await renderDemoRunning();
    await vi.advanceTimersByTimeAsync(9 * 60_000 + 58_000);
    expect(postSessionEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("End today's operations?")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Listening")).toBeNull());
  });

  it("a start after close + 1 h (23:10 WIB, close 22:00) is not stopped at once: nothing before 9:58, exactly one auto_stop at 10:00", async () => {
    await renderDemoRunning("2026-10-12T16:10:00Z"); // Mon 23:10 WIB
    await vi.advanceTimersByTimeAsync(9 * 60_000 + 58_000);
    expect(postSessionEnd).not.toHaveBeenCalled();
    expect(screen.getByText("Listening")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
  });

  it("the auto-stop never needs closing: End stays locked and the stop still fires", async () => {
    await renderDemoRunning();
    expect((screen.getByRole("button", { name: END_LOCKED }) as HTMLButtonElement).disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    expect(postDemoClosing).not.toHaveBeenCalled();
  });

  // R-19 PR-3 (§6.3): End hands straight over to the debrief; the entry card and Start never show on a sandbox.
  it("R-19: a finished demo day opens the debrief by itself (Preparing your questions), with no entry card and no Start button", async () => {
    stubPreparingQuestions();
    await renderDemoRunning();
    const end = await reachClosing();
    fireEvent.click(end);
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Answer questions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  // Plan 5.6 + tech-lead note: after End `idle.offered` is false on a sandbox, so the done slot (the debrief's
  // terminal summary, which renders `primary`) shows the locked line and never a Start button.
  it("a finished demo day's done slot renders no Start button: the unlock line, with no contradictory reason or hint line", async () => {
    stubPreparingQuestions();
    await renderDemoRunning();
    seedDoneFlag(Date.parse(MON_2230_WIB) + DEBRIEF_MS);
    const end = await reachClosing();
    fireEvent.click(end);
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Start unlocks tomorrow from 01:00")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByText("Preparing your questions")).toBeNull();
    // Right after End the reason can only be day_not_ended, which cannot be true while Start is locked: no
    // reason line and no jump hint (the jump is not allowed yet either).
    expect(screen.queryByText(/Run today first/)).toBeNull();
    expect(screen.queryByText("Use Jump to tomorrow in the judge guide")).toBeNull();
  });

  it("locked Start with next_day allowed points to the judge guide instead of a reason (done slot)", async () => {
    pinClock("2026-10-12T16:00:00Z"); // Mon 23:00 WIB, the day ended at 22:30
    const debriefEnds = Date.parse("2026-10-12T16:30:00Z");
    seedDoneFlag(debriefEnds);
    fetchCaptureConfig.mockResolvedValue(
      demoConfig({
        last_ended: { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: debriefEnds },
        demo_session: { ...DEMO_PROFILE, days_done: 1, next_day: { allowed: true, reason: null } },
      }),
    );
    await renderReady();
    await waitFor(() => expect(screen.getByText("Start unlocks tomorrow from 01:00")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getByText("Use Jump to tomorrow in the judge guide")).toBeTruthy();
    expect(screen.queryByText(/Run today first/)).toBeNull();
  });

  it("item 8: after End the sandbox never offers a 'tap Start again <date>' line", async () => {
    stubPreparingQuestions();
    await renderDemoRunning();
    fireEvent.click(await reachClosing());
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
    expect(screen.queryByText(/You can tap Start again/)).toBeNull();
  });

  // Plan 5.2: the page keeps `linesThisSession` from segment_accepted counts (reset on Start). It is observable
  // through the dev readout only; the wiring itself does not depend on dev mode.
  it("counts segment_accepted lines per session (dev readout), and the event channel is wired without dev mode", async () => {
    isDevControlsEnabled.mockReturnValue(true);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(MON_2230_WIB));
    fetchCaptureConfig.mockResolvedValue(demoConfig());
    await renderReady();
    // The dev panel has its own "Start" (a dev session, no Mulai bookkeeping); tap the page's Mulai button.
    const panel = await screen.findByTestId("dev-panel");
    await screen.findByText("Day 1 of 3 · Mon 12 Oct");
    const mulai = screen.getAllByRole("button", { name: "Start" }).find((b) => !panel.contains(b))!;
    fireEvent.click(mulai);
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    act(() => {
      lastCallbacks?.onEvent?.({ type: "segment_accepted", lines: 2 });
      lastCallbacks?.onEvent?.({ type: "segment_accepted", lines: 3 });
    });
    await waitFor(() => expect(screen.getByTestId("dev-readouts").textContent).toMatch(/Lines heard: 5/));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
    await waitFor(() => expect(postSessionDiscard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Start" }).some((b) => !panel.contains(b))).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: "Start" }).find((b) => !panel.contains(b))!);
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(screen.getByTestId("dev-readouts").textContent).toMatch(/Lines heard: 0/);
    cleanup();
    isDevControlsEnabled.mockReturnValue(false);
    await renderDemoRunning();
    expect(typeof lastCallbacks?.onEvent).toBe("function");
  });

  it("pilot: the same config without demo_session at 22:30 keeps Mulai disabled and shows no demo UI", async () => {
    pinClock(MON_2230_WIB);
    const { demo_session: _drop, ...pilot } = demoConfig();
    fetchCaptureConfig.mockResolvedValue(pilot);
    await renderReady();
    const btn = await screen.findByRole("button", { name: "Start" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("region", { name: "Demo script" })).toBeNull();
    expect(screen.queryByText(/Demo ends automatically/)).toBeNull();
    expect(screen.queryByText(/available at closing time/)).toBeNull();
  });

  it("pilot: a running session does not tick every second and does not auto-stop at 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z"));
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(postSessionEnd).not.toHaveBeenCalled();
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(postDemoClosing).not.toHaveBeenCalled();
  });
});

describe("CapturePage script drawer (R-18, sandbox only)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const MON_1000_WIB = "2026-10-12T03:00:00Z";
  const demoConfig = () => ({
    ...config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    capture_mode: "room",
    demo_session: DEMO_PROFILE,
  });
  async function renderDemoIdle() {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(MON_1000_WIB));
    fetchCaptureConfig.mockResolvedValue(demoConfig());
    await renderReady();
    const start = await screen.findByRole("button", { name: "Start" });
    await screen.findByRole("region", { name: "Demo script" }); // the drawer is a lazy chunk
    return start;
  }
  async function renderDemoRunning() {
    fireEvent.click(await renderDemoIdle());
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  }
  const goToLastCard = () => {
    for (let i = 0; i < 9; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
  };
  const END_LOCKED = "End · available at closing time (22:00)";
  /** First Finish = "Jump to closing time" (R-19 PR-4a); the End button then unlocks. */
  async function finishToClosing() {
    goToLastCard();
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await screen.findByRole("button", { name: "End today" });
  }

  it("9.T1 renders only with demo_session: the rules card and the Tap Start line before Mulai", async () => {
    await renderDemoIdle();
    const drawer = screen.getByRole("region", { name: "Demo script" });
    expect(within(drawer).getByText("Tap Start to begin. Nothing is recorded until you do.")).toBeTruthy();
  });

  it("the cards appear once Mulai is tapped, and Listening, End (locked) and Cancel session stay on the page", async () => {
    await renderDemoRunning();
    const drawer = screen.getByRole("region", { name: "Demo script" });
    expect(within(drawer).getByText("Card 1 of 10")).toBeTruthy();
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(screen.getByRole("button", { name: END_LOCKED })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel session" })).toBeTruthy();
    // the drawer is a sibling of the page content, not a wrapper: nothing is hidden or inert
    expect(drawer.contains(screen.getByRole("button", { name: END_LOCKED }))).toBe(false);
    expect(document.querySelector("[inert], [aria-hidden='true'] button")).toBeNull();
  });

  it("Finish on the last card is first 'Jump to closing time' (End unlocks), then the existing Selesai path: selesai, no confirm dialog, engine stopped", async () => {
    await renderDemoRunning();
    await finishToClosing();
    expect(postDemoClosing).toHaveBeenCalledTimes(1);
    expect(postSessionEnd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "selesai" });
    expect(screen.queryByText("End today's operations?")).toBeNull();
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("Done. Answer the debrief questions, then switch to Supervisor.")).toBeTruthy(),
    );
  });

  it("9.T5 a double tap on Finish makes one closing request, and a double tap after closing one end request", async () => {
    await renderDemoRunning();
    goToLastCard();
    const finish = screen.getByRole("button", { name: "Finish and end the day" });
    fireEvent.click(finish);
    fireEvent.click(finish);
    await screen.findByRole("button", { name: "End today" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(postDemoClosing).toHaveBeenCalledTimes(1);
    expect(postSessionEnd).not.toHaveBeenCalled();
    const finishAgain = screen.getByRole("button", { name: "Finish and end the day" });
    fireEvent.click(finishAgain);
    fireEvent.click(finishAgain);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("9.T6 the 10:00 auto-stop while on card 5 ends the drawer without a second end request", async () => {
    await renderDemoRunning();
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Card 5 of 10")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    await waitFor(() =>
      expect(screen.getByText("Done. Answer the debrief questions, then switch to Supervisor.")).toBeTruthy(),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Finish and end the day" })).toBeNull();
  });

  it("Finish at 9:59.5 with the end request still pending, then the 10:00 stop fires: exactly one end call", async () => {
    await renderDemoRunning();
    await vi.advanceTimersByTimeAsync(9 * 60_000 + 59_000 - 1_000); // 9:58, the page clock ticks each second
    await finishToClosing();
    await vi.advanceTimersByTimeAsync(1_500); // 9:59.5
    let release: (r: { ok: boolean }) => void = () => {};
    postSessionEnd.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await vi.advanceTimersByTimeAsync(2_000); // past the 10:00 stop while Finish is in flight
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "selesai" });
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("the End dialog's 'Yes, end' while the 10:00 stop is in flight makes no second end call", async () => {
    await renderDemoRunning();
    await finishToClosing();
    fireEvent.click(screen.getByRole("button", { name: "End today" }));
    let release: (r: { ok: boolean }) => void = () => {};
    postSessionEnd.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("End dialog opened at 9:58, auto-stop fires at 10:00, 'Yes, end' tapped during the round trip: ONE end call, the debrief opens itself", async () => {
    // R-19 PR-3 (§6.3): the sandbox debrief auto-opens after the auto-stop, so the questions route must answer.
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
    await renderDemoRunning();
    await finishToClosing();
    await vi.advanceTimersByTimeAsync(9 * 60_000 + 58_000);
    fireEvent.click(screen.getByRole("button", { name: "End today" }));
    expect(screen.getByText("End today's operations?")).toBeTruthy();
    let release: (r: { ok: boolean }) => void = () => {};
    postSessionEnd.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(2_500); // 10:00 passes: the auto-stop request is now in flight
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    const yes = screen.getByRole("button", { name: "Yes, end" }) as HTMLButtonElement;
    await waitFor(() => expect(yes.disabled).toBe(true));
    fireEvent.click(yes);
    await vi.advanceTimersByTimeAsync(500);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("End today's operations?")).toBeNull();
    await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
  });

  it("the countdown follows the page clock, in text", async () => {
    await renderDemoRunning();
    expect(screen.getByText("Demo ends automatically in 10:00")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(screen.getByText("Demo ends automatically in 8:59")).toBeTruthy();
  });

  it("item 4: collapsed by default before Start, open as soon as Start is tapped, collapsed again after Cancel session", async () => {
    await renderDemoIdle();
    expect(screen.getByRole("button", { name: "Show script" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Hide script" }).getAttribute("aria-expanded")).toBe("true");
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
    await waitFor(() => expect(postSessionDiscard).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Show script" })).toBeTruthy());
  });

  it("item 4: the drawer sits in the page flow AFTER the Listening banner, End and Cancel (never over them), and nothing above it is fixed", async () => {
    await renderDemoRunning();
    const drawer = screen.getByRole("region", { name: "Demo script" });
    const follows = (el: Element) => Boolean(el.compareDocumentPosition(drawer) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByText("Listening"))).toBe(true);
    expect(follows(screen.getByRole("button", { name: END_LOCKED }))).toBe(true);
    expect(follows(screen.getByRole("button", { name: "Cancel session" }))).toBe(true);
    for (let el: HTMLElement | null = screen.getByRole("button", { name: END_LOCKED }); el; el = el.parentElement) {
      expect(el.style.position).not.toBe("fixed");
    }
    expect(drawer.style.position).not.toBe("fixed");
  });

  it("item 7: right after Start the countdown reads 10:00, not 10:25, even when the page clock was 25 s stale", async () => {
    const start = await renderDemoIdle();
    vi.setSystemTime(new Date(Date.parse(MON_1000_WIB) + 25_000)); // 25 s pass; the 30 s tick has not fired
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(screen.getByText("Demo ends automatically in 10:00")).toBeTruthy();
    expect(screen.queryByText(/Demo ends automatically in 10:[1-5]/)).toBeNull();
  });

  it("Cancel session returns the drawer to the rules card and offers Mulai again", async () => {
    await renderDemoRunning();
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
    await waitFor(() => expect(postSessionDiscard).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("Tap Start to begin. Nothing is recorded until you do.")).toBeTruthy(),
    );
    const start = await screen.findByRole("button", { name: "Start" });
    expect(start.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("collapsing the drawer does not end or pause anything", async () => {
    await renderDemoRunning();
    fireEvent.click(screen.getByRole("button", { name: "Hide script" }));
    expect(screen.getByRole("button", { name: "Show script" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(postSessionEnd).not.toHaveBeenCalled();
  });

  it("pilot: no script drawer, and the page container style is the unchanged pilot style", async () => {
    pinClock(MON_1000_WIB);
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    const { container } = await renderReady();
    await screen.findByRole("button", { name: "Start" });
    expect(screen.queryByRole("region", { name: "Demo script" })).toBeNull();
    const main = container.querySelector("main")!;
    expect(main.getAttribute("style")).toBe(
      "max-width: 360px; margin: 0px auto; padding: 24px; font-family: system-ui, sans-serif;",
    );
  });
});

// ── R-19 PR-4b: demo sign-out (plan 5.7), the open-session view (5.7a) and the config re-fetch ──────────────
describe("CapturePage R-19 PR-4b (sandbox only)", () => {
  const MON_2230_WIB = "2026-10-12T15:30:00Z";
  const SID = "00000000-0000-4000-8000-000000000042";
  const STARTED = Date.parse(MON_2230_WIB) - 120_000;
  const open = (over: Record<string, unknown> = {}) => ({
    session_id: SID,
    started_at_ms: STARTED,
    closing_reached: false,
    auto_stop_at_ms: STARTED + 600_000,
    ...over,
  });
  const demoConfig = (profile: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    ...config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    capture_mode: "room",
    demo_session: { ...DEMO_PROFILE, ...profile },
    ...extra,
  });
  const pilotConfig = () => {
    const { demo_session: _drop, ...pilot } = demoConfig();
    return pilot;
  };
  async function startDemoSession() {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(MON_2230_WIB));
    fetchCaptureConfig.mockResolvedValue(demoConfig());
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  }
  async function reachClosing() {
    await screen.findByRole("region", { name: "Demo script" });
    for (let i = 0; i < 9; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await screen.findByRole("button", { name: "End today" });
  }
  /** Lets the page's awaited steps (the engine stop, then the sign-out) settle under the faked intervals. */
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

  describe("sign-out button", () => {
    it("is on the top bar of a sandbox device, and absent on the pilot", async () => {
      pinClock(MON_2230_WIB);
      fetchCaptureConfig.mockResolvedValue(pilotConfig());
      await renderReady();
      await screen.findByRole("button", { name: "Start" });
      expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
      cleanup();
      fetchCaptureConfig.mockResolvedValue(demoConfig());
      await renderReady();
      await screen.findByRole("button", { name: "Start" });
      expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    });

    it("no session: signs out at once, no dialog, no session route, the device pair is cleared, back to /", async () => {
      pinClock(MON_2230_WIB);
      fetchCaptureConfig.mockResolvedValue(demoConfig());
      await renderReady();
      await screen.findByRole("button", { name: "Start" });
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(clearDeviceAuth).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith("/");
      expect(postSessionDiscard).not.toHaveBeenCalled();
      expect(postSessionEnd).not.toHaveBeenCalled();
    });

    it("before closing, running: asks first; Keep listening changes nothing", async () => {
      await startDemoSession();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.getByRole("dialog", { name: "Sign out and cancel today?" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Keep listening" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(clearDeviceAuth).not.toHaveBeenCalled();
      expect(postSessionDiscard).not.toHaveBeenCalled();
      expect(fakeSessions[0]!.stop).not.toHaveBeenCalled();
      expect(screen.getByText("Listening")).toBeTruthy();
    });

    it("before closing: Sign out and cancel calls the existing discard route, stops the engine, THEN clears the device and leaves", async () => {
      await startDemoSession();
      const sessionId = startCaptureSession.mock.calls[0]![3];
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out and cancel" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      expect(postSessionDiscard).toHaveBeenCalledTimes(1);
      expect(postSessionDiscard.mock.calls[0]![1]).toBe(sessionId);
      expect(fakeSessions[0]!.stop).toHaveBeenCalledTimes(1);
      expect(clearDeviceAuth).toHaveBeenCalledTimes(1);
      expect(postSessionEnd).not.toHaveBeenCalled();
      expect(postSessionDiscard.mock.invocationCallOrder[0]!).toBeLessThan(clearDeviceAuth.mock.invocationCallOrder[0]!);
    });

    it("a failed discard keeps the judge here: the error shows, the session keeps listening, nothing is cleared", async () => {
      await startDemoSession();
      postSessionDiscard.mockImplementationOnce(async () => ({ ok: false, status: 409, code: "session_ended" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out and cancel" }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(clearDeviceAuth).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(fakeSessions[0]!.stop).not.toHaveBeenCalled();
    });

    it("discard 409 closing_reached (the server already marked closing): the dialog becomes the after-closing one, nothing is deleted or cleared", async () => {
      await startDemoSession();
      postSessionDiscard.mockImplementationOnce(async () => ({ ok: false, status: 409, code: "closing_reached" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out and cancel" }));
      await screen.findByRole("dialog", { name: "Sign out?" });
      expect(clearDeviceAuth).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Sign out anyway" }));
      await settle();
      expect(replace).toHaveBeenCalledWith("/");
      expect(postSessionDiscard).toHaveBeenCalledTimes(1);
    });

    it("after closing: the dialog says the session stays open; Stay changes nothing", async () => {
      await startDemoSession();
      await reachClosing();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.getByRole("dialog", { name: "Sign out?" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Stay" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(clearDeviceAuth).not.toHaveBeenCalled();
    });

    it("after closing: Sign out anyway touches NO session route (nothing ended, nothing deleted), stops the engine, clears the device", async () => {
      await startDemoSession();
      await reachClosing();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out anyway" }));
      await settle();
      expect(replace).toHaveBeenCalledWith("/");
      expect(postSessionDiscard).not.toHaveBeenCalled();
      expect(postSessionEnd).not.toHaveBeenCalled();
      expect(fakeSessions[0]!.stop).toHaveBeenCalledTimes(1);
      expect(clearDeviceAuth).toHaveBeenCalledTimes(1);
    });

    /** A sandbox session at closing time under fully faked timers (RTL's own waitFor would hang otherwise). */
    async function reachClosingUnderFakeTimers() {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(new Date(MON_2230_WIB));
      fetchCaptureConfig.mockResolvedValue(demoConfig());
      await renderReady();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      await settle();
      await vi.dynamicImportSettled(); // the lazily loaded script drawer
      await settle();
      for (let i = 0; i < 9; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
      fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
      await settle();
      expect(screen.getByRole("button", { name: "End today" })).toBeTruthy(); // closing reached
    }

    it("uploads: the engine is asked to drain for 15 s (not its 5 s default); Finishing uploads… shows meanwhile", async () => {
      await reachClosingUnderFakeTimers();
      holdStops = true; // a stuck upload: the engine's stop() settles only at its drain bound
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out anyway" }));
      await settle();
      expect(screen.getByText("Finishing uploads…")).toBeTruthy();
      expect(fakeSessions[0]!.stop).toHaveBeenCalledWith({ drainMs: 15_000 });
      // With the engine's 5 s default the page would already be gone here.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_000);
      });
      expect(replace).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(replace).toHaveBeenCalledWith("/");
      expect(clearDeviceAuth).toHaveBeenCalledTimes(1);
      expect(postSessionEnd).not.toHaveBeenCalled();
    });

    it("uploads: logs the engine's dropped count at sign-out, a number only (no text, no ids)", async () => {
      await reachClosingUnderFakeTimers();
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        fakeDroppedCount = 3;
        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
        fireEvent.click(screen.getByRole("button", { name: "Sign out anyway" }));
        await settle();
        expect(replace).toHaveBeenCalledWith("/");
        expect(info).toHaveBeenCalledTimes(1);
        const args = info.mock.calls[0]!;
        expect(args).toContain(3);
        const printed = args.map(String).join(" ");
        expect(printed).not.toContain("deviceId");
        expect(printed).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no session or device id
      } finally {
        info.mockRestore();
      }
    });

    it("the running dialog goes away when the 10-min auto-stop ends the session underneath it; no discard, no sign-out", async () => {
      await startDemoSession();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.getByRole("dialog", { name: "Sign out and cancel today?" })).toBeTruthy();
      // The sandbox hard stop: start + max_ms (10 min), seen by the 1 s demo tick.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000 + 2_000);
      });
      await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(postSessionDiscard).not.toHaveBeenCalled();
      expect(clearDeviceAuth).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it("the running dialog's Confirm is disabled while the auto-stop's end call is in flight", async () => {
      await startDemoSession();
      let resolveEnd: (v: { ok: true }) => void = () => {};
      postSessionEnd.mockImplementationOnce(() => new Promise((resolve) => { resolveEnd = resolve; }));
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000 + 2_000);
      });
      await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
      // The end call has not answered: the session is still "running" on this page, so the dialog is still up.
      const confirm = screen.getByRole("button", { name: "Sign out and cancel" }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(confirm);
      expect(postSessionDiscard).not.toHaveBeenCalled();
      resolveEnd({ ok: true });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("never shows a device id anywhere on the screen", async () => {
      await startDemoSession();
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(document.body.textContent).not.toContain("deviceId");
    });
  });

  describe("sign-out while Start is in flight (tech-lead round 1, major)", () => {
    async function renderIdleSandbox() {
      pinClock(MON_2230_WIB);
      fetchCaptureConfig.mockResolvedValue(demoConfig());
      await renderReady();
      return screen.findByRole("button", { name: "Start" });
    }

    it("Sign out is disabled while the start route has not answered; a tap does nothing", async () => {
      let resolveStart: (v: { ok: true }) => void = () => {};
      postSessionStart.mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
      fireEvent.click(await renderIdleSandbox());
      await waitFor(() => expect(postSessionStart).toHaveBeenCalledTimes(1));
      const signOut = screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement;
      expect(signOut.disabled).toBe(true);
      fireEvent.click(signOut);
      expect(clearDeviceAuth).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      resolveStart({ ok: true });
      await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
      expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("Sign out is disabled while the engine is still starting (startCaptureSession pending)", async () => {
      let resolveEngine: (s: FakeSession) => void = () => {};
      startCaptureSession.mockImplementationOnce(() => new Promise<FakeSession>((resolve) => { resolveEngine = resolve; }));
      fireEvent.click(await renderIdleSandbox());
      await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
      const signOut = screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement;
      expect(signOut.disabled).toBe(true);
      fireEvent.click(signOut);
      expect(clearDeviceAuth).not.toHaveBeenCalled();
      const session: FakeSession = { stop: vi.fn(() => Promise.resolve({ droppedCount: 0 })) };
      resolveEngine(session);
      await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
      expect(session.stop).not.toHaveBeenCalled();
    });

    it("an engine that resolves after the page unmounted is stopped at once (mic off, no upload from a dead page)", async () => {
      let resolveEngine: (s: FakeSession) => void = () => {};
      startCaptureSession.mockImplementationOnce(() => new Promise<FakeSession>((resolve) => { resolveEngine = resolve; }));
      fireEvent.click(await renderIdleSandbox());
      await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
      cleanup(); // the page is gone (a sign-out from another path, or navigation)
      const session: FakeSession = { stop: vi.fn(() => Promise.resolve({ droppedCount: 0 })) };
      await act(async () => {
        resolveEngine(session);
      });
      await waitFor(() => expect(session.stop).toHaveBeenCalledTimes(1));
    });

    it("Sign out is disabled while an open-session End or Cancel is in flight", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date(MON_2230_WIB));
      fetchCaptureConfig.mockResolvedValue(demoConfig({ open_session: open({ closing_reached: true }), closing_reached: true }));
      let resolveEnd: (v: { ok: true }) => void = () => {};
      postSessionEnd.mockImplementationOnce(() => new Promise((resolve) => { resolveEnd = resolve; }));
      await renderReady();
      fireEvent.click(await screen.findByRole("button", { name: "End today" }));
      await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
      expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(true);
      resolveEnd({ ok: true });
      await waitFor(() => expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(false));
    });
  });

  describe("open-session view (plan 5.7a)", () => {
    async function renderWithOpen(openSession: ReturnType<typeof open>, extra: Record<string, unknown> = {}) {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date(MON_2230_WIB));
      // The first read finds the open session; every later read (after End or Cancel) finds none, as the server would.
      fetchCaptureConfig.mockResolvedValueOnce(demoConfig({ open_session: openSession, closing_reached: openSession.closing_reached }, extra));
      fetchCaptureConfig.mockResolvedValue(demoConfig({}, extra));
      await renderReady();
    }

    it("replaces the idle Start whenever open_session exists (even though Start would be offered): no way to start a second session", async () => {
      await renderWithOpen(open());
      await screen.findByRole("heading", { name: "Today's session was interrupted." });
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
      expect(screen.queryByText("Tap Start to begin today's session.")).toBeNull();
      expect(startCaptureSession).not.toHaveBeenCalled();
    });

    it("the page never resumes listening into the old session", async () => {
      await renderWithOpen(open({ closing_reached: true }));
      await screen.findByRole("heading", { name: "Today's session is still open." });
      expect(startCaptureSession).not.toHaveBeenCalled();
      expect(postSessionStart).not.toHaveBeenCalled();
    });

    it("closing reached: End today ends THAT session (selesai) via the existing route, then the debrief runs", async () => {
      stubPreparingQuestions();
      await renderWithOpen(open({ closing_reached: true }));
      fireEvent.click(await screen.findByRole("button", { name: "End today" }));
      await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
      const [, id, body] = postSessionEnd.mock.calls[0]! as [unknown, string, { started_at_ms: number; ended_at_ms: number; end_reason: string }];
      expect(id).toBe(SID);
      expect(body).toMatchObject({ started_at_ms: STARTED, end_reason: "selesai" });
      expect(body.ended_at_ms).toBe(Date.parse(MON_2230_WIB));
      await waitFor(() => expect(screen.getByText("Preparing your questions")).toBeTruthy());
      expect(screen.queryByRole("heading", { name: "Today's session is still open." })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    });

    it("not reached: Cancel today discards THAT session via the existing route, then Start is offered again", async () => {
      await renderWithOpen(open());
      fireEvent.click(await screen.findByRole("button", { name: "Cancel today" }));
      await waitFor(() => expect(postSessionDiscard).toHaveBeenCalledTimes(1));
      expect(postSessionDiscard.mock.calls[0]![1]).toBe(SID);
      expect(postSessionDiscard.mock.calls[0]![2]).toMatchObject({ started_at_ms: STARTED });
      expect(postSessionEnd).not.toHaveBeenCalled();
      await screen.findByRole("button", { name: "Start" });
      expect(screen.queryByRole("heading", { name: "Today's session was interrupted." })).toBeNull();
    });

    it("a failed End keeps the view and shows the generic line; a retry is possible", async () => {
      await renderWithOpen(open({ closing_reached: true }));
      postSessionEnd.mockImplementationOnce(async () => ({ ok: false, status: 500 }));
      fireEvent.click(await screen.findByRole("button", { name: "End today" }));
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not process that. Try again."));
      expect(screen.getByRole("heading", { name: "Today's session is still open." })).toBeTruthy();
      expect((screen.getByRole("button", { name: "End today" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("Cancel today refused with 409 closing_reached (closing was marked meanwhile) becomes End today", async () => {
      await renderWithOpen(open());
      postSessionDiscard.mockImplementationOnce(async () => ({ ok: false, status: 409, code: "closing_reached" }));
      fireEvent.click(await screen.findByRole("button", { name: "Cancel today" }));
      await screen.findByRole("heading", { name: "Today's session is still open." });
      expect(screen.getByRole("button", { name: "End today" })).toBeTruthy();
    });

    it("signing out with the closing-reached view asks first (the session stays open); with the interrupted view it leaves at once", async () => {
      await renderWithOpen(open({ closing_reached: true }));
      await screen.findByRole("heading", { name: "Today's session is still open." });
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.getByRole("dialog", { name: "Sign out?" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Sign out anyway" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      expect(postSessionDiscard).not.toHaveBeenCalled();
      expect(postSessionEnd).not.toHaveBeenCalled();
      cleanup();
      replace.mockClear();
      clearDeviceAuth.mockClear();
      await renderWithOpen(open());
      await screen.findByRole("heading", { name: "Today's session was interrupted." });
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(replace).toHaveBeenCalledWith("/");
      expect(postSessionDiscard).not.toHaveBeenCalled();
    });

    it("pilot: no open-session view, Start as before", async () => {
      pinClock(MON_2230_WIB);
      fetchCaptureConfig.mockResolvedValue(pilotConfig());
      await renderReady();
      await screen.findByRole("button", { name: "Start" });
      expect(screen.queryByRole("heading", { name: /session/i })).toBeNull();
    });
  });

  describe("config re-fetch (the page loaded it once before)", () => {
    async function idleSandbox(profile: Record<string, unknown> = {}) {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date(MON_2230_WIB));
      fetchCaptureConfig.mockResolvedValue(demoConfig(profile));
      await renderReady();
      await screen.findByRole("button", { name: "Start" });
      expect(fetchCaptureConfig).toHaveBeenCalledTimes(1);
    }

    it("after End on a sandbox the config is fetched again", async () => {
      stubPreparingQuestions();
      await startDemoSession();
      await reachClosing();
      fetchCaptureConfig.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "End today" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
      await waitFor(() => expect(fetchCaptureConfig).toHaveBeenCalledTimes(1));
      expect(screen.getByText("Preparing your questions")).toBeTruthy(); // the refreshed config does not undo the local end
    });

    it("after Cancel session on a sandbox the config is fetched again", async () => {
      await startDemoSession();
      fetchCaptureConfig.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Yes, delete session" })).toBeTruthy());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
      await waitFor(() => expect(fetchCaptureConfig).toHaveBeenCalledTimes(1));
    });

    it("pilot: End never triggers a config fetch (the page behaves as before)", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date("2026-10-12T01:00:00Z"));
      fetchCaptureConfig.mockResolvedValue(config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }));
      await renderReady();
      fireEvent.click(await screen.findByRole("button", { name: "Start" }));
      await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
      await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
      fireEvent.click(screen.getByRole("button", { name: "End" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
      await waitFor(() => expect(screen.getByText("Debrief running")).toBeTruthy());
      expect(fetchCaptureConfig).toHaveBeenCalledTimes(1);
    });

    it("an idle sandbox re-fetches every 30 s (a next-day jump or a finished debrief shows without a reload)", async () => {
      await idleSandbox({ next_day: { allowed: false, reason: "preparing" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchCaptureConfig).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchCaptureConfig).toHaveBeenCalledTimes(3);
    });

    it("next_day reason busy is transient: re-polled after 5 s, and the lock line clears once it is allowed", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date(MON_2230_WIB));
      const last = { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: Date.parse(MON_2230_WIB) + 3_000_000 };
      fetchCaptureConfig.mockResolvedValueOnce(
        { ...demoConfig({ days_done: 1, next_day: { allowed: false, reason: "busy" } }), last_ended: last },
      );
      fetchCaptureConfig.mockResolvedValue({ ...demoConfig({ days_done: 1, next_day: { allowed: true, reason: null } }), last_ended: last });
      seedDoneFlag(last.debrief_ends_at_ms); // the debrief is done: the done slot (with the lock lines) is what shows
      await renderReady();
      await screen.findByText("Bee6 is busy with today's notes. Try again in a few seconds.");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await waitFor(() => expect(screen.queryByText("Bee6 is busy with today's notes. Try again in a few seconds.")).toBeNull());
      expect(screen.getByText("Use Jump to tomorrow in the judge guide")).toBeTruthy();
      expect(fetchCaptureConfig).toHaveBeenCalledTimes(2);
    });

    it("no re-fetch while a session is running", async () => {
      await startDemoSession();
      fetchCaptureConfig.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(fetchCaptureConfig).not.toHaveBeenCalled();
    });

    it("a failed re-fetch keeps the screen as it is", async () => {
      await idleSandbox();
      fetchCaptureConfig.mockRejectedValue(new Error("offline"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("the pilot never polls", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      vi.setSystemTime(new Date(MON_2230_WIB));
      fetchCaptureConfig.mockResolvedValue(pilotConfig());
      await renderReady();
      await screen.findByRole("button", { name: "Start" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(fetchCaptureConfig).toHaveBeenCalledTimes(1);
    });
  });
});

describe("CapturePage debrief wiring (R-18 Check button; R-19 §6.3: a sandbox opens the debrief itself, the pilot taps the card)", () => {
  const listBody = {
    data: {
      debrief: { business_date: "2026-10-12", ends_at_ms: Date.parse("2026-10-12T04:00:00Z") },
      questions: [{ question_id: "q1", kind: "gate", category: "ROUTINE_OPS", start_hm: "09:00", end_hm: "09:05" }],
    },
  };
  async function openDebrief(demo: boolean) {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-12T03:30:00Z")); // 10:30 WIB
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => listBody }) as Response),
    );
    fetchCaptureConfig.mockResolvedValue({
      ...config(
        { sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } },
        { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: Date.parse("2026-10-12T04:00:00Z") },
      ),
      capture_mode: "room",
      ...(demo ? { demo_session: DEMO_PROFILE } : {}),
    });
    await renderReady();
    if (demo) {
      // The sandbox never shows the entry card: the debrief opens itself (`demo` on DebriefFlow).
      await waitFor(() => expect(screen.queryByRole("button", { name: "Start" })).toBeNull());
      expect(screen.queryByRole("button", { name: "Answer questions" })).toBeNull();
    } else {
      fireEvent.click(await screen.findByRole("button", { name: "Answer questions" }));
    }
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
  }
  afterEach(() => vi.unstubAllGlobals());

  it("a sandbox device's debrief opens itself and offers 'Check for new questions'", async () => {
    await openDebrief(true);
    expect(screen.getByRole("button", { name: "Check for new questions" })).toBeTruthy();
  });

  it("pilot: the entry card must be tapped and the same debrief has no such button", async () => {
    await openDebrief(false);
    expect(screen.queryByRole("button", { name: "Check for new questions" })).toBeNull();
  });
});

describe("CapturePage dev panel (DEV-01, unaffected by the Mulai rewrite)", () => {
  it("renders no dev-panel node at all when the flag is unset", async () => {
    isDevControlsEnabled.mockReturnValue(false);
    await renderReady();
    expect(screen.queryByTestId("dev-panel")).toBeNull();
  });

  it('clicking dev "Start" calls startCaptureSession exactly once, independent of Mulai', async () => {
    isDevControlsEnabled.mockReturnValue(true);
    fetchCaptureConfig.mockResolvedValue(config({ sun: null }));
    await renderReady();
    const panel = await screen.findByTestId("dev-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    expect(postSessionStart).not.toHaveBeenCalled();
  });

  it('clicking dev "Pause" calls session.stop()', async () => {
    isDevControlsEnabled.mockReturnValue(true);
    fetchCaptureConfig.mockResolvedValue(config({ sun: null }));
    await renderReady();
    const panel = await screen.findByTestId("dev-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    fireEvent.click(within(panel).getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
  });
});

describe("CapturePage: no session_id stamping claim ships silently", () => {
  it("starts a session with a client-generated session_id (session_id stamping on segments is NOT verified end-to-end — see report)", async () => {
    pinClock("2026-09-30T03:00:00Z");
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    const [, , , sessionId] = startCaptureSession.mock.calls[0]!;
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("CapturePage: debrief entry card (R-07, technical spec §8.10)", () => {
  it("appears synchronously after Selesai is confirmed", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z")); // Mon 08:00 WIB
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() => expect(screen.getByText("Debrief running")).toBeTruthy());
  });

  it("appears synchronously after an auto-stop, including a past-midnight auto-stop at 02:00 with ends 03:00", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z")); // Mon 08:00 WIB
    // Close at 01:00 (next calendar day): auto-stop = close + 1h = Tue 02:00 WIB.
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "01:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    // Mon 08:00 WIB -> Tue 02:00 WIB is 18h away; one extra tick past it.
    await vi.advanceTimersByTimeAsync(18 * 60 * 60_000 + 30_000);
    await waitFor(() => expect(screen.getByText("Ended automatically at 02:00")).toBeTruthy());
    expect(screen.getByText("Debrief running")).toBeTruthy();
  });

  it("the Mulai button stays disabled at ends − 1ms and enables within one 30s tick after ends (A5)", async () => {
    // A reload mid-debrief, spanning the 01:00 business-date rollover so the
    // calendar's "day_ended" gate has already cleared by `endsAtMs` and the
    // only thing still blocking Mulai is "debrief_running" (lib/capture/
    // calendar.ts mulaiAvailability): ends = Tue 2026-10-13 01:30 WIB, last
    // Selesai on Mon 2026-10-12.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const endsAtMs = Date.parse("2026-10-12T18:30:00Z"); // Tue 01:30 WIB
    vi.setSystemTime(new Date(endsAtMs - 1));
    fetchCaptureConfig.mockResolvedValue(
      config(
        { sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } },
        { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: endsAtMs },
      ),
    );
    await renderReady();
    const btn = (await screen.findByRole("button", { name: "Start" })) as HTMLButtonElement;
    expect(btn.getAttribute("aria-disabled")).toBe("true");

    // `act()` around the advance (rather than a bare await) so the page's
    // 30s-tick state update is guaranteed to flush before the assertion,
    // regardless of what an earlier test in this file left the fake-timer/
    // scheduler interaction in.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(btn.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("does not appear after a cancel (Batalkan)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z")); // Mon 08:00 WIB
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete session" }));
    await waitFor(() => expect(screen.getByText("Session cancelled")).toBeTruthy());
    expect(screen.queryByText("Debrief running")).toBeNull();
  });

  it("on reload at ends - 30 min, shows the card with 30 minutes left", async () => {
    const now = Date.parse("2026-10-12T10:00:00Z");
    const endsAtMs = now + 30 * 60_000;
    pinClock(new Date(now).toISOString());
    fetchCaptureConfig.mockResolvedValue(
      config(
        { sun: null, mon: { open: "08:00", close: "22:00" } },
        { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: endsAtMs },
      ),
    );
    await renderReady();
    await waitFor(() => expect(screen.getByText("Debrief running")).toBeTruthy());
    expect(screen.getByText("30 minutes left.")).toBeTruthy();
  });

  it("on reload at ends + 1 min, shows no card", async () => {
    const now = Date.parse("2026-10-12T10:00:00Z");
    const endsAtMs = now - 60_000;
    pinClock(new Date(now).toISOString());
    fetchCaptureConfig.mockResolvedValue(
      config(
        { sun: null, mon: { open: "08:00", close: "22:00" } },
        { business_date: "2026-10-12", end_reason: "selesai", debrief_ends_at_ms: endsAtMs },
      ),
    );
    await renderReady();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeTruthy());
    expect(screen.queryByText("Debrief running")).toBeNull();
  });
});
