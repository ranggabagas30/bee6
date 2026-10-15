// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeasibleHandover } from "@/app/proposals/FeasibleHandover";

afterEach(() => cleanup());

describe("FeasibleHandover (D2-03g)", () => {
  it("announces 'Marked feasible. The owner decides next.' and takes focus so the answer is read out", () => {
    render(<FeasibleHandover lang="en" onBack={() => {}} />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Marked feasible.");
    expect(banner.textContent).toContain("The owner decides next.");
    expect(document.activeElement).toBe(banner);
  });

  it("the done look is not a live control; Back to proposals calls onBack", () => {
    const onBack = vi.fn();
    render(<FeasibleHandover lang="en" onBack={onBack} />);
    expect((screen.getByRole("button", { name: "Marked feasible ✓" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to proposals" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("never names who marked it or who the owner is", () => {
    const { container } = render(<FeasibleHandover lang="id" onBack={() => {}} />);
    expect(screen.getByText("Ditandai layak.")).not.toBeNull();
    expect(container.textContent).not.toMatch(/@|device/i);
  });
});
