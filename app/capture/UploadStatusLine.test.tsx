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

// The count sits in an aria-hidden span, so the row's full text is matched on its <p>.
function rowByText(text: string) {
  return screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);
}

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

describe("UploadStatusLine server-busy hint is gated on a real server error (UX-03 §5.7 row 1a)", () => {
  it("a network failure with no HTTP status shows no server-busy line while online", () => {
    const { container } = render(
      withLang("en", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 1 }} online={true} httpStatus={null} />),
    );
    expect(rowByText("Not sent yet · retrying (1x)")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Server busy/);
  });

  it("a 503 while online shows the server-busy line", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "retrying" }} online={true} httpStatus={503} />));
    expect(screen.getByText("Server busy")).toBeTruthy();
  });

  it("a 429 while online shows the server-busy line", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "retrying" }} online={true} httpStatus={429} />));
    expect(screen.getByText("Server busy")).toBeTruthy();
  });

  it("a 401 while online does not show the server-busy line", () => {
    const { container } = render(
      withLang("en", <UploadStatusLine view={{ phase: "retrying" }} online={true} httpStatus={401} />),
    );
    expect(container.textContent).not.toMatch(/Server busy/);
  });

  it("a 403 while online does not show the server-busy line", () => {
    const { container } = render(
      withLang("en", <UploadStatusLine view={{ phase: "retrying" }} online={true} httpStatus={403} />),
    );
    expect(container.textContent).not.toMatch(/Server busy/);
  });
});

describe("UploadStatusLine renders one language per render", () => {
  it("EN default: retry row with count and server-busy hint, no Bahasa text", () => {
    const { container } = render(
      withLang(parseLangCookie(undefined), (
        <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={true} httpStatus={503} />
      )),
    );
    expect(rowByText("Not sent yet · retrying (2x)")).toBeTruthy();
    expect(screen.getByText("Server busy")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Belum|sibuk|mencoba|Mengunggah/);
  });

  it("ID when the cookie is id: the same retry row in Bahasa only", () => {
    const { container } = render(
      withLang(parseLangCookie("id"), (
        <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={true} httpStatus={503} />
      )),
    );
    expect(rowByText("Belum terkirim · mencoba lagi (2x)")).toBeTruthy();
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
    expect(rowByText("Belum terkirim · mencoba lagi (2x)")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No internet|Server busy|Server sibuk/);
  });

  it("never shows the 'No internet' detail while the browser is online or unknown", () => {
    const { container, rerender } = render(
      withLang("en", <UploadStatusLine view={{ phase: "retrying" }} online={true} httpStatus={503} />),
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

  it("the lost value stays inside the polite live region, and the helper sits right under it", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={false} lost={true} />));
    const lostValue = screen.getByText("Some speech was not captured");
    const region = lostValue.closest('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("role")).toBe("status");
    const helper = screen.getByText("That note is now incomplete. It cannot be recovered.");
    const retryRow = rowByText("Not sent yet · retrying (2x)");
    // Visual order (lost value, helper, retry row) is unchanged: the helper follows the lost value and precedes the retry row.
    expect(lostValue.compareDocumentPosition(helper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(helper.compareDocumentPosition(retryRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the whole block is ONE role=status aria-live=polite region holding the lost value and the retry row", () => {
    const { container } = render(
      withLang("en", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={false} lost={true} />),
    );
    const live = container.querySelectorAll("[aria-live]");
    expect(live.length).toBe(1);
    const block = live[0] as HTMLElement;
    expect(block.getAttribute("role")).toBe("status");
    expect(block.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelectorAll('[role="status"]').length).toBe(1);
    expect(block.textContent).toContain("Some speech was not captured");
    expect(block.textContent).toContain("That note is now incomplete. It cannot be recovered.");
    expect(block.textContent).toContain("Not sent yet · retrying");
    expect(block.textContent).toBe(
      "▲ Some speech was not captured" +
        "That note is now incomplete. It cannot be recovered." +
        "Not sent yet · retrying (2x)" +
        "No internet. Connect so the queued items can send.",
    );
  });

  it("the lost-line helper is inside that region and is not aria-hidden", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={false} lost={true} />));
    const region = screen.getByTestId("upload-status");
    const helper = screen.getByText("That note is now incomplete. It cannot be recovered.");
    expect(region.contains(helper)).toBe(true);
    expect(helper.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("the retry count is inside an aria-hidden element; the row's words are not", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 2 }} online={true} httpStatus={503} />));
    const count = screen.getByText("(2x)");
    expect(count.getAttribute("aria-hidden")).toBe("true");
    const words = screen.getByText("Not sent yet · retrying");
    expect(words.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId("upload-status").contains(words)).toBe(true);
  });

  it("the recovery toast sits outside the block, with its own role=status", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        withLang("en", <UploadStatusLine view={{ phase: "retrying", failedAttempts: 1 }} online={true} />),
      );
      rerender(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} />));
      const toast = screen.getByTestId("upload-toast");
      const block = screen.getByTestId("upload-status");
      expect(toast.getAttribute("role")).toBe("status");
      expect(block.contains(toast)).toBe(false);
      expect(toast.contains(block)).toBe(false);
      expect(block.textContent).not.toContain("Upload working again");
    } finally {
      vi.useRealTimers();
    }
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
