// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
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
  (config: unknown, now: unknown) => "outside_hours" | "active"
>(() => "outside_hours");
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
  vi.useRealTimers();
  readDeviceAuth.mockReturnValue(null);
  resolveCapturePhase.mockReturnValue("outside_hours");
  fakeSessions.length = 0;
});

async function importCapturePage() {
  const { default: CapturePage } = await import("@/app/capture/page");
  return CapturePage;
}

/** Strict config shape (web-backend-rbac §6.6.2): no consent key, no opening/closing. */
function config(weekly: Record<string, { open: string; close: string } | null>) {
  const closed = { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null };
  return { timezone: "Asia/Jakarta", weekly_hours: { ...closed, ...weekly }, last_ended: null };
}

/** Pins the clock (Date only, so waitFor and timers keep working). */
function pinClock(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

describe("CapturePage hours copy (outside_hours)", () => {
  it("shows today's hours from weekly_hours on an open day", async () => {
    // Wed 2026-09-30 06:00 WIB, before the 08:00 opening.
    pinClock("2026-09-29T23:00:00Z");
    isDevControlsEnabled.mockReturnValue(false);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    await waitFor(() =>
      expect(container.textContent).toContain("Listening runs from 08:00 to 22:00 (Asia/Jakarta)."),
    );
  });

  it("shows the next open day's hours on a closed day", async () => {
    // Sun 2026-10-04 10:00 WIB: closed; Mon 2026-10-05 is open 07:00-21:00.
    pinClock("2026-10-04T03:00:00Z");
    isDevControlsEnabled.mockReturnValue(false);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(config({ mon: { open: "07:00", close: "21:00" } }));
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    await waitFor(() =>
      expect(container.textContent).toContain("Listening runs from 07:00 to 21:00 (Asia/Jakarta)."),
    );
  });

  it("never renders any no-consent copy", async () => {
    pinClock("2026-09-29T23:00:00Z");
    isDevControlsEnabled.mockReturnValue(false);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    await waitFor(() => expect(container.textContent).toContain("Listening runs from"));
    expect(container.textContent).not.toMatch(/capture is off|consent|persetujuan/i);
  });
});

describe("CapturePage dev panel gating", () => {
  it("renders no dev-panel node at all when the flag is unset", async () => {
    isDevControlsEnabled.mockReturnValue(false);
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    expect(container.querySelector('[data-testid="dev-panel"]')).toBeNull();
  });

  it("still renders no dev-panel node once the real auto-gate resolves a blocking phase", async () => {
    pinClock("2026-09-29T23:00:00Z");
    isDevControlsEnabled.mockReturnValue(false);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    resolveCapturePhase.mockReturnValue("outside_hours");
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);
    await waitFor(() => expect(container.textContent).toMatch(/outside opening hours/i));
    expect(container.querySelector('[data-testid="dev-panel"]')).toBeNull();
  });

  it("bypasses the outside_hours block and shows the active view when the flag is set", async () => {
    pinClock("2026-09-29T23:00:00Z");
    isDevControlsEnabled.mockReturnValue(true);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    resolveCapturePhase.mockReturnValue("outside_hours"); // still a blocking phase
    const CapturePage = await importCapturePage();
    const { container } = render(<CapturePage />);

    // The dev panel is present...
    await waitFor(() =>
      expect(container.querySelector('[data-testid="dev-panel"]')).not.toBeNull(),
    );
    // ...the real blocked state is still shown underneath (not deleted)...
    expect(container.textContent).toMatch(/outside opening hours/i);
    // ...and the active capture view is no longer blocked by it.
    expect(container.textContent).toMatch(/keep the screen on and this page open/i);
  });
});

describe("CapturePage dev panel manual controls", () => {
  async function renderInDevMode() {
    isDevControlsEnabled.mockReturnValue(true);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(config({ wed: { open: "08:00", close: "22:00" } }));
    // A blocking phase: proves the manual buttons act independently of the
    // real auto-gate (which would otherwise never call startCaptureSession
    // here at all) rather than coincidentally riding its own auto-start.
    resolveCapturePhase.mockReturnValue("outside_hours");
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
