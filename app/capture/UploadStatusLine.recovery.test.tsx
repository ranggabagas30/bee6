// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { UploadStatusLine, type UploadView } from "@/app/capture/UploadStatusLine";

const TOAST_ID = "Unggah berhasil lagi";
const TOAST_EN = "Upload working again";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function toastNode(container: HTMLElement): HTMLElement | null {
  // The block is also a polite status region now (UX-03 §5.7); the toast is the
  // polite region that is NOT the block.
  return (
    Array.from(container.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]')).find(
      (el) => el.getAttribute("data-testid") !== "upload-status",
    ) ?? null
  );
}

describe("UploadStatusLine live region (UX-03 §5.7, §7)", () => {
  function block(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>('[data-testid="upload-status"]');
  }

  it("the block container is a polite live region", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "retrying" }} />);
    expect(block(container)?.getAttribute("role")).toBe("status");
    expect(block(container)?.getAttribute("aria-live")).toBe("polite");
  });

  it("the block is a live region even when it has nothing to show yet", () => {
    const { container } = render(<UploadStatusLine view={null} />);
    expect(block(container)?.getAttribute("role")).toBe("status");
    expect(block(container)?.getAttribute("aria-live")).toBe("polite");
  });

  it("the rows inside the block carry no role of their own", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "retrying" }} lost />);
    const rows = Array.from(block(container)?.querySelectorAll("p") ?? []);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute("role")).toBeNull();
      expect(row.getAttribute("aria-live")).toBeNull();
    }
  });

  it("the success toast sits outside the block, with its own polite status role", () => {
    const { container, rerender } = render(<UploadStatusLine view={{ phase: "retrying" }} />);
    rerender(<UploadStatusLine view={{ phase: "succeeded" }} />);
    const toast = toastNode(container);
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.getAttribute("aria-live")).toBe("polite");
    expect(block(container)?.contains(toast as HTMLElement)).toBe(false);
  });
});

describe("UploadStatusLine success toast (UX-03 §5.7, C-u-toast)", () => {
  it("shows after a 2xx that recovers from a retry", () => {
    const { container, rerender } = render(<UploadStatusLine view={{ phase: "retrying" }} />);
    rerender(<UploadStatusLine view={{ phase: "uploading" }} />);
    rerender(<UploadStatusLine view={{ phase: "succeeded" }} />);

    const toast = toastNode(container);
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toBe(`${TOAST_ID}${TOAST_EN}`);
  });

  it("shows after a 2xx that clears an open loss", () => {
    const { container, rerender } = render(
      <UploadStatusLine view={{ phase: "succeeded" }} lost />,
    );
    expect(toastNode(container)).toBeNull();
    rerender(<UploadStatusLine view={{ phase: "succeeded" }} lost={false} />);
    expect(toastNode(container)?.textContent).toBe(`${TOAST_ID}${TOAST_EN}`);
  });

  it("is removed 3 s after it appears", () => {
    const { container, rerender } = render(<UploadStatusLine view={{ phase: "retrying" }} />);
    rerender(<UploadStatusLine view={{ phase: "succeeded" }} />);
    expect(toastNode(container)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(toastNode(container)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toastNode(container)).toBeNull();
  });

  it("does not show on a 2xx with no earlier failure", () => {
    const { container, rerender } = render(<UploadStatusLine view={{ phase: "uploading" }} />);
    rerender(<UploadStatusLine view={{ phase: "succeeded" }} />);
    expect(toastNode(container)).toBeNull();
  });

  it("does not show when a succeeded view is the first render", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "succeeded" }} />);
    expect(toastNode(container)).toBeNull();
  });

  it("does not show again on the next routine success", () => {
    const retrying: UploadView = { phase: "retrying" };
    const succeeded: UploadView = { phase: "succeeded" };
    const uploading: UploadView = { phase: "uploading" };
    const { container, rerender } = render(<UploadStatusLine view={retrying} />);
    rerender(<UploadStatusLine view={succeeded} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(toastNode(container)).toBeNull();
    rerender(<UploadStatusLine view={uploading} />);
    rerender(<UploadStatusLine view={succeeded} />);
    expect(toastNode(container)).toBeNull();
  });
});

describe("UploadStatusLine retry-row colour (UX-03 §2, --warn)", () => {
  it("renders the retry row in the --warn token #7A4F00", () => {
    const { container } = render(<UploadStatusLine view={{ phase: "retrying" }} />);
    const row = container.querySelector<HTMLElement>('[data-testid="upload-status"]');
    expect(row?.textContent).toContain("Belum terkirim");
    // jsdom normalises hex inline colours to rgb().
    expect(row?.style.color).toBe("rgb(122, 79, 0)");
  });
});

describe("UploadStatusLine lost-line colour (UX-03 §5.7, --warn)", () => {
  it("renders the lost row mark and text in the --warn token #7A4F00", () => {
    const { container } = render(<UploadStatusLine view={null} lost />);
    const heading = Array.from(container.querySelectorAll("p")).find(
      (p) => p.textContent?.includes("Sebagian suara tidak tercatat"),
    );
    const english = Array.from(container.querySelectorAll("p")).find(
      (p) => p.textContent === "Some speech was not captured",
    );
    // jsdom normalises hex inline colours to rgb().
    expect(heading?.style.color).toBe("rgb(122, 79, 0)");
    expect(english?.style.color).toBe("rgb(122, 79, 0)");
  });
});
