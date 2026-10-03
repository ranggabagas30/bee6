// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBanner } from "@/app/capture/StatusBanner";

afterEach(() => cleanup());

describe("StatusBanner idle (no session running)", () => {
  it("shows the neutral Bahasa and English not-started label", () => {
    render(<StatusBanner state="idle" queuedCount={0} micSource="built-in" />);
    expect(screen.getByText("Belum mulai")).toBeTruthy();
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText("Pengambilan audio belum berjalan")).toBeTruthy();
    expect(screen.getByText("Audio capture is not running")).toBeTruthy();
  });

  it("never shows Mendengarkan or Listening while idle", () => {
    const { container } = render(
      <StatusBanner state="idle" queuedCount={0} micSource="built-in" />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Mendengarkan");
    expect(text).not.toContain("Listening");
    expect(text).not.toContain("Mikrofon / Microphone");
  });

  it("keeps the idle region polite-live with a non-green decorative emoji", () => {
    const { container } = render(
      <StatusBanner state="idle" queuedCount={0} micSource="built-in" />,
    );
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("⚪");
  });
});

describe("StatusBanner bilingual labels", () => {
  it("shows the Bahasa and English listening labels", () => {
    render(<StatusBanner state="listening" queuedCount={0} micSource="built-in" />);
    expect(screen.getByText("Mendengarkan")).toBeTruthy();
    expect(screen.getByText("Listening")).toBeTruthy();
  });

  it("shows listening-plus-waiting labels in the offline state, never Terputus or Offline", () => {
    const { container } = render(
      <StatusBanner state="offline" queuedCount={3} micSource="built-in" />,
    );
    expect(screen.getByText("Mendengarkan · pengiriman tertunda (3 menunggu)")).toBeTruthy();
    expect(screen.getByText("Listening · uploads waiting (3)")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toContain("Terputus");
    expect(text).not.toContain("Offline");
  });

  it("keeps the Bahasa waiting line above the English one in the offline state", () => {
    render(<StatusBanner state="offline" queuedCount={3} micSource="built-in" />);
    const bahasa = screen.getByText("Mendengarkan · pengiriman tertunda (3 menunggu)");
    const english = screen.getByText("Listening · uploads waiting (3)");
    expect(bahasa.compareDocumentPosition(english) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the waiting count for one segment without changing the wording", () => {
    render(<StatusBanner state="offline" queuedCount={1} micSource="built-in" />);
    expect(screen.getByText("Mendengarkan · pengiriman tertunda (1 menunggu)")).toBeTruthy();
    expect(screen.getByText("Listening · uploads waiting (1)")).toBeTruthy();
  });

  it("says Tidak ada internet / No internet when navigator reports offline", () => {
    render(
      <StatusBanner state="offline" queuedCount={2} micSource="built-in" online={false} />,
    );
    expect(screen.getByText("Tidak ada internet")).toBeTruthy();
    expect(screen.getByText("No internet")).toBeTruthy();
    expect(screen.queryByText("Server sibuk, mencoba lagi")).toBeNull();
  });

  it("says Server sibuk / Server busy when navigator reports online", () => {
    const { container } = render(
      <StatusBanner state="offline" queuedCount={2} micSource="built-in" online={true} />,
    );
    expect(screen.getByText("Server sibuk, mencoba lagi")).toBeTruthy();
    expect(screen.getByText("Server busy, retrying")).toBeTruthy();
    expect(container.textContent).not.toContain("Tidak ada internet");
    expect(container.textContent).not.toContain("No internet");
  });

  it("defaults to the online branch when the hint is omitted (never claims no internet)", () => {
    const { container } = render(
      <StatusBanner state="offline" queuedCount={2} micSource="built-in" />,
    );
    expect(screen.getByText("Server busy, retrying")).toBeTruthy();
    expect(container.textContent).not.toContain("No internet");
  });

  it("shows no connectivity hint in the listening state", () => {
    const { container } = render(
      <StatusBanner state="listening" queuedCount={0} micSource="built-in" online={false} />,
    );
    expect(container.textContent).not.toContain("No internet");
    expect(container.textContent).not.toContain("Server busy");
  });

  it("shows the Bahasa and English mic-problem labels", () => {
    render(<StatusBanner state="mic_error" queuedCount={0} micSource="unknown" />);
    expect(screen.getByText("Mikrofon bermasalah")).toBeTruthy();
    expect(screen.getByText("Microphone problem")).toBeTruthy();
  });

  it("shows the Bahasa and English mic-problem detail, Bahasa first", () => {
    render(<StatusBanner state="mic_error" queuedCount={0} micSource="unknown" />);
    const bahasa = screen.getByText("Periksa mikrofon dan koneksi");
    const english = screen.getByText("Check the microphone and connection");
    expect(bahasa.compareDocumentPosition(english) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["listening", 0],
    ["offline", 2],
    ["mic_error", 0],
  ] as const)("shows the mic source exactly once in the %s state", (state, queuedCount) => {
    const { container } = render(
      <StatusBanner state={state} queuedCount={queuedCount} micSource="built-in" />,
    );
    const text = container.textContent ?? "";
    expect(text.split("Mikrofon / Microphone: built-in").length - 1).toBe(1);
    expect(text).not.toContain("Mikrofon: ");
  });

  it("keeps the status region polite-live and the emoji decorative", () => {
    const { container } = render(
      <StatusBanner state="listening" queuedCount={0} micSource="built-in" />,
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    const emoji = container.querySelector('[aria-hidden="true"]');
    expect(emoji?.textContent).toBe("🟢");
  });
});
