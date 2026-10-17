// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  UPLOAD_TOAST_MS,
  UploadStatusLine,
  deriveLostLine,
  deriveLostNotice,
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

describe("deriveLostNotice (R-23: sticky until Dismiss or the next Start)", () => {
  const base = { state: "listening" as const, queuedCount: 0, lastUploadHttpStatus: 200 };
  it("is true only while droppedCount is above the count dismissed", () => {
    expect(deriveLostNotice({ ...base, droppedCount: 0 }, 0)).toBe(false);
    expect(deriveLostNotice({ ...base, droppedCount: 1 }, 0)).toBe(true);
    expect(deriveLostNotice({ ...base, droppedCount: 1 }, 1)).toBe(false);
    expect(deriveLostNotice({ ...base, droppedCount: 2 }, 1)).toBe(true);
  });
  it("is false for null, undefined and a status without a drop count", () => {
    expect(deriveLostNotice(null, 0)).toBe(false);
    expect(deriveLostNotice(undefined, 0)).toBe(false);
    expect(deriveLostNotice({ ...base }, 0)).toBe(false);
  });
  it("stays true after a later 2xx cleared lostSinceSuccess", () => {
    expect(deriveLostNotice({ ...base, droppedCount: 1, lostSinceSuccess: false, lastUploadHttpStatus: 200 }, 0)).toBe(true);
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

  it("shows the succeeded row under the lost line (R-23 L-3)", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} lost={true} />));
    const lostValue = screen.getByText("Some speech was not captured");
    const ok = screen.getByText("Upload succeeded");
    expect(lostValue.compareDocumentPosition(ok) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the Dismiss button only with onDismissLost, inside the live region, between the helper and the row", () => {
    const { rerender } = render(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} lost={true} />));
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    const onDismissLost = vi.fn();
    rerender(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} lost={true} onDismissLost={onDismissLost} />));
    const button = screen.getByRole("button", { name: "Dismiss" });
    expect(screen.getByTestId("upload-status").contains(button)).toBe(true);
    expect(button.getAttribute("type")).toBe("button");
    expect(button.style.minHeight).toBe("44px");
    const helper = screen.getByText("That note is now incomplete. It cannot be recovered.");
    const ok = screen.getByText("Upload succeeded");
    expect(helper.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(ok) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(onDismissLost).toHaveBeenCalledTimes(1);
  });

  it("shows no Dismiss button when there is no lost notice, even with a handler", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} onDismissLost={() => {}} />));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the Dismiss label is Tutup under id, in one language only", () => {
    const { container } = render(withLang("id", <UploadStatusLine view={null} lost={true} onDismissLost={() => {}} />));
    expect(screen.getByRole("button", { name: "Tutup" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Dismiss/);
  });

  it("the live region is still ONE region with the Dismiss button inside it", () => {
    const { container } = render(
      withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} lost={true} onDismissLost={() => {}} />),
    );
    expect(container.querySelectorAll("[aria-live]").length).toBe(1);
    expect(screen.getByTestId("upload-status").textContent).toBe(
      "▲ Some speech was not captured" +
        "That note is now incomplete. It cannot be recovered." +
        "Dismiss" +
        "Upload succeeded",
    );
  });

  it("moves focus to the live region after Dismiss so a keyboard user is not dropped to the page top", () => {
    render(withLang("en", <UploadStatusLine view={null} lost={true} onDismissLost={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(document.activeElement).toBe(screen.getByTestId("upload-status"));
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

  it("a sticky lost notice toasts the recovery once, not on every later routine success under it", () => {
    const { rerender } = render(withLang("en", <UploadStatusLine view={{ phase: "uploading" }} />));
    rerender(withLang("en", <UploadStatusLine view={{ phase: "uploading" }} lost={true} />));
    rerender(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} lost={true} />));
    expect(screen.getByTestId("upload-toast")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(UPLOAD_TOAST_MS);
    });
    expect(screen.queryByTestId("upload-toast")).toBeNull();
    rerender(withLang("en", <UploadStatusLine view={{ phase: "uploading" }} lost={true} />));
    rerender(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} lost={true} />));
    expect(screen.queryByTestId("upload-toast")).toBeNull();
  });

  it("Dismiss with no success in between shows no toast", () => {
    const { rerender } = render(withLang("en", <UploadStatusLine view={null} />));
    rerender(withLang("en", <UploadStatusLine view={null} lost={true} />));
    rerender(withLang("en", <UploadStatusLine view={null} lost={false} />));
    expect(screen.queryByTestId("upload-toast")).toBeNull();
  });

  it("never toasts a routine success", () => {
    render(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} />));
    expect(screen.queryByTestId("upload-toast")).toBeNull();
  });
});

// R-25 T5: the page-2 look on a sandbox. Same words, same order, same one live region; only the surfaces change.
describe("UploadStatusLine styled (sandbox, boards P2-05)", () => {
  function renderStyled(props: Partial<React.ComponentProps<typeof UploadStatusLine>> = {}) {
    return render(withLang("en", <UploadStatusLine view={{ phase: "succeeded" }} styled {...props} />));
  }

  it("keeps one live region with the lost notice, helper, Dismiss, then the row, in that order", () => {
    const onDismissLost = vi.fn();
    const { container } = renderStyled({ lost: true, onDismissLost, view: { phase: "retrying", failedAttempts: 2 }, online: false });
    const region = screen.getByTestId("upload-status");
    expect(region.getAttribute("role")).toBe("status");
    expect(container.querySelectorAll("[aria-live]").length).toBe(1);
    const lead = screen.getByText(/Some speech was not captured/);
    const help = screen.getByText("That note is now incomplete. It cannot be recovered.");
    expect(help).toBeTruthy();
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    const row = screen.getByText(/Not sent yet · retrying/);
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(lead, dismiss)).toBe(true);
    expect(follows(dismiss, row)).toBe(true);
    fireEvent.click(dismiss);
    expect(onDismissLost).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(region); // focus parks on the live region once Dismiss goes
  });

  it("shows no notice and no Dismiss when nothing was lost, and the succeeded row stays", () => {
    renderStyled();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.getByText("Upload succeeded")).toBeTruthy();
  });
});
