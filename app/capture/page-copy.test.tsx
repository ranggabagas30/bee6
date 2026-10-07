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
  vi.useRealTimers();
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

// The "(Nx)" count sits in an aria-hidden span, so the row is matched on its <p> text.
function rowByText(text: string) {
  return screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);
}

describe("capture page: the heading is one fixed neutral heading (UX-03 decision 7 Oct)", () => {
  function headingText(): string | null {
    return screen.getByRole("heading", { level: 1 }).textContent;
  }

  it("reads Shop phone in EN and HP toko in ID while outside hours", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    await renderPage("en");
    await waitFor(() => expect(headingText()).toBe("Shop phone"));
    cleanup();
    await renderPage("id");
    await waitFor(() => expect(headingText()).toBe("HP toko"));
  });

  it("is the same heading while listening (active, a session running)", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("active");
    await renderPage("en");
    await waitFor(() => expect(screen.getByText("Some speech was not captured")).toBeTruthy());
    expect(headingText()).toBe("Shop phone");
    cleanup();
    await renderPage("id");
    await waitFor(() => expect(screen.getByText("Sebagian suara tidak tercatat")).toBeTruthy());
    expect(headingText()).toBe("HP toko");
  });

  it("is the same heading when the opening hours cannot load (error state)", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockRejectedValue(new Error("offline"));
    await renderPage("en");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(headingText()).toBe("Shop phone");
  });
});

describe("capture page: one language per render", () => {
  it("EN is the default when the cookie is missing: headline and hours in English only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage(parseLangCookie(undefined));
    await waitFor(() => expect(screen.getByText("Shop phone")).toBeTruthy());
    expect(screen.getByText(/Listening runs from 08:00 to 22:00/)).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Mendengarkan|Dijeda|Mulai|Memuat|Jam buka|Pilih/);
  });

  it("ID when the cookie is id: headline and hours in Bahasa only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage(parseLangCookie("id"));
    await waitFor(() => expect(screen.getByText("HP toko")).toBeTruthy());
    expect(screen.getByText(/Mendengarkan berjalan dari pukul 08:00/)).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Shop listening|Listening runs|Paused|Resumes/);
  });

  it("upload block is in the DOM in every mode, including outside hours", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    await renderPage("en");
    await waitFor(() => expect(screen.getByText("Shop phone")).toBeTruthy());
    expect(screen.getByTestId("upload-status").getAttribute("aria-live")).toBe("polite");
  });

  it("privacy notice renders once per page, in English only, under en", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage("en");
    await waitFor(() => expect(screen.getByText("Shop phone")).toBeTruthy());
    expect(screen.getAllByText("Speech becomes short work notes. Audio is not kept.")).toHaveLength(1);
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Suara diubah|Rekaman suara/);
  });

  it("privacy notice renders once per page, in Bahasa only, under id", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage("id");
    await waitFor(() => expect(screen.getByText("HP toko")).toBeTruthy());
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
    expect(screen.getByText("Shop phone")).toBeTruthy();
    expect(container.textContent).toContain("🟢");
    expect(container.textContent).not.toContain("🟡");
    // The retry state stays in the upload block.
    expect(rowByText("Not sent yet · retrying (2x)")).toBeTruthy();
  });

  it("active with a lost segment: the lost line and retry row are Bahasa only under id", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("active");
    const { container } = await renderPage("id");
    await waitFor(() =>
      expect(screen.getByText("Sebagian suara tidak tercatat")).toBeTruthy(),
    );
    expect(rowByText("Belum terkirim · mencoba lagi (2x)")).toBeTruthy();
    expect(screen.getByText("Server sibuk")).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Some speech|Not sent yet|Server busy|Microphone:|Listening|Audio is being/);
  });
});

// Monday 2026-10-12 23:30 in Asia/Jakarta: after the 22:00 close and the 18:00 Start cut-off.
const MON_2330_JKT = new Date("2026-10-12T16:30:00Z");

describe("capture page: the status banner after the planned close (UX-03 decision 7 Oct)", () => {
  it("after a time-based close with no session today: Not started and the Mulai note; the hours section is not the only content", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MON_2330_JKT);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    const { container } = await renderPage("en");
    await waitFor(() => expect(screen.getByText("Not started")).toBeTruthy());
    expect(
      screen.getByText(
        "The Start cut-off today passed at 18:00. Today is recorded as a day off. Next Start Tue 13 Oct at 01:00.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Paused · outside opening hours")).toBeTruthy();
    expect(container.querySelector("main")?.textContent).not.toMatch(/Ended automatically/);
  });

  it("a session that auto-stopped today (server last_ended) shows Ended automatically, not Not started", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MON_2330_JKT);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue({
      ...CONFIG,
      last_ended: { business_date: "2026-10-12", end_reason: "auto_stop", debrief_ends_at_ms: null },
    });
    resolveCapturePhase.mockReturnValue("outside_hours");
    await renderPage("en");
    await waitFor(() => expect(screen.getByText("Ended automatically at 23:00")).toBeTruthy());
    expect(screen.queryByText("Not started")).toBeNull();
  });

  it("a session that this page saw auto-stop at the close shows Ended automatically on the next tick", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MON_2330_JKT);
    // Capture the page's 30 s phase tick instead of faking timers (fake timers also stop
    // testing-library's waitFor polling). Every other interval is passed through.
    const realSetInterval = globalThis.setInterval;
    const realSetTimeout = globalThis.setTimeout;
    let phaseTick: (() => void) | null = null;
    const spy = vi.spyOn(globalThis, "setInterval").mockImplementation(((
      fn: () => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      if (ms === 30_000) {
        phaseTick = fn;
        return 0 as unknown as ReturnType<typeof setInterval>;
      }
      return realSetInterval(fn, ms, ...rest);
    }) as typeof setInterval);
    try {
      readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
      fetchCaptureConfig.mockResolvedValue(CONFIG);
      resolveCapturePhase.mockReturnValue("active");
      await renderPage("en");
      await waitFor(() => expect(screen.getByText("Some speech was not captured")).toBeTruthy());
      resolveCapturePhase.mockReturnValue("outside_hours");
      phaseTick?.();
      await new Promise((resolve) => realSetTimeout(resolve, 50));
      expect(screen.getByText("Ended automatically at 23:00")).toBeTruthy();
      expect(screen.queryByText("Not started")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("the heading and the banner stay on the page after the close", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MON_2330_JKT);
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    resolveCapturePhase.mockReturnValue("outside_hours");
    await renderPage("id");
    await waitFor(() => expect(screen.getByText("Belum mulai")).toBeTruthy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("HP toko");
  });
});

// Bahasa and English words that must never appear on the other language's screen. The
// top-bar switch names both languages by design, so those two labels are removed first.
const SWITCH_LABELS = /Bahasa Indonesia|English/g;
const ID_WORDS = /\b(Mendengarkan|Belum|Selesai|Mulai|Hari|Jam|Dijeda|Tutup|Mikrofon|Sudah|Memuat|Batas|Mengunggah|Sebagian|Server sibuk|Tidak|Suara|Rekaman|Pilih|Lanjutkan|Tekan|Ketuk)\b/;
const EN_WORDS = /\b(Listening|Shop|Not started|Ended|Start|Closed|Next|Paused|Opening|Loading|Microphone|Uploading|Some speech|Server busy|Choose|Recording|Today|Tap|Continue|hours)\b/;

describe("capture page: no Bahasa text on an EN screen, no English on an ID screen", () => {
  const SCENARIOS: Array<{ name: string; phase: "active" | "outside_hours"; config: unknown }> = [
    { name: "outside hours after a close", phase: "outside_hours", config: CONFIG },
    {
      name: "auto-stopped today",
      phase: "outside_hours",
      config: { ...CONFIG, last_ended: { business_date: "2026-10-12", end_reason: "auto_stop", debrief_ends_at_ms: null } },
    },
    { name: "listening with a lost segment", phase: "active", config: CONFIG },
  ];

  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: EN is English only`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(MON_2330_JKT);
      readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
      fetchCaptureConfig.mockResolvedValue(scenario.config);
      resolveCapturePhase.mockReturnValue(scenario.phase);
      const { container } = await renderPage("en");
      await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
      await waitFor(() => expect(container.querySelector("[data-testid='upload-status']")).toBeTruthy());
      const body = (container.querySelector("main")?.textContent ?? "").replace(SWITCH_LABELS, "");
      expect(body).toContain("Shop phone");
      expect(body).not.toMatch(ID_WORDS);
    });

    it(`${scenario.name}: ID is Bahasa only`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(MON_2330_JKT);
      readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
      fetchCaptureConfig.mockResolvedValue(scenario.config);
      resolveCapturePhase.mockReturnValue(scenario.phase);
      const { container } = await renderPage("id");
      await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
      await waitFor(() => expect(container.querySelector("[data-testid='upload-status']")).toBeTruthy());
      const body = (container.querySelector("main")?.textContent ?? "").replace(SWITCH_LABELS, "");
      expect(body).toContain("HP toko");
      expect(body).not.toMatch(EN_WORDS);
    });
  }
});
