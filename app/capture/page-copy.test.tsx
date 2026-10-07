// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { parseLangCookie, type Lang } from "@/lib/i18n/lang";
import type { CaptureStatus } from "@/lib/capture/browser/engine";

// One language per render (UX-03 §3, copy rules): every shop-facing string on the
// capture page comes from the dictionary in the language the page is in. The
// language switch in the top bar is the one place both names appear, by design.

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/capture/dev-mode", () => ({ isDevControlsEnabled: () => false }));

const readDeviceAuth = vi.fn<() => { deviceToken: string; deviceId: string } | null>(() => null);
const fetchCaptureConfig = vi.fn<(auth: unknown) => Promise<unknown>>();
const resolveCapturePhase = vi.fn<(config: unknown, now: unknown) => "outside_hours" | "active">(
  () => "outside_hours",
);
vi.mock("@/lib/capture/browser/client", () => ({
  readDeviceAuth: () => readDeviceAuth(),
  fetchCaptureConfig: (auth: unknown) => fetchCaptureConfig(auth),
  resolveCapturePhase: (config: unknown, now: unknown) => resolveCapturePhase(config, now),
}));

// A session that reports one engine status on start: a dropped segment still
// waiting for a 2xx, so the lost line and the retry count are on screen.
const LOST_STATUS: CaptureStatus = {
  state: "offline",
  queuedCount: 1,
  droppedCount: 1,
  micError: null,
  lastUploadHttpStatus: 503,
  lostSinceSuccess: true,
  headFailedAttempts: 2,
};
vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: async (_auth: unknown, _config: unknown, cb: {
    onStatus: (s: CaptureStatus) => void;
    onMicSource: (s: string) => void;
  }) => {
    cb.onMicSource("built-in");
    cb.onStatus(LOST_STATUS);
    return { stop: vi.fn(async () => {}) };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.cookie = "bee6_lang=; Path=/; Max-Age=0";
});

async function renderPage(lang: Lang) {
  const { default: CapturePage } = await import("@/app/capture/page");
  return render(
    <LangProvider initial={lang}>
      <CapturePage />
    </LangProvider>,
  );
}

const CONFIG = {
  timezone: "Asia/Jakarta",
  weekly_hours: {
    sun: null,
    mon: { open: "08:00", close: "22:00" },
    tue: { open: "08:00", close: "22:00" },
    wed: { open: "08:00", close: "22:00" },
    thu: { open: "08:00", close: "22:00" },
    fri: { open: "08:00", close: "22:00" },
    sat: { open: "08:00", close: "22:00" },
  },
  last_ended: null,
};

describe("capture page: one language per render", () => {
  it("EN is the default when the cookie is missing: headline and hours in English only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage(parseLangCookie(undefined));
    await waitFor(() => expect(screen.getByText("Shop listening")).toBeTruthy());
    expect(screen.getByText(/Listening runs from 08:00 to 22:00/)).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Mendengarkan|Dijeda|Mulai|Memuat|Jam buka|Pilih/);
  });

  it("ID when the cookie is id: headline and hours in Bahasa only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage(parseLangCookie("id"));
    await waitFor(() => expect(screen.getByText("Mendengarkan toko")).toBeTruthy());
    expect(screen.getByText(/Mendengarkan berjalan dari pukul 08:00/)).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Shop listening|Listening runs|Paused|Resumes/);
  });

  it("upload block is in the DOM in every mode, including outside hours", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    await renderPage("en");
    await waitFor(() => expect(screen.getByText("Shop listening")).toBeTruthy());
    expect(screen.getByTestId("upload-status").getAttribute("aria-live")).toBe("polite");
  });

  it("privacy notice renders once per page, in English only, under en", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage("en");
    await waitFor(() => expect(screen.getByText("Shop listening")).toBeTruthy());
    expect(screen.getAllByText("Speech becomes short work notes. Audio is not kept.")).toHaveLength(1);
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Suara diubah|Rekaman suara/);
  });

  it("privacy notice renders once per page, in Bahasa only, under id", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage("id");
    await waitFor(() => expect(screen.getByText("Mendengarkan toko")).toBeTruthy());
    expect(
      screen.getAllByText("Suara diubah jadi catatan kerja singkat. Rekaman suara tidak disimpan."),
    ).toHaveLength(1);
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Speech becomes|Audio is not kept/);
  });

  it("an offline upload failure keeps the headline green Listening (UX-03 decision A)", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("active");
    const { container } = await renderPage("en");
    await waitFor(() =>
      expect(screen.getByText("Some speech was not captured")).toBeTruthy(),
    );
    // The engine status is "offline" here (LOST_STATUS), but the headline never shows it.
    expect(screen.getByText("Shop listening")).toBeTruthy();
    expect(container.textContent).toContain("🟢");
    expect(container.textContent).not.toContain("🟡");
    // The retry state stays in the upload block.
    expect(screen.getByText("Not sent yet · retrying (2x)")).toBeTruthy();
  });

  it("active with a lost segment: the lost line and retry row are Bahasa only under id", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("active");
    const { container } = await renderPage("id");
    await waitFor(() =>
      expect(screen.getByText("Sebagian suara tidak tercatat")).toBeTruthy(),
    );
    expect(screen.getByText("Belum terkirim · mencoba lagi (2x)")).toBeTruthy();
    expect(screen.getByText("Server sibuk")).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Some speech|Not sent yet|Server busy|Microphone:|Listening|Audio is being/);
  });
});
