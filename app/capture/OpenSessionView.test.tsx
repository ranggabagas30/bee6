// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OpenSessionView } from "@/app/capture/OpenSessionView";
import { axeViolations } from "@/lib/testing/axe";

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof OpenSessionView>[0]> = {}) {
  const onEnd = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<OpenSessionView lang="en" closingReached busy={false} errorKey={null} onEnd={onEnd} onCancel={onCancel} {...over} />);
  return { onEnd, onCancel, ...utils };
}

describe("OpenSessionView (P2-07c): the session found again on return", () => {
  it("closing reached: 'still open', the closing line and ONE action, End today", () => {
    const { onEnd, onCancel } = setup();
    expect(screen.getByRole("heading", { name: "Today's session is still open" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Today's session is still open" })).toBeTruthy();
    expect(screen.getByText("Closing time has passed. Tap End to start the debrief. It runs for 60 minutes.")).toBeTruthy();
    expect(screen.getByText("You signed out before ending. Nothing was lost.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel today" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End today" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("closing not reached: 'was interrupted', and ONE action, Cancel today (no End)", () => {
    const { onEnd, onCancel } = setup({ closingReached: false });
    expect(screen.getByRole("heading", { name: "Today's session was interrupted" })).toBeTruthy();
    expect(screen.getByText("Cancel it and start today again.")).toBeTruthy();
    expect(screen.queryByText("You signed out before ending. Nothing was lost.")).toBeNull(); // only after closing
    expect(screen.queryByRole("button", { name: "End today" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel today" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("renders the stage (decorative), the day line and the footer the page hands in, in that order", () => {
    const { container } = setup({ dayLine: "Day 1 of 3 · Mon 12 Oct", footer: <button type="button">Sign out</button> });
    const stage = container.querySelector("[data-tone]")!;
    expect(stage.getAttribute("aria-hidden")).toBe("true");
    const day = screen.getByText("Day 1 of 3 · Mon 12 Oct");
    const end = screen.getByRole("button", { name: "End today" });
    const signOut = screen.getByRole("button", { name: "Sign out" });
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(stage, screen.getByRole("heading", { level: 1 }))).toBe(true);
    expect(follows(day, end) && follows(end, signOut)).toBe(true);
  });

  it("never offers Start", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^start$/i })).toBeNull();
  });

  it("busy disables the action; an error shows in an alert", () => {
    setup({ busy: true, errorKey: "C-sess-cancel-closed" });
    expect((screen.getByRole("button", { name: "End today" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("closing time");
  });

  it("Bahasa only in ID", () => {
    setup({ lang: "id" });
    expect(screen.getByRole("heading", { name: "Sesi hari ini masih terbuka" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Today|session/);
  });

  it("has no axe violations in either branch", async () => {
    const a = setup();
    expect(await axeViolations(a.container)).toEqual([]);
    cleanup();
    const b = setup({ closingReached: false });
    expect(await axeViolations(b.container)).toEqual([]);
  });
});
