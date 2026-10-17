// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EndConfirmSheet } from "@/app/capture/EndConfirmSheet";
import { axeViolations } from "@/lib/testing/axe";

afterEach(cleanup);

const BODY = "The 1-hour debrief starts now. This cannot be undone.";

function setup(over: Partial<Parameters<typeof EndConfirmSheet>[0]> = {}) {
  const onKeep = vi.fn();
  const onEnd = vi.fn();
  const utils = render(<EndConfirmSheet lang="en" body={BODY} busy={false} errorKey={null} onKeep={onKeep} onEnd={onEnd} {...over} />);
  return { onKeep, onEnd, ...utils };
}

describe("EndConfirmSheet (R2, board P2-06 to P2-08)", () => {
  it("is a labelled modal dialog with the title, the body and the two buttons, Not yet first", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "End today's operations?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.textContent).toContain(BODY);
    const keep = screen.getByRole("button", { name: "Not yet, keep going" });
    const end = screen.getByRole("button", { name: "Yes, end" });
    expect(Boolean(keep.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("the safe choice has focus; Escape and Not yet both keep going, and Yes, end ends", () => {
    const { onKeep, onEnd } = setup();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Not yet, keep going" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Not yet, keep going" }));
    expect(onKeep).toHaveBeenCalledTimes(2);
    expect(onEnd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, end" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("Yes, end is really disabled while the End request is in flight", () => {
    setup({ busy: true });
    expect((screen.getByRole("button", { name: "Yes, end" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Tab cycles inside the sheet and never reaches the page behind", () => {
    render(<button type="button">Behind</button>);
    setup();
    const keep = screen.getByRole("button", { name: "Not yet, keep going" });
    const end = screen.getByRole("button", { name: "Yes, end" });
    end.focus();
    fireEvent.keyDown(end, { key: "Tab" });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(end);
    const behind = screen.getByRole("button", { name: "Behind" });
    behind.focus();
    fireEvent.keyDown(behind, { key: "Tab" });
    expect(document.activeElement).toBe(keep);
  });

  it("focus goes back to the element that opened it", () => {
    render(<button type="button">End today</button>);
    const opener = screen.getByRole("button", { name: "End today" });
    opener.focus();
    const { unmount } = setup();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Not yet, keep going" }));
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("a failed End shows the page's own line in an alert and the sheet stays", () => {
    setup({ errorKey: "C-sess-err" });
    expect(screen.getByRole("alert").textContent).toBe("Could not process that. Try again.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("is Bahasa only in ID", () => {
    setup({ lang: "id", body: "Debrief 1 jam dimulai sekarang. Tidak bisa dikembalikan." });
    expect(screen.getByRole("dialog", { name: "Akhiri operasional hari ini?" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Not yet|Yes, end/);
  });

  it("has no axe violations", async () => {
    const { container } = setup();
    expect(await axeViolations(container)).toEqual([]);
  });
});
