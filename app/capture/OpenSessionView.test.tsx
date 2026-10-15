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
    expect(screen.getByRole("heading", { name: "Today's session is still open." })).toBeTruthy();
    expect(screen.getByText("Closing time has passed. Tap End to start the debrief.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel today" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "End today" }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("closing not reached: 'was interrupted', and ONE action, Cancel today (no End)", () => {
    const { onEnd, onCancel } = setup({ closingReached: false });
    expect(screen.getByRole("heading", { name: "Today's session was interrupted." })).toBeTruthy();
    expect(screen.getByText("Cancel it and start today again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End today" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel today" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
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
    expect(screen.getByRole("heading", { name: "Sesi hari ini masih terbuka." })).toBeTruthy();
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
