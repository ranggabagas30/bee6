// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { parseLangCookie, type Lang } from "@/lib/i18n/lang";

// One language per render (UX-03 §3, copy rules): every shop-facing string on the
// capture page comes from the dictionary in the language the page is in. The
// language switch in the top bar is the one place both names appear, by design.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/capture/dev-mode", () => ({ isDevControlsEnabled: () => false }));

const readDeviceAuth = vi.fn<() => { deviceToken: string; deviceId: string } | null>(() => null);
const fetchCaptureConfig = vi.fn<(auth: unknown) => Promise<unknown>>();
const postSessionStart = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const postSessionEnd = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const postSessionDiscard = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("@/lib/capture/browser/client", () => ({
  readDeviceAuth: () => readDeviceAuth(),
  fetchCaptureConfig: (auth: unknown) => fetchCaptureConfig(auth),
  postSessionStart: (auth: unknown, body: unknown) => postSessionStart(auth, body),
  postSessionEnd: (auth: unknown, id: string, body: unknown) => postSessionEnd(auth, id, body),
  postSessionDiscard: (auth: unknown, id: string, body: unknown) =>
    postSessionDiscard(auth, id, body),
}));

vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-1111-1111-111111111111" });

vi.mock("@/lib/capture/browser/session", () => ({
  startCaptureSession: async (
    _auth: unknown,
    _config: unknown,
    cb: { onMicSource: (s: string) => void },
  ) => {
    cb.onMicSource("built-in");
    return { stop: vi.fn(async () => {}) };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  document.cookie = "bee6_lang=; Path=/; Max-Age=0";
});

function pinClock(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

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

function headingText(): string | null {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

describe("capture page: the heading is one fixed neutral heading (UX-03 decision 7 Oct)", () => {
  it("reads Shop phone in EN and HP toko in ID in the idle state", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    await renderPage("en");
    await waitFor(() => expect(headingText()).toBe("Shop phone"));
    cleanup();
    await renderPage("id");
    await waitFor(() => expect(headingText()).toBe("HP toko"));
  });

  it("is the same heading while listening (a session running)", async () => {
    // Wed 2026-09-30 10:00 WIB: inside the Mulai window (closes at 18:00)
    pinClock("2026-09-30T03:00:00Z");
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    await renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(headingText()).toBe("Shop phone");
  });

  it("is the same heading when the config cannot load (error state)", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockRejectedValue(new Error("offline"));
    await renderPage("en");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(headingText()).toBe("Shop phone");
  });
});

describe("capture page: one language per render", () => {
  it("EN is the default when the cookie is missing: idle screen in English only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage(parseLangCookie(undefined));
    await waitFor(() => expect(screen.getByText("Shop phone")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Mendengarkan|Belum|Memuat|Jam buka|Pilih bahasa/);
  });

  it("ID when the cookie is id: idle screen in Bahasa only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage(parseLangCookie("id"));
    await waitFor(() => expect(screen.getByText("HP toko")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Mulai" })).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Shop phone|^Start$|Loading|Choose language/);
  });

  it("upload block is in the DOM in every mode, including idle", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    await renderPage("en");
    await waitFor(() => expect(screen.getByText("Shop phone")).toBeTruthy());
    expect(screen.getByTestId("upload-status").getAttribute("aria-live")).toBe("polite");
  });

  it("privacy notice renders once per page, in English only, under en", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage("en");
    await waitFor(() => expect(screen.getByText("Shop phone")).toBeTruthy());
    expect(screen.getAllByText("Speech becomes short work notes. Audio is not kept.")).toHaveLength(1);
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Suara diubah|Rekaman suara/);
  });

  it("privacy notice renders once per page, in Bahasa only, under id", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage("id");
    await waitFor(() => expect(screen.getByText("HP toko")).toBeTruthy());
    expect(
      screen.getAllByText("Suara diubah jadi catatan kerja singkat. Rekaman suara tidak disimpan."),
    ).toHaveLength(1);
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Speech becomes|Audio is not kept/);
  });

  it("the running screen (Selesai note + Batalkan) is Bahasa only under id", async () => {
    // Wed 2026-09-30 10:00 WIB: inside the Mulai window (closes at 18:00)
    pinClock("2026-09-30T03:00:00Z");
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage("id");
    fireEvent.click(await screen.findByRole("button", { name: "Mulai" }));
    await waitFor(() => expect(screen.getByText("Mendengarkan")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Batalkan sesi" })).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Listening|Cancel session|End\b/);
  });

  it("the running screen is English only under en", async () => {
    // Wed 2026-09-30 10:00 WIB: inside the Mulai window (closes at 18:00)
    pinClock("2026-09-30T03:00:00Z");
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage("en");
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(screen.getByText("Listening")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Cancel session" })).toBeTruthy();
    const body = container.querySelector("main")?.textContent ?? "";
    expect(body).not.toMatch(/Mendengarkan|Batalkan sesi/);
  });
});

// Bahasa and English words that must never appear on the other language's screen. The
// top-bar switch names both languages by design, so those two labels are removed first.
const SWITCH_LABELS = /Bahasa Indonesia|English/g;
const ID_WORDS = /\b(Mendengarkan|Belum|Hari|Jam|Dijeda|Tutup|Mikrofon|Sudah|Memuat|Batas|Mengunggah|Sebagian|Tidak|Suara|Rekaman|Pilih|Lanjutkan|Tekan|Ketuk)\b/;
const EN_WORDS = /\b(Listening|Shop|Not started|Closed|Next|Paused|Opening|Loading|Microphone|Uploading|Some speech|Choose|Recording|Today|Tap|Continue|hours)\b/;

describe("capture page: no Bahasa text on an EN screen, no English on an ID screen", () => {
  it("idle: EN is English only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage("en");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    const body = (container.querySelector("main")?.textContent ?? "").replace(SWITCH_LABELS, "");
    expect(body).toContain("Shop phone");
    expect(body).not.toMatch(ID_WORDS);
  });

  it("idle: ID is Bahasa only", async () => {
    readDeviceAuth.mockReturnValue({ deviceToken: "t", deviceId: "d" });
    fetchCaptureConfig.mockResolvedValue(CONFIG);
    const { container } = await renderPage("id");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
    const body = (container.querySelector("main")?.textContent ?? "").replace(SWITCH_LABELS, "");
    expect(body).toContain("HP toko");
    expect(body).not.toMatch(EN_WORDS);
  });
});
