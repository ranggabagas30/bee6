// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// Real fetchCaptureConfig (only the device credential read is stubbed, because
// this Node runtime has no usable localStorage): this test exercises the
// server-output boundary, i.e. the zod parse of the config response.
vi.mock("@/lib/capture/browser/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capture/browser/client")>()),
  readDeviceAuth: () => ({ deviceToken: "t", deviceId: "d" }),
}));
const routerStub = vi.hoisted(() => ({ replace: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
}));

vi.mock("@/lib/capture/dev-mode", () => ({
  isDevControlsEnabled: () => false,
}));

const startCaptureSession = vi.fn(async () => ({ stop: vi.fn(async () => {}) }));
vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: (...args: unknown[]) => startCaptureSession(...(args as [])),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  // 12:00 Asia/Jakarta, inside the 07:00–21:45 window below.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T05:00:00Z"));
});

describe("CapturePage with a config response that omits consent_complete", () => {
  it("renders the active capture view, not the settings error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              opening_time: "07:00",
              closing_time: "21:45",
              timezone: "Asia/Jakarta",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const { default: CapturePage } = await import("@/app/capture/page");
    const { container } = render(<CapturePage />);

    await waitFor(() => expect(startCaptureSession).toHaveBeenCalled());
    expect(container.textContent).not.toContain("Pengaturan tidak bisa dimuat");
    expect(container.textContent).not.toContain("Couldn't load capture settings");
  });
});
