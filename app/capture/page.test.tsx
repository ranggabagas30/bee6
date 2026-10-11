// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/capture/browser/client", () => ({
  readDeviceAuth: () => readDeviceAuth(),
  deviceAuthHeaders: () => ({}),
  fetchCaptureConfig: (auth: unknown) => fetchCaptureConfig(auth),
  postSessionStart: (auth: unknown, body: unknown) => postSessionStart(auth, body),
  postSessionEnd: (auth: unknown, id: string, body: unknown) => postSessionEnd(auth, id, body),
  postSessionDiscard: (auth: unknown, id: string, body: unknown) =>
    postSessionDiscard(auth, id, body),
}));

interface FakeCallbacks {
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
}
interface FakeSession {
  stop: ReturnType<typeof vi.fn>;
}
const fakeSessions: FakeSession[] = [];
let holdStops = false;
const startCaptureSession = vi.fn(
  async (
    _auth: unknown,
    _config: unknown,
    cb: FakeCallbacks,
    _sessionId?: string,
  ): Promise<FakeSession> => {
    const session: FakeSession = {
      stop: vi.fn(() => (holdStops ? new Promise<void>(() => {}) : Promise.resolve())),
    };
    fakeSessions.push(session);
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
vi.stubGlobal("crypto", {
  randomUUID: () => `11111111-1111-1111-1111-${String(++uuidCounter).padStart(12, "0")}`,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  readDeviceAuth.mockReturnValue(null);
  isDevControlsEnabled.mockReturnValue(false);
  fakeSessions.length = 0;
  holdStops = false;
  uuidCounter = 0;
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

describe("CapturePage with the R-18 demo profile (sandbox only)", () => {
  const MON_2230_WIB = "2026-10-12T15:30:00Z"; // past the pilot's 18:00 Mulai cut-off
  const demoConfig = (extra: Record<string, unknown> = {}) => ({
    ...config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    capture_mode: "room",
    demo_session: { max_ms: 300_000, script_id: "bakery-v1" },
    ...extra,
  });
  async function renderDemoRunning(iso = MON_2230_WIB) {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(iso));
    fetchCaptureConfig.mockResolvedValue(demoConfig());
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
  }

  it("Mulai is offered at 22:30 WIB, where the same config without the profile says the cut-off passed", async () => {
    pinClock(MON_2230_WIB);
    fetchCaptureConfig.mockResolvedValue(demoConfig());
    await renderReady();
    const btn = await screen.findByRole("button", { name: "Start" });
    expect(btn.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("Selesai (End) is on screen at once, not after 4 hours", async () => {
    await renderDemoRunning("2026-10-12T03:00:00Z"); // 10:00 WIB: the pilot would say "from 14:00"
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
    expect(screen.queryByText(/You can tap End from/)).toBeNull();
  });

  it("hard-stops at start + 5:00 with end_reason auto_stop and no confirm dialog (not at the 30 s tick)", async () => {
    await renderDemoRunning();
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 58_000);
    expect(postSessionEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("End today's operations?")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Listening")).toBeNull());
  });

  it("a start after close + 1 h (23:10 WIB, close 22:00) is not stopped at once: nothing before 4:58, exactly one auto_stop at 5:00", async () => {
    await renderDemoRunning("2026-10-12T16:10:00Z"); // Mon 23:10 WIB
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 58_000);
    expect(postSessionEnd).not.toHaveBeenCalled();
    expect(screen.getByText("Listening")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
  });

  it("a finished demo day offers no second Mulai and says to switch to Supervisor", async () => {
    await renderDemoRunning();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByText("Demo day finished. Switch to Supervisor to see it.").length).toBeGreaterThan(0),
    );
  });

  it("item 8: after Finish the sandbox says the demo day is finished and never offers a 'tap Start again <date>' line", async () => {
    await renderDemoRunning();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    await waitFor(() =>
      expect(screen.getAllByText("Demo day finished. Switch to Supervisor to see it.").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/You can tap Start again/)).toBeNull();
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
  });

  it("pilot: a running session does not tick every second and does not auto-stop at 5 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z"));
    fetchCaptureConfig.mockResolvedValue(
      config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    );
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(postSessionEnd).not.toHaveBeenCalled();
    expect(screen.getByText("Listening")).toBeTruthy();
  });
});

describe("CapturePage script drawer (R-18, sandbox only)", () => {
  const MON_1000_WIB = "2026-10-12T03:00:00Z";
  const demoConfig = () => ({
    ...config({ sun: null, mon: { open: "08:00", close: "22:00" }, tue: { open: "08:00", close: "22:00" } }),
    capture_mode: "room",
    demo_session: { max_ms: 300_000, script_id: "bakery-v1" },
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

  it("9.T1 renders only with demo_session: the rules card and the Tap Start line before Mulai", async () => {
    await renderDemoIdle();
    const drawer = screen.getByRole("region", { name: "Demo script" });
    expect(within(drawer).getByText("Tap Start to begin. Nothing is recorded until you do.")).toBeTruthy();
  });

  it("the cards appear once Mulai is tapped, and Listening, End and Cancel session stay on the page", async () => {
    await renderDemoRunning();
    const drawer = screen.getByRole("region", { name: "Demo script" });
    expect(within(drawer).getByText("Card 1 of 10")).toBeTruthy();
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel session" })).toBeTruthy();
    // the drawer is a sibling of the page content, not a wrapper: nothing is hidden or inert
    expect(drawer.contains(screen.getByRole("button", { name: "End" }))).toBe(false);
    expect(document.querySelector("[inert], [aria-hidden='true'] button")).toBeNull();
  });

  it("Finish on the last card runs the existing Selesai path: selesai, no confirm dialog, engine stopped", async () => {
    await renderDemoRunning();
    goToLastCard();
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "selesai" });
    expect(screen.queryByText("End today's operations?")).toBeNull();
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText("Done. Answer the debrief questions, then switch to Supervisor.")).toBeTruthy(),
    );
  });

  it("9.T5 a double tap on Finish makes one end request", async () => {
    await renderDemoRunning();
    goToLastCard();
    const finish = screen.getByRole("button", { name: "Finish and end the day" });
    fireEvent.click(finish);
    fireEvent.click(finish);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("9.T6 the 5:00 auto-stop while on card 5 ends the drawer without a second end request", async () => {
    await renderDemoRunning();
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Card 5 of 10")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
    await waitFor(() => expect(postSessionEnd).toHaveBeenCalledTimes(1));
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    await waitFor(() =>
      expect(screen.getByText("Done. Answer the debrief questions, then switch to Supervisor.")).toBeTruthy(),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Finish and end the day" })).toBeNull();
  });

  it("Finish at 4:59.5 with the end request still pending, then the 5:00 stop fires: exactly one end call", async () => {
    await renderDemoRunning();
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000 - 1_000); // 4:58, the page clock ticks each second
    goToLastCard();
    await vi.advanceTimersByTimeAsync(1_500); // 4:59.5
    let release: (r: { ok: boolean }) => void = () => {};
    postSessionEnd.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    fireEvent.click(screen.getByRole("button", { name: "Finish and end the day" }));
    await vi.advanceTimersByTimeAsync(2_000); // past the 5:00 stop while Finish is in flight
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "selesai" });
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("the End dialog's 'Yes, end' while the 5:00 stop is in flight makes no second end call", async () => {
    await renderDemoRunning();
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    let release: (r: { ok: boolean }) => void = () => {};
    postSessionEnd.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
    expect(postSessionEnd.mock.calls[0]![2]).toMatchObject({ end_reason: "auto_stop" });
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(postSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("the countdown follows the page clock, in text", async () => {
    await renderDemoRunning();
    expect(screen.getByText("Demo ends automatically in 5:00")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(screen.getByText("Demo ends automatically in 3:59")).toBeTruthy();
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
    expect(follows(screen.getByRole("button", { name: "End" }))).toBe(true);
    expect(follows(screen.getByRole("button", { name: "Cancel session" }))).toBe(true);
    for (let el: HTMLElement | null = screen.getByRole("button", { name: "End" }); el; el = el.parentElement) {
      expect(el.style.position).not.toBe("fixed");
    }
    expect(drawer.style.position).not.toBe("fixed");
  });

  it("item 7: right after Start the countdown reads 5:00, not 5:25, even when the page clock was 25 s stale", async () => {
    const start = await renderDemoIdle();
    vi.setSystemTime(new Date(Date.parse(MON_1000_WIB) + 25_000)); // 25 s pass; the 30 s tick has not fired
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(screen.getByText("Demo ends automatically in 5:00")).toBeTruthy();
    expect(screen.queryByText(/Demo ends automatically in 5:[1-5]/)).toBeNull();
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

describe("CapturePage debrief refresh wiring (R-18)", () => {
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
      ...(demo ? { demo_session: { max_ms: 300_000, script_id: "bakery-v1" } } : {}),
    });
    await renderReady();
    fireEvent.click(await screen.findByRole("button", { name: "Answer questions" }));
    await waitFor(() => expect(screen.getByText("Question 1 of 1")).toBeTruthy());
  }
  afterEach(() => vi.unstubAllGlobals());

  it("a sandbox device's debrief offers 'Check for new questions'", async () => {
    await openDebrief(true);
    expect(screen.getByRole("button", { name: "Check for new questions" })).toBeTruthy();
  });

  it("pilot: the same debrief has no such button", async () => {
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
