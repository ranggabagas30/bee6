// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// A stable router object: the page's effect depends on `router`, so a fresh
// object per render would re-run the effect (and re-fetch/re-start) after each
// setState and make the one-shot mocks below leak between renders.
const routerStub = vi.hoisted(() => ({ replace: () => {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
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

// Callbacks are forwarded so a test can drive onUnsupported from the session.
const startCaptureSession = vi.fn(
  async (_auth: unknown, _config: unknown, _cb: { onUnsupported?: () => void }) =>
    ({ stop: vi.fn(async () => {}) }) as { stop: () => Promise<void> } | null,
);
vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: (auth: unknown, config: unknown, cb: { onUnsupported?: () => void }) =>
    startCaptureSession(auth, config, cb),
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

async function renderWithPhase(phase: "active" | "outside_hours" | "no_consent") {
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

  it("shows the Bahasa line before each English shop-facing label on the outside-hours view", async () => {
    const { container } = await renderWithPhase("outside_hours");
    await waitFor(() => expect(container.textContent).toMatch(/outside opening hours/i));
    expect(screen.getByText("Mendengarkan toko")).toBeTruthy();
    expect(screen.getByText("Shop listening")).toBeTruthy();
    expect(screen.getByText("Dijeda — di luar jam buka")).toBeTruthy();
    expect(screen.getByText("Paused — outside opening hours")).toBeTruthy();
    expect(
      screen.getByText("Mendengarkan dari 08:00 sampai 20:00 (Asia/Jakarta)."),
    ).toBeTruthy();
    expect(screen.getByText("Listening runs from 08:00 to 20:00 (Asia/Jakarta).")).toBeTruthy();
  });

  it("shows the Bahasa line before each English shop-facing label on the active view", async () => {
    const { container } = await renderWithPhase("active");
    await waitFor(() => expect(container.textContent).toMatch(/keep this page open/i));
    expect(screen.getByText("Mendengarkan toko")).toBeTruthy();
    expect(screen.getByText("Shop listening")).toBeTruthy();
    expect(
      screen.getByText("Biarkan halaman ini terbuka, di depan, dan ponsel tetap tercolok."),
    ).toBeTruthy();
    expect(
      screen.getByText("Keep this page open, in front, and the phone plugged in."),
    ).toBeTruthy();
    expect(container.textContent?.split("Mikrofon / Microphone: unknown").length).toBe(2);
    expect(container.textContent).not.toContain("Mikrofon: ");
    expect(screen.getByText("Audio sedang diambil")).toBeTruthy();
    expect(screen.getByText("Audio is being captured")).toBeTruthy();
  });

  it("makes no extra privacy claims", async () => {
    const { container } = await renderWithPhase("active");
    await waitFor(() => expect(container.textContent).toMatch(/keep this page open/i));
    expect(container.textContent).not.toMatch(/not recorded|anonymous|private conversation/i);
  });

  it("shows the Bahasa and English no-consent heading and body", async () => {
    await renderWithPhase("no_consent");
    expect(await screen.findByText("Pengambilan audio belum aktif")).toBeTruthy();
    expect(screen.getByText("Capture is off")).toBeTruthy();
    expect(
      screen.getByText(
        "Outlet ini belum menyelesaikan langkah persetujuan staf, jadi pengambilan audio belum bisa dimulai. Minta supervisor menyelesaikan persetujuan, lalu muat ulang halaman ini.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "This outlet hasn't completed the staff-consent step yet, so listening can't start. Ask the supervisor to complete consent, then reload this page.",
      ),
    ).toBeTruthy();
  });

  it("shows the Bahasa and English loading line before settings resolve", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockReturnValueOnce(new Promise(() => {}));
    const { default: CapturePage } = await import("@/app/capture/page");
    render(<CapturePage />);
    expect(screen.getByText("Memuat pengaturan…")).toBeTruthy();
    expect(screen.getByText("Loading capture settings…")).toBeTruthy();
  });

  it("shows the Bahasa and English error line when settings fail to load", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockRejectedValueOnce(new Error("offline"));
    const { default: CapturePage } = await import("@/app/capture/page");
    render(<CapturePage />);
    expect(
      await screen.findByText("Pengaturan tidak bisa dimuat. Periksa koneksi lalu muat ulang."),
    ).toBeTruthy();
    expect(
      screen.getByText("Couldn't load capture settings. Check the connection and reload."),
    ).toBeTruthy();
  });

  it("shows the Bahasa and English unsupported-browser copy", async () => {
    startCaptureSession.mockImplementationOnce(async (_auth, _config, cb) => {
      cb.onUnsupported?.();
      return null;
    });
    await renderWithPhase("active");
    expect(await screen.findByText("Browser tidak didukung")).toBeTruthy();
    expect(screen.getByText("Browser not supported")).toBeTruthy();
    expect(screen.getByText("Gunakan Chrome terbaru di ponsel ini.")).toBeTruthy();
    expect(
      screen.getByText(
        "This browser can't encode audio for capture. Use the latest Chrome on the shop phone.",
      ),
    ).toBeTruthy();
  });
});
