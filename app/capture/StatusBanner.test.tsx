// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBanner } from "@/app/capture/StatusBanner";
import { LangProvider } from "@/lib/i18n/context";
import { parseLangCookie, type Lang } from "@/lib/i18n/lang";

function renderBanner(lang: Lang, state: Parameters<typeof StatusBanner>[0]["state"]) {
  return render(
    <LangProvider initial={lang}>
      <StatusBanner state={state} queuedCount={2} micSource="built-in" />
    </LangProvider>,
  );
}

afterEach(() => cleanup());

describe("StatusBanner: one language per render", () => {
  it("EN default for a missing cookie: listening shows English only", () => {
    const { container } = renderBanner(parseLangCookie(undefined), "listening");
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(screen.getByText("Audio is being captured")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Mendengarkan|diambil|Mikrofon/);
  });

  it("ID when the cookie is id", () => {
    const { container } = renderBanner(parseLangCookie("id"), "listening");
    expect(screen.getByText("Mendengarkan")).toBeTruthy();
    expect(screen.getByText("Suara sedang direkam")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Listening|captured|Microphone/);
  });

  it("idle (not started) says Not started, never Listening", () => {
    const { container } = renderBanner("en", "idle");
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText("Audio capture is not running")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Listening|Mendengarkan/);
  });

  it("idle in ID is Bahasa only", () => {
    const { container } = renderBanner("id", "idle");
    expect(screen.getByText("Belum mulai")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Not started|not running/);
  });

  it("mic error in ID shows the mic label and help in Bahasa only", () => {
    const { container } = renderBanner("id", "mic_error");
    expect(screen.getByText("Mikrofon bermasalah · tidak mendengarkan")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Microphone problem|Check the microphone/);
  });
});
