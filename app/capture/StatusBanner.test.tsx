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

  it("shows the Bahasa and English mic-problem labels", () => {
    render(<StatusBanner state="mic_error" queuedCount={0} micSource="unknown" />);
    expect(screen.getByText("Mikrofon bermasalah")).toBeTruthy();
    expect(screen.getByText("Microphone problem")).toBeTruthy();
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
