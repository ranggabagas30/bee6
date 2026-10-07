// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  UPLOAD_TOAST_MS,
  UploadStatusLine,
  deriveLostLine,
  deriveRetainedUploadView,
  deriveUploadView,
} from "@/app/capture/UploadStatusLine";
import { LangProvider } from "@/lib/i18n/context";
import { parseLangCookie, type Lang } from "@/lib/i18n/lang";

// Mirrors the root layout: the cookie value decides the language of the first paint.
function withLang(lang: Lang, ui: ReactElement) {
  return <LangProvider initial={lang}>{ui}</LangProvider>;
}

afterEach(() => cleanup());

describe("deriveUploadView (pure, language-free)", () => {
  it("maps an offline engine with failed attempts to a retry row with the count", () => {
    expect(
      deriveUploadView({ state: "offline", queuedCount: 2, lastUploadHttpStatus: 503, headFailedAttempts: 2 }),
    ).toEqual({ phase: "retrying", failedAttempts: 2 });
  });

  it("shows nothing while the mic is in error (the mic line already says so)", () => {
    expect(
      deriveUploadView({ state: "mic_error", queuedCount: 1, lastUploadHttpStatus: null }),
    ).toBeNull();
  });

  it("shows uploading while segments are queued and the connection is OK", () => {
    expect(
      deriveUploadView({ state: "listening", queuedCount: 1, lastUploadHttpStatus: 200 }),
    ).toEqual({ phase: "uploading" });
  });

  it("shows succeeded only after a 2xx with an empty queue", () => {
    expect(
      deriveUploadView({ state: "listening", queuedCount: 0, lastUploadHttpStatus: 201 }),
    ).toEqual({ phase: "succeeded" });
    expect(
      deriveUploadView({ state: "listening", queuedCount: 0, lastUploadHttpStatus: 503 }),
    ).toBeNull();
  });

  it("keeps only a retry row across a stop", () => {
    expect(
      deriveRetainedUploadView({ state: "listening", queuedCount: 0, lastUploadHttpStatus: 200 }),
    ).toBeNull();
    expect(
      deriveRetainedUploadView({ state: "offline", queuedCount: 1, lastUploadHttpStatus: null, headFailedAttempts: 1 }),
    ).toEqual({ phase: "retrying", failedAttempts: 1 });
  });

  it("reads the lost flag, false when absent", () => {
    const base = { state: "listening" as const, queuedCount: 0, lastUploadHttpStatus: 200 };
    expect(deriveLostLine({ ...base, lostSinceSuccess: true })).toBe(true);
    expect(deriveLostLine({ ...base })).toBe(false);
    expect(deriveLostLine(null)).toBe(false);
  });
});

describe("UploadStatusLine renders one language per render", () => {
  it("EN default: retry row with count and server-busy hint, no Bahasa text", () => {
    const { container } = render(
      withLang(parseLangCookie(undefined), (
        <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={true} />
      )),
    );
    expect(screen.getByText("Not sent yet · retrying (2x)")).toBeTruthy();
    expect(screen.getByText("Server busy")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Belum|sibuk|mencoba|Mengunggah/);
  });

  it("ID when the cookie is id: the same retry row in Bahasa only", () => {
    const { container } = render(
      withLang(parseLangCookie("id"), (
        <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={true} />
      )),
    );
    expect(screen.getByText("Belum terkirim · mencoba lagi (2x)")).toBeTruthy();
    expect(screen.getByText("Server sibuk")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Not sent|Server busy|retrying/);
  });

  it("shows the 'No internet' detail only when the browser reports no connection", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "retrying" }} online={false} />));
    expect(
      screen.getByText("No internet. Connect so the queued items can send."),
    ).toBeTruthy();
    expect(screen.queryByText("Server busy")).toBeNull();
    expect(screen.getByText("Not sent yet · retrying")).toBeTruthy();
  });

  it("the 'No internet' detail is Bahasa only under id, and keeps the retry row", () => {
    const { container } = render(
      withLang("id", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={false} />),
    );
    expect(screen.getByText("Tidak ada internet. Sambungkan agar antrean terkirim.")).toBeTruthy();
    expect(screen.getByText("Belum terkirim · mencoba lagi (2x)")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No internet|Server busy|Server sibuk/);
  });

  it("never shows the 'No internet' detail while the browser is online or unknown", () => {
    const { container, rerender } = render(
      withLang("en", <UploadStatusLine view={{ phase: "retrying" }} online={true} />),
    );
    expect(screen.getByText("Server busy")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No internet/);
    rerender(withLang("en", <UploadStatusLine view={{ phase: "retrying" }} />));
    expect(container.textContent).not.toMatch(/No internet/);
    expect(container.textContent).not.toMatch(/Server busy/);
  });

  it("lost line in ID comes with its helper, in one language only", () => {
    const { container } = render(
      withLang("id", <UploadStatusLine view={null} lost={true} />),
    );
    expect(screen.getByText("Sebagian suara tidak tercatat")).toBeTruthy();
    expect(screen.getByText("Catatan itu jadi tidak lengkap. Tidak bisa dipulihkan.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Some speech|incomplete/);
  });

  it("hides the succeeded row while the lost line is up", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} lost={true} />));
    expect(screen.getByText("Some speech was not captured")).toBeTruthy();
    expect(screen.queryByText("Upload succeeded")).toBeNull();
  });

  it("keeps the live region mounted even with nothing to say", () => {
    render(withLang("en", <UploadStatusLine view={null} />));
    const region = screen.getByTestId("upload-status");
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });
});

describe("UploadStatusLine recovery toast (C-u-toast, UX-03 section 5.7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("toasts once after a retry is followed by a success, then clears after 3 s", () => {
    const { rerender } = render(
      withLang("en", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 1 }} online={true} />),
    );
    rerender(withLang("en", <UploadStatusLine view={{ phase: "uploading" }} />));
    rerender(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} />));
    expect(screen.getByTestId("upload-toast").textContent).toBe("Upload working again");
    act(() => {
      vi.advanceTimersByTime(UPLOAD_TOAST_MS);
    });
    expect(screen.queryByTestId("upload-toast")).toBeNull();
  });

  it("toasts in Bahasa when the cookie is id", () => {
    const { rerender } = render(
      withLang("id", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 1 }} online={true} />),
    );
    rerender(withLang("id", <UploadStatusLine view={{ phase: "succeeded" }} />));
    expect(screen.getByTestId("upload-toast").textContent).toBe("Unggah berhasil lagi");
  });

  it("never toasts a routine success", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} />));
    expect(screen.queryByTestId("upload-toast")).toBeNull();
  });
});
