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

describe("StatusBanner: after the planned close (UX-03 5.2)", () => {
  it("idle shows the Mulai note under Not started", () => {
    render(
      <LangProvider initial="en">
        <StatusBanner state="idle" micSource="built-in" note="Closed today. Next Start Mon 12 Oct at 01:00." />
      </LangProvider>,
    );
    expect(screen.getByText("Not started")).toBeTruthy();
    expect(screen.getByText("Closed today. Next Start Mon 12 Oct at 01:00.")).toBeTruthy();
  });

  it("ended_auto shows Ended automatically with the time, never Not started", () => {
    const { container } = render(
      <LangProvider initial="en">
        <StatusBanner state="ended_auto" micSource="built-in" endedAt="23:00" />
      </LangProvider>,
    );
    expect(screen.getByText("Ended automatically at 23:00")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Not started|Listening/);
  });

  it("ended shows the Ended headline and the Mulai note, never Listening (R-P1 Selesai)", () => {
    const { container } = render(
      <LangProvider initial="en">
        <StatusBanner state="ended" micSource="built-in" note="You can tap Start again Thu 15 Oct at 02:10." />
      </LangProvider>,
    );
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.getByText("You can tap Start again Thu 15 Oct at 02:10.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Listening|Not started|automatically/);
  });

  it("ended in ID is Bahasa only", () => {
    render(
      <LangProvider initial="id">
        <StatusBanner state="ended" micSource="built-in" note="Mulai bisa ditekan lagi Kam 15 Okt pukul 02:10." />
      </LangProvider>,
    );
    expect(screen.getByText("Selesai")).toBeTruthy();
    expect(screen.getByText("Mulai bisa ditekan lagi Kam 15 Okt pukul 02:10.")).toBeTruthy();
  });

  it("discarded shows the Session cancelled headline and the Mulai note (R-P1 Batalkan)", () => {
    const { container } = render(
      <LangProvider initial="en">
        <StatusBanner state="discarded" micSource="built-in" note="You can tap Start again Thu 15 Oct at 01:00." />
      </LangProvider>,
    );
    expect(screen.getByText("Session cancelled")).toBeTruthy();
    expect(screen.getByText("You can tap Start again Thu 15 Oct at 01:00.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Listening|Not started|Ended\b/);
  });

  it("discarded in ID is Bahasa only", () => {
    render(
      <LangProvider initial="id">
        <StatusBanner state="discarded" micSource="built-in" note={null} />
      </LangProvider>,
    );
    expect(screen.getByText("Sesi dibatalkan")).toBeTruthy();
  });

  it("ended_auto in ID is Bahasa only", () => {
    const { container } = render(
      <LangProvider initial="id">
        <StatusBanner state="ended_auto" micSource="built-in" endedAt="23:00" />
      </LangProvider>,
    );
    expect(screen.getByText("Selesai otomatis pukul 23:00")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Ended|Not started/);
  });
});

describe("StatusBanner: compact (narrow screens with the sandbox script drawer, R-18)", () => {
  function renderCompact(compact: boolean | undefined) {
    return render(
      <LangProvider initial="en">
        <StatusBanner state="listening" micSource="built-in" compact={compact} />
      </LangProvider>,
    );
  }

  it("says exactly the same things as the standard banner, only laid out tighter (still a live status region)", () => {
    const { container: standard } = renderCompact(undefined);
    const standardText = standard.textContent;
    cleanup();
    renderCompact(true);
    expect(screen.getByRole("status").textContent).toBe(standardText);
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(screen.getByText("Audio is being captured")).toBeTruthy();
    expect(screen.getByText("Microphone: built-in")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("drops the 56 px emoji row and the 20 px padding of the standard banner", () => {
    const { container } = renderCompact(true);
    const section = container.querySelector("section") as HTMLElement;
    expect(Number.parseInt(section.style.padding, 10)).toBeLessThanOrEqual(10);
    expect(container.querySelector('[style*="font-size: 56px"]')).toBeNull();
  });

  it("the standard banner is unchanged: 20 px padding and the 56 px emoji", () => {
    const { container } = renderCompact(undefined);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.style.padding).toBe("20px");
    expect(container.querySelector('[style*="font-size: 56px"]')).not.toBeNull();
  });
});
