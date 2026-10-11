// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { drawerInsetStyle, useDrawerLayout } from "@/app/capture/drawer-layout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const { wide, reducedMotion } = useDrawerLayout();
  return <p>{`${wide ? "wide" : "narrow"}/${reducedMotion ? "still" : "motion"}`}</p>;
}

function stubMatchMedia(matches: Record<string, boolean>) {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      return matches[q] ?? false;
    },
    media: q,
    addEventListener: (_: string, fn: () => void) => {
      if (!listeners.has(q)) listeners.set(q, new Set());
      listeners.get(q)!.add(fn);
    },
    removeEventListener: (_: string, fn: () => void) => listeners.get(q)?.delete(fn),
  }));
  return {
    set(q: string, v: boolean) {
      matches[q] = v;
      for (const fn of listeners.get(q) ?? []) fn();
    },
  };
}

describe("useDrawerLayout", () => {
  it("falls back to narrow with motion when matchMedia is missing", () => {
    render(<Probe />);
    expect(screen.getByText("narrow/motion")).toBeTruthy();
  });

  it("reads 900 px and reduced motion, and follows changes", () => {
    const mm = stubMatchMedia({ "(min-width: 900px)": true, "(prefers-reduced-motion: reduce)": true });
    render(<Probe />);
    expect(screen.getByText("wide/still")).toBeTruthy();
    act(() => mm.set("(min-width: 900px)", false));
    expect(screen.getByText("narrow/still")).toBeTruthy();
  });
});

describe("drawerInsetStyle: the page keeps its content clear of the drawer", () => {
  it("no drawer: no change at all", () => {
    expect(drawerInsetStyle({ present: false, wide: false, open: true })).toEqual({});
  });
  it("bottom sheet open: bottom padding of the sheet's height; collapsed: the 56 px handle", () => {
    expect(drawerInsetStyle({ present: true, wide: false, open: true })).toEqual({ paddingBottom: "calc(55vh + 24px)" });
    expect(drawerInsetStyle({ present: true, wide: false, open: false })).toEqual({ paddingBottom: "80px" });
  });
  it("side panel: the 360 px column moves left so the 360 px panel never covers it", () => {
    expect(drawerInsetStyle({ present: true, wide: true, open: true })).toEqual({
      marginLeft: "max(0px, calc((100vw - 720px) / 2))",
      marginRight: "auto",
    });
    expect(drawerInsetStyle({ present: true, wide: true, open: false })).toEqual({});
  });
});
