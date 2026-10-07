// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBanner } from "@/app/capture/StatusBanner";
import { LangProvider } from "@/lib/i18n/context";
import { parseLangCookie, type Lang } from "@/lib/i18n/lang";

function renderBanner(
  lang: Lang,
  state: Parameters<typeof StatusBanner>[0]["state"],
  startOffered?: boolean,
) {
  return render(
    <LangProvider initial={lang}>
      <StatusBanner state={state} queuedCount={2} micSource="built-in" startOffered={startOffered} />
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
    const { container } = renderBanner("en", "idle", true);
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText("Tap Start to begin today's session.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Listening|Mendengarkan/);
  });

  it("idle in ID is Bahasa only, with the Bahasa helper when Mulai is offered", () => {
    const { container } = renderBanner("id", "idle", true);
    expect(screen.getByText("Belum mulai")).toBeTruthy();
    expect(screen.getByText("Ketuk Mulai untuk memulai sesi hari ini.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Not started|Tap Start|Audio capture/);
  });

  it("idle helper is hidden when Mulai is not offered, and no capturing text replaces it", () => {
    const { container } = renderBanner("en", "idle");
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Tap Start|Ketuk Mulai|Audio is being captured|Suara sedang direkam/);
    expect(container.textContent).not.toMatch(/Audio capture is not running/);
  });

  it("idle helper is never shown in any non-idle state, even when Mulai is offered", () => {
    const { container } = renderBanner("en", "listening", true);
    expect(container.textContent).not.toMatch(/Tap Start|Ketuk Mulai/);
  });

  it("mic error in ID shows the mic label and help in Bahasa only", () => {
    const { container } = renderBanner("id", "mic_error");
    expect(screen.getByText("Mikrofon bermasalah · tidak mendengarkan")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Microphone problem|Check the microphone/);
  });
});
