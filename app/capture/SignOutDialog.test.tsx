// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignOutDialog } from "@/app/capture/SignOutDialog";
import { axeViolations } from "@/lib/testing/axe";

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof SignOutDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onDismiss = vi.fn();
  const utils = render(
    <SignOutDialog kind="running" lang="en" busy={false} finishing={false} errorKey={null} onConfirm={onConfirm} onDismiss={onDismiss} {...over} />,
  );
  return { onConfirm, onDismiss, ...utils };
}

describe("SignOutDialog: before closing (P2-07a)", () => {
  it("says it cancels today, with the exact copy, and offers Keep listening / Sign out and cancel", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Sign out and cancel today?" })).toBeTruthy();
    expect(
      screen.getByText("Today's session is still running. If you sign out now it is cancelled: the notes from today are deleted and today does not count."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep listening" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out and cancel" })).toBeTruthy();
  });

  it("the safe choice has focus, and Escape and Keep listening dismiss", () => {
    const { onDismiss, onConfirm } = setup();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep listening" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Keep listening" }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Sign out and cancel confirms", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Sign out and cancel" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("while the cancel is in flight both buttons are disabled and Escape does nothing", () => {
    const { onDismiss } = setup({ busy: true });
    expect((screen.getByRole("button", { name: "Keep listening" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Sign out and cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("shows the page's own error line (the Batalkan error) in an alert and stays open", () => {
    setup({ errorKey: "C-sess-cancel-closed" });
    expect(screen.getByRole("alert").textContent).toBe("Today has reached closing time, so the session can't be cancelled. Tap End today.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("is Bahasa only in ID", () => {
    setup({ lang: "id" });
    expect(screen.getByRole("dialog", { name: "Keluar dan batalkan hari ini?" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Keep listening|Sign out/);
  });

  it("has no axe violations", async () => {
    const { container } = setup();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("SignOutDialog: after closing (P2-07b)", () => {
  it("says the session stays open, with the exact copy, and offers Stay / Sign out anyway", () => {
    setup({ kind: "closed" });
    expect(screen.getByRole("dialog", { name: "Sign out?" })).toBeTruthy();
    expect(
      screen.getByText(
        "Closing time has passed, so today's session can no longer be cancelled. It stays open until you tap End, then the debrief runs for 60 minutes. Questions left unanswered are recorded as unverified.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stay" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out anyway" })).toBeTruthy();
    expect(screen.queryByText(/cancel/i, { selector: "button" })).toBeNull();
  });

  it("shows Finishing uploads while the queue drains", () => {
    setup({ kind: "closed", busy: true, finishing: true });
    expect(screen.getByRole("status").textContent).toBe("Finishing uploads…");
  });

  it("no live status line when nothing is finishing", () => {
    setup({ kind: "closed" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("has no axe violations", async () => {
    const { container } = setup({ kind: "closed" });
    expect(await axeViolations(container)).toEqual([]);
  });
});
