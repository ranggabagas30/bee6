// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import type { StartDemoResult } from "@/app/demo/demo-client";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";
import { axeViolations } from "@/lib/testing/axe";
import { PairScreen } from "@/app/pair/PairScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/auth/client/firebase-client", () => ({ getClientAuth: () => ({ kind: "fake-auth" }), signOut: vi.fn(), signInWithCustomToken: vi.fn() }));

const startOrSwitch = vi.fn<(role: string, options: { navigate?: (path: string) => void }) => Promise<StartDemoResult>>();
vi.mock("@/app/demo/demo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/demo/demo-client")>()),
  startOrSwitch: (role: string, options: { navigate?: (path: string) => void }) => startOrSwitch(role, options),
}));

const PAIR_OK = { data: { device_token: "tok-1", device_id: "dev-1", outlet_id: "outlet-7" } };
const OVERNIGHT = { open: "09:30", close: "01:00" };
function configBody(day: { open: string; close: string } | null, sunday: { open: string; close: string } | null = day) {
  return { timezone: "Asia/Jakarta", weekly_hours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: sunday }, last_ended: null, capture_mode: "room" };
}
const CONFIG_OK = { data: configBody(OVERNIGHT) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubPairThenConfig(configStatus: number, body: unknown = CONFIG_OK) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/devices/pair") return json(PAIR_OK);
      if (url === "/api/v1/capture/config") return configStatus === 200 ? json(body) : json({ error: { code: "INTERNAL_ERROR" } }, configStatus);
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}
/** Wed 2026-09-30 10:00 WIB: an open day. */
function pinOpenDay() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T03:00:00Z"));
}

function renderScreen(props: { demo?: boolean; lang?: "en" | "id" } = {}) {
  return render(
    <LangProvider initial={props.lang ?? "en"}>
      <PairScreen demo={props.demo ?? false} config={null} />
    </LangProvider>,
  );
}
function fillCodeAndSubmit(code: string) {
  fireEvent.change(screen.getByLabelText(/6-digit code|Kode 6 digit/), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: /^Set up$|^Pasang$/ }));
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  startOrSwitch.mockReset();
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PairScreen on the pilot (demo=false): Set up this device, pilot copy unchanged", () => {
  it("shows the heading, the help line and no demo box or demo text", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Set up this device" })).toBeTruthy();
    expect(screen.getByText("Enter the 6-digit code from the person who set up this phone.")).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/demo|000000|judge/i);
  });

  it("maps a server error code to dictionary text and never renders the server message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED", message: "Invalid or expired pairing code" } }, 401)));
    renderScreen();
    fillCodeAndSubmit("123456");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Code not recognized or already used."));
    expect(document.body.textContent).not.toContain("Invalid or expired pairing code");
  });

  it("shows the server line for a 500 (ID too) and the network line for a failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "INTERNAL_ERROR", message: "Firestore quota exceeded" } }, 500)));
    renderScreen({ lang: "id" });
    fillCodeAndSubmit("123456");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Server belum bisa memproses ini."));
    expect(document.body.textContent).not.toContain("Firestore quota exceeded");
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("network down"))));
    renderScreen({ lang: "id" });
    fillCodeAndSubmit("123456");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Tidak ada koneksi."));
  });

  it("success: 'Phone set up', the outlet line, the four pilot steps (step 3 ends at the Mulai window end) and a link to /capture", async () => {
    pinOpenDay();
    stubPairThenConfig(200);
    renderScreen();
    fillCodeAndSubmit("123456");
    expect(await screen.findByRole("heading", { level: 1, name: "Phone set up" }, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("For outlet outlet-7")).toBeTruthy();
    expect(screen.getByText("Leave the phone in one fixed place and plug in the charger.")).toBeTruthy();
    expect(screen.getByText("Keep the screen on and this page open. Closing the page means not listening.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/You can tap Start from 01:00 until 21:00, on each open day\./)).toBeTruthy());
    expect(screen.getByText("The End button appears 4 hours after Start.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the listening page" }).getAttribute("href")).toBe("/capture");
    expect(document.body.textContent).not.toContain("judge guide");
  });

  it("success on a closed day hides step 3; a config failure keeps the other steps and the link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T03:00:00Z")); // Sunday, closed
    stubPairThenConfig(200, { data: configBody(OVERNIGHT, null) });
    renderScreen();
    fillCodeAndSubmit("123456");
    await screen.findByText("Phone set up", {}, { timeout: 3000 });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/v1/capture/config", expect.anything()));
    await act(async () => {});
    expect(screen.queryByText(/You can tap Start from/)).toBeNull();
    cleanup();
    stubPairThenConfig(500);
    renderScreen();
    fillCodeAndSubmit("123456");
    await screen.findByText("Phone set up", {}, { timeout: 3000 });
    expect(screen.getByText("Leave the phone in one fixed place and plug in the charger.")).toBeTruthy();
    expect(screen.queryByText(/You can tap Start from/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open the listening page" })).toBeTruthy();
  });

  it("after pairing, the card is a named region (its aria-labelledby points at the heading)", async () => {
    pinOpenDay();
    stubPairThenConfig(200);
    renderScreen();
    expect(screen.getByRole("region", { name: "Set up this device" })).toBeTruthy();
    fillCodeAndSubmit("123456");
    await screen.findByRole("heading", { level: 1, name: "Phone set up" }, { timeout: 3000 });
    expect(screen.getByRole("region", { name: "Phone set up" })).toBeTruthy();
  });

  it("a code set the way the judge guide's Fill in sets it (native setter + input event on #pairing-code) shows in the six boxes and enables the button", () => {
    renderScreen();
    const input = document.getElementById("pairing-code") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "000000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(screen.getAllByTestId("pair-box").map((b) => b.textContent).join("")).toBe("000000");
    expect((screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("success in Bahasa", async () => {
    pinOpenDay();
    stubPairThenConfig(200);
    renderScreen({ lang: "id" });
    fillCodeAndSubmit("123456");
    expect(await screen.findByText("HP terpasang", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Letakkan HP di tempat tetap dan colokkan charger.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Buka halaman mendengarkan" })).toBeTruthy();
  });

  it("axe finds no violation on the form and on the checklist", async () => {
    pinOpenDay();
    stubPairThenConfig(200);
    const { container } = renderScreen();
    expect(await axeViolations(container)).toEqual([]);
    fillCodeAndSubmit("123456");
    await screen.findByText("Phone set up", {}, { timeout: 3000 });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("PairScreen on the demo (demo=true): the demo code opens a sandbox, then Device set up with the demo steps", () => {
  it("shows the same Set up this device screen with the demo box, but no code, no Fill in and no fresh-demo control", async () => {
    renderScreen({ demo: true });
    await screen.findByTestId("demo-status");
    expect(screen.getByRole("heading", { level: 1, name: "Set up this device" })).toBeTruthy();
    expect(screen.getByText(/Each sign-in opens your own private copy of a fictional shop for 2 hours/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("000000");
    expect(screen.queryByRole("button", { name: /Fill in|Start a fresh demo/ })).toBeNull();
  });

  it("the demo code starts a staff demo without a hard navigation, never calls the pair route, then shows Device set up", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderScreen({ demo: true });
    await screen.findByTestId("demo-status");
    await act(async () => {
      fillCodeAndSubmit("000000");
    });
    await waitFor(() => expect(startOrSwitch).toHaveBeenCalledTimes(1));
    expect(startOrSwitch.mock.calls[0]![0]).toBe("staff");
    expect(typeof startOrSwitch.mock.calls[0]![1].navigate).toBe("function"); // the screen shows the next step itself
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { level: 1, name: "Device set up" })).toBeTruthy();
    expect(screen.getByText("Keep this page open while you run the demo.")).toBeTruthy();
    expect(screen.getByText("Allow the microphone when asked.")).toBeTruthy();
    expect(screen.getByText("Tap Start, then speak the script cards in the judge guide.")).toBeTruthy();
    expect(screen.getByText("End becomes available at closing time: use Jump to closing time in the judge guide.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the listening page" }).getAttribute("href")).toBe("/capture");
    expect(screen.queryByText(/For outlet/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/000000|charger|4 hours after Start/);
  });

  it("a refusal is explained in the demo box and the form is usable again", async () => {
    startOrSwitch.mockResolvedValue({ kind: "daily_cap", retryAfterSeconds: 7200 });
    renderScreen({ demo: true });
    await screen.findByTestId("demo-status");
    await act(async () => {
      fillCodeAndSubmit("000000");
    });
    await waitFor(() => expect(screen.getByTestId("demo-status").textContent).toContain("The demo has reached today's limit."));
    expect((screen.getByRole("button", { name: "Set up" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Device set up")).toBeNull();
  });

  it("after the demo pairing, the card is a named region 'Device set up'", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    renderScreen({ demo: true });
    await screen.findByTestId("demo-status");
    await act(async () => {
      fillCodeAndSubmit("000000");
    });
    await screen.findByRole("heading", { level: 1, name: "Device set up" });
    expect(screen.getByRole("region", { name: "Device set up" })).toBeTruthy();
  });

  it("any other code takes the real pair route and starts no demo", async () => {
    const fetchMock = vi.fn(async () => json({ error: { code: "UNAUTHORIZED" } }, 401));
    vi.stubGlobal("fetch", fetchMock);
    renderScreen({ demo: true });
    await screen.findByTestId("demo-status");
    await act(async () => {
      fillCodeAndSubmit("123456");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(startOrSwitch).not.toHaveBeenCalled();
  });

  it("axe finds no violation with the demo box and on Device set up", async () => {
    startOrSwitch.mockResolvedValue({ kind: "started" });
    const { container } = renderScreen({ demo: true });
    await screen.findByTestId("demo-status");
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => {
      fillCodeAndSubmit("000000");
    });
    await screen.findByRole("heading", { level: 1, name: "Device set up" });
    expect(await axeViolations(container)).toEqual([]);
  });
});
