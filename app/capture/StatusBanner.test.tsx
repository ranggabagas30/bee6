// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBanner } from "@/app/capture/StatusBanner";

afterEach(() => cleanup());

describe("StatusBanner idle (no session running)", () => {
  it("shows the neutral Bahasa and English not-started label", () => {
    render(<StatusBanner state="idle" micSource="built-in" />);
    expect(screen.getByText("Belum mulai")).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText("Pengambilan audio belum berjalan")).toBeTruthy();
    expect(screen.getByText("Audio capture is not running")).toBeTruthy();
  });

  it("never shows Mendengarkan or Listening while idle", () => {
    const { container } = render(
      <StatusBanner state="idle" micSource="built-in" />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Mendengarkan");
    expect(text).not.toContain("Listening");
    expect(text).not.toContain("Mikrofon / Microphone");
  });

  it("keeps the idle region polite-live with a non-green decorative emoji", () => {
    const { container } = render(
      <StatusBanner state="idle" micSource="built-in" />,
    );
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("⚪");
  });
});

describe("StatusBanner bilingual labels", () => {
  it("shows the Bahasa and English listening labels", () => {
    render(<StatusBanner state="listening" micSource="built-in" />);
    expect(screen.getByText("Mendengarkan")).toBeTruthy();
    expect(screen.getByText("Listening")).toBeTruthy();
  });

  it("keeps the green listening headline while uploads are failing (offline engine state)", () => {
    const { container } = render(
      <StatusBanner state="offline" micSource="built-in" />,
    );
    expect(screen.getByText("Mendengarkan")).toBeTruthy();
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("🟢");
    const text = container.textContent ?? "";
    expect(text).not.toContain("uploads waiting");
    expect(text).not.toContain("pengiriman tertunda");
    expect(text).not.toContain("Terputus");
    expect(text).not.toContain("Offline");
  });

  it("never changes the offline headline with the queued count", () => {
    const one = render(<StatusBanner state="offline" micSource="built-in" />);
    const oneText = one.container.textContent;
    one.unmount();
    const many = render(<StatusBanner state="offline" micSource="built-in" />);
    expect(many.container.textContent).toBe(oneText);
  });

  it("shows no connectivity detail in the banner while uploads fail (it lives on the upload line)", () => {
    const { container } = render(
      <StatusBanner state="offline" micSource="built-in" />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Tidak ada internet");
    expect(text).not.toContain("No internet");
    expect(text).not.toContain("Server sibuk");
    expect(text).not.toContain("Server busy");
  });

  it("renders the same text as the listening banner while uploads fail", () => {
    const listening = render(<StatusBanner state="listening" micSource="built-in" />);
    const listeningText = listening.container.textContent;
    listening.unmount();
    const offline = render(<StatusBanner state="offline" micSource="built-in" />);
    expect(offline.container.textContent).toBe(listeningText);
  });

  it("shows the Bahasa and English mic-problem labels", () => {
    render(<StatusBanner state="mic_error" micSource="unknown" />);
    expect(screen.getByText("Mikrofon bermasalah")).toBeTruthy();
    expect(screen.getByText("Microphone problem")).toBeTruthy();
  });

  it("shows the Bahasa and English mic-problem detail, Bahasa first", () => {
    render(<StatusBanner state="mic_error" micSource="unknown" />);
    const bahasa = screen.getByText("Periksa mikrofon dan koneksi");
    const english = screen.getByText("Check the microphone and connection");
    expect(bahasa.compareDocumentPosition(english) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["listening", "offline", "mic_error"] as const)(
    "shows the mic source exactly once in the %s state",
    (state) => {
    const { container } = render(
      <StatusBanner state={state} micSource="built-in" />,
    );
    const text = container.textContent ?? "";
    expect(text.split("Mikrofon / Microphone: built-in").length - 1).toBe(1);
    expect(text).not.toContain("Mikrofon: ");
  });

  it("keeps the status region polite-live and the emoji decorative", () => {
    const { container } = render(
      <StatusBanner state="listening" micSource="built-in" />,
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    const emoji = container.querySelector('[aria-hidden="true"]');
    expect(emoji?.textContent).toBe("🟢");
  });
});
