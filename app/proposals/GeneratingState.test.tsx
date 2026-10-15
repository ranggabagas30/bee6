// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GeneratingState } from "@/app/proposals/GeneratingState";

afterEach(() => cleanup());

describe("GeneratingState (D2-03d)", () => {
  it("is a polite status with the asking title and the keep-this-page-open line", () => {
    render(<GeneratingState lang="en" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Asking Bee6…");
    expect(status.textContent).toContain("This can take up to a minute. Keep this page open.");
  });

  it("ID copy", () => {
    render(<GeneratingState lang="id" />);
    expect(screen.getByText("Menanyakan Bee6…")).not.toBeNull();
  });

  // Integration QA D2: the block stands in for the proposal list; it keeps at least that list's height so nothing
  // below it (the constraints panel) is pulled up while Bee6 works and pushed back down when the rows return.
  it("reserves the height of the list it replaces; nothing is reserved without one", () => {
    const { unmount } = render(<GeneratingState lang="en" minHeight={420} />);
    expect(screen.getByRole("status").style.minHeight).toBe("420px");
    unmount();
    render(<GeneratingState lang="en" />);
    expect(screen.getByRole("status").style.minHeight).toBe("");
  });
});
