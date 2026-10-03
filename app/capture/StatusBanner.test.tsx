// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBanner } from "@/app/capture/StatusBanner";

afterEach(() => cleanup());

describe("StatusBanner bilingual labels", () => {
  it("shows the Bahasa and English listening labels", () => {
    render(<StatusBanner state="listening" queuedCount={0} micSource="built-in" />);
    expect(screen.getByText("Mendengarkan")).toBeTruthy();
    expect(screen.getByText("Listening")).toBeTruthy();
  });

  it("shows the Bahasa and English offline labels, keeping the waiting count as-is", () => {
    render(<StatusBanner state="offline" queuedCount={3} micSource="built-in" />);
    expect(screen.getByText("Terputus, menunggu sambungan")).toBeTruthy();
    expect(screen.getByText("Offline, waiting to reconnect")).toBeTruthy();
    expect(screen.getByText("3 segments waiting")).toBeTruthy();
  });

  it("shows the Bahasa waiting-count line above the English one", () => {
    render(<StatusBanner state="offline" queuedCount={3} micSource="built-in" />);
    const bahasa = screen.getByText("3 rekaman menunggu dikirim");
    const english = screen.getByText("3 segments waiting");
    expect(bahasa.compareDocumentPosition(english) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses the singular English noun for one waiting segment, Bahasa unchanged", () => {
    render(<StatusBanner state="offline" queuedCount={1} micSource="built-in" />);
    expect(screen.getByText("1 rekaman menunggu dikirim")).toBeTruthy();
    expect(screen.getByText("1 segment waiting")).toBeTruthy();
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
