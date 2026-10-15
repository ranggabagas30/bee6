// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShopTopBar } from "@/app/shop/ShopTopBar";

afterEach(cleanup);

describe("ShopTopBar sign-out (R-19 PR-4b, plan 5.7; sandbox only)", () => {
  it("renders no sign-out control unless the page hands one over (the pilot never does)", () => {
    render(<ShopTopBar />);
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(screen.getByText("bee6")).toBeTruthy();
  });

  it("renders the sign-out button with the given label and calls it on tap", () => {
    const onClick = vi.fn();
    render(<ShopTopBar signOut={{ label: "Sign out", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the language switch next to it", () => {
    render(<ShopTopBar signOut={{ label: "Sign out", onClick: () => {} }} />);
    expect(screen.getByRole("group")).toBeTruthy();
  });

  it("a disabled sign-out is really disabled (a sign-out in flight cannot be tapped twice)", () => {
    const onClick = vi.fn();
    render(<ShopTopBar signOut={{ label: "Sign out", onClick, disabled: true }} />);
    const b = screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});
