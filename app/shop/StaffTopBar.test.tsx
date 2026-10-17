// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LangProvider } from "@/lib/i18n/context";
import { axeViolations } from "@/lib/testing/axe";
import { StaffTopBar, type StaffTopBarProps } from "@/app/shop/StaffTopBar";

let expiry: string | null = null;
vi.mock("@/app/demo/demo-expiry", () => ({ useDemoExpiryHHMM: () => expiry }));

afterEach(() => {
  cleanup();
  expiry = null;
});

function renderBar(props: StaffTopBarProps = {}, lang: "en" | "id" = "en") {
  return render(
    <LangProvider initial={lang}>
      <StaffTopBar {...props} />
    </LangProvider>,
  );
}

describe("StaffTopBar", () => {
  it("pilot (demo off): the logo and the ID | EN switch, nothing else, even when an outlet line is asked for", () => {
    expiry = "11:20"; // a stale sandbox record must not leak onto the pilot bar
    renderBar({ outletLine: true });
    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("Bee6")).toBeTruthy();
    expect(within(bar).getByRole("group", { name: "Choose language" })).toBeTruthy();
    expect(bar.textContent).not.toMatch(/Bakery|ends|Staff|DEMO|Sign out/i);
  });

  it("demo: the outlet line, the expiry in its mono slot, and the STAFF and DEMO DATA chips", () => {
    expiry = "11:20";
    renderBar({ demo: true, outletLine: true });
    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("Demo Bakery · Outlet 1")).toBeTruthy();
    expect(within(bar).getByText("ends 11:20")).toBeTruthy();
    expect(within(bar).getByText("Staff")).toBeTruthy();
    expect(within(bar).getByText("DEMO DATA")).toBeTruthy();
  });

  it("demo without an outlet line: chips and switch, no outlet text", () => {
    renderBar({ demo: true });
    const bar = screen.getByRole("banner");
    expect(bar.textContent).not.toContain("Demo Bakery");
    expect(within(bar).getByText("DEMO DATA")).toBeTruthy();
  });

  it("demo with no live sandbox time: the outlet name alone, no 'ends' text", () => {
    expiry = null;
    renderBar({ demo: true, outletLine: true });
    expect(screen.getByText("Demo Bakery · Outlet 1")).toBeTruthy();
    expect(screen.queryByText(/ends/)).toBeNull();
  });

  it("is in Bahasa when the language says so", () => {
    expiry = "11:20";
    renderBar({ demo: true, outletLine: true }, "id");
    expect(screen.getByText("berakhir 11:20")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Pilih bahasa" })).toBeTruthy();
  });

  it("Sign out is a real secondary button that calls the caller's handler; absent when not given", () => {
    const onClick = vi.fn();
    renderBar({ demo: true, signOut: { label: "Sign out", onClick } });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    cleanup();
    renderBar({ demo: true });
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("the switch changes language from the bar", () => {
    renderBar({ demo: true, outletLine: true });
    fireEvent.click(screen.getByRole("button", { name: /^ID\b/ }));
    expect(screen.getByRole("group", { name: "Pilih bahasa" })).toBeTruthy();
  });

  it("axe finds no violation, pilot and demo", async () => {
    expiry = "11:20";
    const { container } = renderBar({ demo: true, outletLine: true, signOut: { label: "Sign out", onClick: () => {} } });
    expect(await axeViolations(container)).toEqual([]);
    cleanup();
    const pilot = renderBar();
    expect(await axeViolations(pilot.container)).toEqual([]);
  });
});
