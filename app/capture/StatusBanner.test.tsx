// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBanner, headlineStateFor } from "@/app/capture/StatusBanner";
import { LangProvider } from "@/lib/i18n/context";
import { parseLangCookie, type Lang } from "@/lib/i18n/lang";

function renderBanner(lang: Lang, state: Parameters<typeof StatusBanner>[0]["state"]) {
  return render(
    <LangProvider initial={lang}>
      <StatusBanner state={state} micSource="built-in" />
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
    expect(container.textContent).not.toMatch(/Listening|Mendengarkan/);
  });

  it("idle in ID is Bahasa only and shows no helper line", () => {
    const { container } = renderBanner("id", "idle");
    expect(screen.getByText("Belum mulai")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Not started|Tap Start|Ketuk Mulai|Audio capture/);
  });

  it("mic error in ID shows the mic label and help in Bahasa only", () => {
    const { container } = renderBanner("id", "mic_error");
    expect(screen.getByText("Mikrofon bermasalah · tidak mendengarkan")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Microphone problem|Check the microphone/);
  });
});

describe("headlineStateFor: the headline never shows an upload result", () => {
  it("maps listening and offline to listening (offline is an upload result, not a headline state)", () => {
    expect(headlineStateFor("listening")).toBe("listening");
    expect(headlineStateFor("offline")).toBe("listening");
  });

  it("keeps mic_error as the only problem headline", () => {
    expect(headlineStateFor("mic_error")).toBe("mic_error");
  });
});
