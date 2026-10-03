// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
}
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
