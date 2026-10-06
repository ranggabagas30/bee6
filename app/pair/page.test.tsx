// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import PairPage from "@/app/pair/page";

// jsdom's localStorage is not available in this vitest setup, so the device
// storage the success path writes is an in-memory stand-in.
const memory = new Map<string, string>();
function stubLocalStorage() {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  });
}
beforeEach(() => {
  stubLocalStorage();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const PAIR_OK = {
  data: { device_token: "tok-1", device_id: "dev-1", outlet_id: "outlet-7" },
};
const CONFIG_OK = {
  data: {
    consent_complete: true,
    opening_time: "09:30",
    closing_time: "01:00",
    timezone: "Asia/Jakarta",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  memory.clear();
  push.mockClear();
});

function fillCodeAndSubmit(code: string) {
  fireEvent.change(screen.getByLabelText(/6-digit code|Kode 6 digit/), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: /Set up|Pasang/ }));
}

describe("PairPage error copy", () => {
  it("maps a server error code to dictionary text and never renders the server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "UNAUTHORIZED", message: "Invalid or expired pairing code" } },
          401,
        ),
      ),
    );
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Code not recognized or already used.",
      ),
    );
    expect(document.body.textContent).not.toContain("Invalid or expired pairing code");
  });

  it("shows the server line, not the connection line, for a 500 and hides the server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Firestore quota exceeded" } }, 500),
      ),
    );
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "The server could not finish this.",
      ),
    );
    expect(screen.getByRole("alert").textContent).not.toContain("No connection.");
    expect(document.body.textContent).not.toContain("Firestore quota exceeded");
  });

  it("shows the Bahasa server line for a 500 when the language is id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500)));
    render(
      <LangProvider initial="id">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Server belum bisa memproses ini."),
    );
  });

  it("shows the Bahasa text for a network failure when the language is id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    render(
      <LangProvider initial="id">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Tidak ada koneksi."),
    );
  });
});

describe("PairPage code field layout", () => {
  it("sizes the code input with border-box so its 100% width does not overflow the column", () => {
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    const input = screen.getByLabelText(/6-digit code/) as HTMLInputElement;
    expect(window.getComputedStyle(input).boxSizing).toBe("border-box");
  });

  it("sizes the submit button with border-box so it matches the input width", () => {
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    const button = screen.getByRole("button", { name: /Set up/ });
    expect(window.getComputedStyle(button).boxSizing).toBe("border-box");
  });
});

describe("PairPage success (UX-03 section 5.1)", () => {
  function stubPairThenConfig(configStatus: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/devices/pair") return jsonResponse(PAIR_OK);
        if (url === "/api/v1/capture/config") {
          return configStatus === 200
            ? jsonResponse(CONFIG_OK)
            : jsonResponse({ error: { code: "INTERNAL_ERROR" } }, configStatus);
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  }

  it("shows the four-step checklist and the listening-page button in English", async () => {
    stubPairThenConfig(200);
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    expect(await screen.findByText("Phone set up", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("For outlet outlet-7")).toBeTruthy();
    expect(screen.getByText("Leave the phone in one fixed place and plug in the charger.")).toBeTruthy();
    expect(screen.getByText("Keep the screen on and this page open. Closing the page means not listening.")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/You can tap Start from 01:00 until 21:00, on each open day\./)).toBeTruthy(),
    );
    expect(screen.getByText("The End button appears 4 hours after Start.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the listening page" })).toBeTruthy();
  });

  it("shows the Bahasa checklist and button when the language is id", async () => {
    stubPairThenConfig(200);
    render(
      <LangProvider initial="id">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    expect(await screen.findByText("HP terpasang", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Letakkan HP di tempat tetap dan colokkan charger.")).toBeTruthy();
    expect(screen.getByText("Selesai muncul 4 jam setelah Mulai.")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/Mulai bisa ditekan 01:00 sampai 21:00, tiap hari buka\./)).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Buka halaman mendengarkan" })).toBeTruthy();
  });

  it("the listening-page button navigates to /capture", async () => {
    stubPairThenConfig(200);
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    fireEvent.click(await screen.findByRole("button", { name: "Open the listening page" }));
    expect(push).toHaveBeenCalledWith("/capture");
  });

  it("still shows the button and the other steps when the config cannot be loaded", async () => {
    stubPairThenConfig(500);
    render(
      <LangProvider initial="en">
        <PairPage />
      </LangProvider>,
    );
    fillCodeAndSubmit("123456");
    expect(await screen.findByText("Phone set up", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Leave the phone in one fixed place and plug in the charger.")).toBeTruthy();
    expect(screen.queryByText(/You can tap Start from/)).toBeNull();
    expect(screen.getByRole("button", { name: "Open the listening page" })).toBeTruthy();
  });
});
