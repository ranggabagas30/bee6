// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/capture/dev-mode", () => ({
  isDevControlsEnabled: () => false,
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

const startCaptureSession = vi.fn(async () => ({ stop: vi.fn(async () => {}) }));
vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: () => startCaptureSession(),
}));

const PRIVACY_BAHASA =
  "Suara diubah jadi catatan kerja singkat. Rekaman suara tidak disimpan.";
const PRIVACY_ENGLISH = "Speech becomes short work notes. Audio is not kept.";

const CONFIG = {
  consent_complete: true,
  opening_time: "08:00",
  closing_time: "20:00",
  timezone: "Asia/Jakarta",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderWithPhase(phase: "active" | "outside_hours") {
  readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
  fetchCaptureConfig.mockResolvedValue(CONFIG);
  resolveCapturePhase.mockReturnValue(phase);
  const { default: CapturePage } = await import("@/app/capture/page");
  return render(<CapturePage />);
}

describe("CapturePage copy", () => {
  it("shows the exact privacy line on the active view", async () => {
    const { container } = await renderWithPhase("active");
    await waitFor(() => expect(container.textContent).toMatch(/keep this page open/i));
    expect(screen.getByText(PRIVACY_BAHASA)).toBeTruthy();
    expect(screen.getByText(PRIVACY_ENGLISH)).toBeTruthy();
  });

  it("shows the exact privacy line on the closed (outside hours) view", async () => {
    const { container } = await renderWithPhase("outside_hours");
    await waitFor(() => expect(container.textContent).toMatch(/outside opening hours/i));
    expect(screen.getByText(PRIVACY_BAHASA)).toBeTruthy();
    expect(screen.getByText(PRIVACY_ENGLISH)).toBeTruthy();
  });

  it("shows the bilingual resume sentence with the opening time on the closed view", async () => {
    const { container } = await renderWithPhase("outside_hours");
    await waitFor(() => expect(container.textContent).toMatch(/outside opening hours/i));
    expect(screen.getByText("Mulai lagi saat buka berikutnya (08:00)")).toBeTruthy();
    expect(screen.getByText("Resumes at the next opening (08:00)")).toBeTruthy();
    expect(container.textContent).not.toMatch(/start again automatically/i);
  });

  it("renders the stub as a disabled, non-interactive bilingual button", async () => {
    const { container } = await renderWithPhase("active");
    await waitFor(() => expect(container.textContent).toMatch(/keep this page open/i));
    const button = screen.getByRole("button", {
      name: /Dibuka otomatis saat tutup.*Opens automatically at closing/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(container.textContent).not.toMatch(/available soon/i);
  });

  it("makes no extra privacy claims", async () => {
    const { container } = await renderWithPhase("active");
    await waitFor(() => expect(container.textContent).toMatch(/keep this page open/i));
    expect(container.textContent).not.toMatch(/not recorded|anonymous|private conversation/i);
  });
});
