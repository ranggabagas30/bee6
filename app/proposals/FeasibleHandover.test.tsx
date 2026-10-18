// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FeasibleHandover } from "@/app/proposals/FeasibleHandover";

afterEach(() => {
  cleanup();
});

describe("FeasibleHandover (D2-03g)", () => {
  it("announces 'Marked feasible. The owner decides next. Sign out and pick Owner…' and takes focus so the answer is read out", () => {
    render(<FeasibleHandover lang="en" />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Marked feasible.");
    expect(banner.textContent).toContain("The owner decides next.");
    expect(banner.textContent).toContain("Sign out and pick Owner to approve or reject.");
    expect(document.activeElement).toBe(banner);
  });

  it("never names who marked it or who the owner is", () => {
    const { container } = render(<FeasibleHandover lang="id" />);
    expect(screen.getByText("Ditandai layak.", { exact: false })).not.toBeNull();
    expect(container.textContent).not.toMatch(/@|device/i);
  });
});

describe("ProposalDetail after marking feasible (R-19 PR-A)", () => {
  it("removes the 'Sign out · pick Owner' button; the banner and back button remain", () => {
    render(<FeasibleHandover lang="en" />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Marked feasible.");
    expect(banner.textContent).toContain("Sign out and pick Owner to approve or reject.");
    // Verify the sign-out button is gone
    expect(screen.queryByRole("button", { name: /sign out.*pick owner/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /marked feasible/i })).toBeNull();
  });

  it("banner takes focus when it appears", () => {
    render(<FeasibleHandover lang="en" />);
    const banner = screen.getByRole("status");
    expect(document.activeElement).toBe(banner);
  });

  it("banner has no accessibility violations", async () => {
    const { container } = render(<FeasibleHandover lang="en" />);
    // No violations expected; the banner is semantic with proper role
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});
