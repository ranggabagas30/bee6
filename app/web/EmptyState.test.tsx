// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { axeViolations } from "@/lib/testing/axe";
import { EmptyState } from "@/app/web/EmptyState";

afterEach(cleanup);

describe("EmptyState (R-19 PR-6 §8.3)", () => {
  it("renders the title and the detail line as plain text, with no control", () => {
    render(<EmptyState title="No proposal yet" detail="Bee6 needs the same problem on at least 2 days." />);
    expect(screen.getByText("No proposal yet")).toBeTruthy();
    expect(screen.getByText("Bee6 needs the same problem on at least 2 days.")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("renders the title alone when there is no detail", () => {
    const { container } = render(<EmptyState title="No phone connected yet." />);
    expect(screen.getByText("No phone connected yet.")).toBeTruthy();
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("accepts a test id and axe finds no violation", async () => {
    const { container } = render(<EmptyState title="Nothing to review yet" detail="When an approved change reaches its review date, it appears here." data-testid="empty" />);
    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });
});
