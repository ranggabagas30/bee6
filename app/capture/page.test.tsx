// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
// One stable router object, like Next's real useRouter: the page's mount effect
// depends on it, so a fresh object per render would re-run (and tear down) it.
const stableRouter = { replace };
vi.mock("next/navigation", () => ({
  useRouter: () => stableRouter,
}));

const isDevControlsEnabled = vi.fn(() => false);
vi.mock("@/lib/capture/dev-mode", () => ({
  isDevControlsEnabled: () => isDevControlsEnabled(),
}));

const readDeviceAuth = vi.fn<() => { deviceToken: string; deviceId: string } | null>(
  () => null,
);
const fetchCaptureConfig = vi.fn<(auth: unknown) => Promise<unknown>>();
const resolveCapturePhase = vi.fn<
  (config: unknown, now: unknown) => "no_consent" | "outside_hours" | "active"
>(() => "no_consent");
vi.mock("@/lib/capture/browser/client", () => ({
  readDeviceAuth: () => readDeviceAuth(),
  fetchCaptureConfig: (auth: unknown) => fetchCaptureConfig(auth),
  resolveCapturePhase: (config: unknown, now: unknown) =>
    resolveCapturePhase(config, now),
}));

// The real auto-gate effect never reaches startCaptureSession in these tests
// (phase is forced to a blocking value, or dev mode bypasses the auto-gate
// entirely), but import it eagerly so a future wiring mistake that *does*
// reach it unexpectedly fails loudly via this mock instead of touching real
// getUserMedia/WebCodecs. Each call returns a distinct fake session with its
// own `stop` spy, so a test can assert the exact session a button acted on.
interface FakeCallbacks {
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
  onStatus?: (status: {
    state: "listening" | "offline" | "mic_error";
    queuedCount: number;
    droppedCount: number;
    micError: string | null;
    lastUploadHttpStatus?: number | null;
  }) => void;
}
// The callbacks the most recent fake session was started with, so a test can
// push engine status transitions (e.g. uploads failing) into the page.
let lastCallbacks: FakeCallbacks | null = null;
interface FakeSession {
  stop: ReturnType<typeof vi.fn>;
}
const fakeSessions: FakeSession[] = [];
const startCaptureSession = vi.fn(
  async (
    _auth: unknown,
    _config: unknown,
    cb: FakeCallbacks,
  ): Promise<FakeSession> => {
    const session: FakeSession = { stop: vi.fn(async () => {}) };
    fakeSessions.push(session);
    lastCallbacks = cb;
    // Simulate the real session reporting one status transition on start,
    // the same way session.ts emits state_changed from its onStatusChange.
    cb.onEvent?.({ type: "state_changed", state: "listening", queuedCount: 0 });
    return session;
  },
);
vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: (auth: unknown, config: unknown, cb: FakeCallbacks) =>
    startCaptureSession(auth, config, cb),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  readDeviceAuth.mockReturnValue(null);
  resolveCapturePhase.mockReturnValue("no_consent");
  fakeSessions.length = 0;
  lastCallbacks = null;
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});

async function importCapturePage() {
  const { default: CapturePage } = await import("@/app/capture/page");
  return CapturePage;
}

describe("CapturePage dev panel gating", () => {
  it("renders no dev-panel node at all when the flag is unset", async () => {
    isDevControlsEnabled.mockReturnValue(false);
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    expect(container.querySelector('[data-testid="dev-panel"]')).toBeNull();
  });

  it("still renders no dev-panel node once the real auto-gate resolves a blocking phase", async () => {
    isDevControlsEnabled.mockReturnValue(false);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue({
      consent_complete: false,
      opening_time: "08:00",
      closing_time: "20:00",
      timezone: "Asia/Jakarta",
    });
    resolveCapturePhase.mockReturnValue("no_consent");
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    await waitFor(() => expect(container.textContent).toMatch(/capture is off/i));
    expect(container.querySelector('[data-testid="dev-panel"]')).toBeNull();
  });

  it("bypasses the no_consent/outside_hours block and shows the active view when the flag is set", async () => {
    isDevControlsEnabled.mockReturnValue(true);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue({
      consent_complete: false,
      opening_time: "08:00",
      closing_time: "20:00",
      timezone: "Asia/Jakarta",
    });
    resolveCapturePhase.mockReturnValue("no_consent"); // still a blocking phase
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);

    // The dev panel is present...
    await waitFor(() =>
      expect(container.querySelector('[data-testid="dev-panel"]')).not.toBeNull(),
    );
    // ...the real blocked state is still shown underneath (not deleted)...
    expect(container.textContent).toMatch(/capture is off/i);
    // ...and the active capture view is no longer blocked by it.
    expect(container.textContent).toMatch(/keep this page open/i);
  });
});

describe("CapturePage banner truthfulness (dev mode)", () => {
  async function renderInDevMode() {
    isDevControlsEnabled.mockReturnValue(true);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue({
      consent_complete: false,
      opening_time: "08:00",
      closing_time: "20:00",
      timezone: "Asia/Jakarta",
    });
    resolveCapturePhase.mockReturnValue("no_consent");
    const CapturePage = await importCapturePage();
    const result = render(<CapturePage />);
    await waitFor(() => expect(fetchCaptureConfig).toHaveBeenCalled());
    return result;
  }

  // Only the live status region, not the heading ("Mendengarkan toko") or the
  // privacy copy, so the assertions are about the banner alone.
  function bannerText(container: HTMLElement): string {
    return container.querySelector('section[role="status"]')?.textContent ?? "";
  }

  it("shows the neutral not-started banner before Start, never Listening", async () => {
    const { container } = await renderInDevMode();
    expect(bannerText(container)).toContain("Not started");
    expect(bannerText(container)).not.toContain("Mendengarkan");
    expect(bannerText(container)).not.toContain("Listening");
  });

  it("shows Listening only while the started session is running", async () => {
    const { container } = await renderInDevMode();
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(fakeSessions).toHaveLength(1));
    await waitFor(() => expect(bannerText(container)).toContain("Listening"));
    expect(bannerText(container)).toContain("Mendengarkan");
  });

  it("reports listening with uploads waiting, not Offline, when uploads fail mid-session", async () => {
    const { container } = await renderInDevMode();
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(lastCallbacks?.onStatus).toBeDefined());

    act(() => {
      lastCallbacks?.onStatus?.({
        state: "offline",
        queuedCount: 2,
        droppedCount: 0,
        micError: null,
      });
    });
    await waitFor(() =>
      expect(bannerText(container)).toContain("Listening · uploads waiting (2)"),
    );
    expect(bannerText(container)).toContain("Mendengarkan · pengiriman tertunda (2 menunggu)");
    expect(bannerText(container)).not.toContain("Terputus");
    expect(bannerText(container)).not.toContain("Offline");
    // The browser reports online here, so the detail must not claim no internet.
    expect(bannerText(container)).toContain("Server busy, retrying");
    expect(bannerText(container)).not.toContain("No internet");
  });

  it("shows No internet only when navigator.onLine reports offline", async () => {
    const { container } = await renderInDevMode();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(lastCallbacks?.onStatus).toBeDefined());

    act(() => {
      lastCallbacks?.onStatus?.({
        state: "offline",
        queuedCount: 1,
        droppedCount: 0,
        micError: null,
      });
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() => expect(bannerText(container)).toContain("No internet"));
    expect(bannerText(container)).toContain("Tidak ada internet");
    expect(bannerText(container)).not.toContain("Server busy");
  });

  it("returns to the neutral banner after Pause and never leaves the green state behind", async () => {
    const { container } = await renderInDevMode();
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(bannerText(container)).toContain("Listening"));

    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(bannerText(container)).toContain("Not started"));
    expect(bannerText(container)).not.toContain("Mendengarkan");
    expect(bannerText(container)).not.toContain("Listening");
  });
});

describe("CapturePage dev panel manual controls", () => {
  async function renderInDevMode() {
    isDevControlsEnabled.mockReturnValue(true);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue({
      consent_complete: false,
      opening_time: "08:00",
      closing_time: "20:00",
      timezone: "Asia/Jakarta",
    });
    // A blocking phase: proves the manual buttons act independently of the
    // real auto-gate (which would otherwise never call startCaptureSession
    // here at all) rather than coincidentally riding its own auto-start.
    resolveCapturePhase.mockReturnValue("no_consent");
    const CapturePage = await importCapturePage();
    const result = render(<CapturePage />);
    // Give the auto-gate's fetch effect a tick to settle so its own
    // (non-)behavior doesn't race with the assertions below.
    await waitFor(() => expect(fetchCaptureConfig).toHaveBeenCalled());
    return result;
  }

  it('clicking "Start" calls startCaptureSession exactly once', async () => {
    await renderInDevMode();
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
  });

  it('clicking "Start" twice before the first startCaptureSession call settles calls it exactly once', async () => {
    await renderInDevMode();
    const startButton = screen.getByRole("button", { name: /^start$/i });

    // Fire both clicks back-to-back, with no awaited tick in between, so the
    // second click lands while the first startCaptureSession() promise is
    // still in flight (the fake resolves on a microtask, not synchronously).
    fireEvent.click(startButton);
    fireEvent.click(startButton);

    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    // Let the in-flight start settle and confirm it's the only session created.
    await waitFor(() => expect(fakeSessions).toHaveLength(1));
    expect(startCaptureSession).toHaveBeenCalledTimes(1);
  });

  it('clicking "Pause" calls session.stop() and leaves the session cleared', async () => {
    await renderInDevMode();
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    const [session1] = fakeSessions;

    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(session1?.stop).toHaveBeenCalledTimes(1));

    // Pausing again (no running session) must not call stop() a second time
    // on the already-stopped session — sessionRef.current was cleared.
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(session1?.stop).toHaveBeenCalledTimes(1);
  });

  it('clicking "Start" again after a pause starts a fresh session, not the stale one', async () => {
    await renderInDevMode();
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(1));
    const [session1] = fakeSessions;

    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(session1?.stop).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(startCaptureSession).toHaveBeenCalledTimes(2));
    const [, session2] = fakeSessions;
    expect(session2).not.toBe(session1);
  });

  it("shows the session's emitted event in the on-page log after Start", async () => {
    const { container } = await renderInDevMode();
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="dev-event-log"]')?.textContent,
      ).toMatch(/state_changed/),
    );
  });
});

describe("CapturePage stale session status (D1)", () => {
  const micError = {
    state: "mic_error" as const,
    queuedCount: 0,
    droppedCount: 0,
    micError: "Mic gone",
  };
  const listening = {
    state: "listening" as const,
    queuedCount: 0,
    droppedCount: 0,
    micError: null,
  };

  function bannerText(container: HTMLElement): string {
    return container.querySelector('section[role="status"]')?.textContent ?? "";
  }

  it("dev path: a stopped session's late listening status cannot hide the replacement session's mic problem", async () => {
    isDevControlsEnabled.mockReturnValue(true);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue({
      consent_complete: false,
      opening_time: "08:00",
      closing_time: "20:00",
      timezone: "Asia/Jakarta",
    });
    resolveCapturePhase.mockReturnValue("no_consent");
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    await waitFor(() => expect(fetchCaptureConfig).toHaveBeenCalled());

    // Session 1: start, then keep its callbacks.
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(fakeSessions).toHaveLength(1));
    const session1Status = lastCallbacks?.onStatus;
    expect(session1Status).toBeDefined();

    // Pause session 1, then start session 2 which reports a mic problem.
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(fakeSessions[0]?.stop).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(fakeSessions).toHaveLength(2));
    act(() => {
      lastCallbacks?.onStatus?.(micError);
    });
    await waitFor(() => expect(bannerText(container)).toContain("Microphone problem"));

    // A late status from the stopped session 1 must be ignored.
    act(() => {
      session1Status?.(listening);
    });
    expect(bannerText(container)).toContain("Microphone problem");
    expect(bannerText(container)).not.toContain("Listening");
    expect(bannerText(container)).not.toContain("Mendengarkan");
  });

  it("auto path: a session stopped by the opening-hours gate cannot overwrite the replacement session's status", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      isDevControlsEnabled.mockReturnValue(false);
      readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
      fetchCaptureConfig.mockResolvedValue({
        consent_complete: true,
        opening_time: "08:00",
        closing_time: "20:00",
        timezone: "Asia/Jakarta",
      });
      resolveCapturePhase.mockReturnValue("active");
      const CapturePage = await importCapturePage();
      const { container } = render(<CapturePage />);
      await waitFor(() => expect(fakeSessions).toHaveLength(1));
      const session1Status = lastCallbacks?.onStatus;
      const session1 = fakeSessions[0];

      // Outside hours: the gate stops session 1 on the next 30 s tick.
      resolveCapturePhase.mockReturnValue("outside_hours");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(session1?.stop).toHaveBeenCalledTimes(1));

      // Back inside hours: session 2 starts and reports a mic problem.
      resolveCapturePhase.mockReturnValue("active");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(fakeSessions).toHaveLength(2));
      act(() => {
        lastCallbacks?.onStatus?.(micError);
      });
      await waitFor(() => expect(bannerText(container)).toContain("Microphone problem"));

      act(() => {
        session1Status?.(listening);
      });
      expect(bannerText(container)).toContain("Microphone problem");
      expect(bannerText(container)).not.toContain("Listening");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CapturePage upload status line", () => {
  function uploadText(container: HTMLElement): string | null {
    return container.querySelector('[data-testid="upload-status"]')?.textContent ?? null;
  }
  function bannerText(container: HTMLElement): string {
    return container.querySelector('section[role="status"]')?.textContent ?? "";
  }
  const status = (
    state: "listening" | "offline" | "mic_error",
    queuedCount: number,
    lastUploadHttpStatus: number | null,
  ) => ({ state, queuedCount, droppedCount: 0, micError: null, lastUploadHttpStatus });

  it("dev path: shows each upload state on its own line while the capture headline stays Listening", async () => {
    isDevControlsEnabled.mockReturnValue(true);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue({
      consent_complete: false,
      opening_time: "08:00",
      closing_time: "20:00",
      timezone: "Asia/Jakarta",
    });
    resolveCapturePhase.mockReturnValue("no_consent");
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    await waitFor(() => expect(fetchCaptureConfig).toHaveBeenCalled());

    // No session yet: no upload line at all.
    expect(uploadText(container)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(fakeSessions).toHaveLength(1));

    act(() => lastCallbacks?.onStatus?.(status("listening", 2, 200)));
    await waitFor(() => expect(uploadText(container)).toBe("Mengunggah" + "Uploading"));
    expect(bannerText(container)).toContain("Listening");

    act(() => lastCallbacks?.onStatus?.(status("offline", 1, null)));
    await waitFor(() =>
      expect(uploadText(container)).toBe("Gagal unggah, coba ulang" + "Upload failed, retrying"),
    );
    expect(bannerText(container)).toContain("Listening · uploads waiting (1)");

    act(() => lastCallbacks?.onStatus?.(status("listening", 0, 200)));
    await waitFor(() => expect(uploadText(container)).toBe("Unggah berhasil" + "Upload succeeded"));
    expect(bannerText(container)).toContain("Listening");

    // Pause: no session running, so the upload line disappears with the banner state.
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(uploadText(container)).toBeNull());
    expect(bannerText(container)).toContain("Not started");
  });

  it("auto path: shows the upload line only while the session is running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      isDevControlsEnabled.mockReturnValue(false);
      readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
      fetchCaptureConfig.mockResolvedValue({
        consent_complete: true,
        opening_time: "08:00",
        closing_time: "20:00",
        timezone: "Asia/Jakarta",
      });
      resolveCapturePhase.mockReturnValue("active");
      const CapturePage = await importCapturePage();
      const { container } = render(<CapturePage />);
      await waitFor(() => expect(fakeSessions).toHaveLength(1));

      act(() => lastCallbacks?.onStatus?.(status("offline", 1, null)));
      await waitFor(() =>
        expect(uploadText(container)).toBe("Gagal unggah, coba ulang" + "Upload failed, retrying"),
      );

      resolveCapturePhase.mockReturnValue("outside_hours");
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await waitFor(() => expect(uploadText(container)).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });
});
