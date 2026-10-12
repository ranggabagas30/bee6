// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  PANEL_WIDTH_PX,
  SIDE_PANEL_TOP_CLEARANCE_PX,
  drawerInsetStyle,
  isCompactChrome,
  sidePanelBoxStyle,
  useDrawerLayout,
} from "@/app/capture/drawer-layout";

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

describe("drawerInsetStyle: only the side panel moves the page", () => {
  it("no drawer: no change at all", () => {
    expect(drawerInsetStyle({ present: false, wide: false, open: true })).toEqual({});
  });
  it("under 900 px the drawer is in flow, so the page needs no padding or inset in any state", () => {
    expect(drawerInsetStyle({ present: true, wide: false, open: true })).toEqual({});
    expect(drawerInsetStyle({ present: true, wide: false, open: false })).toEqual({});
  });
  it("side panel: the page column moves left of the 360 px panel in BOTH states, so even the collapsed handle never covers the top bar or the EN/ID switch (900-1100 px)", () => {
    const shifted = {
      marginLeft: "max(0px, calc((100vw - 720px) / 2))",
      marginRight: "auto",
    };
    expect(drawerInsetStyle({ present: true, wide: true, open: true })).toEqual(shifted);
    expect(drawerInsetStyle({ present: true, wide: true, open: false })).toEqual(shifted);
  });
});

describe("side panel box: pinned to the bottom edge, never reaching the demo bar or the top bar", () => {
  it("the clearance above the panel is at least the tallest demo bar (about 110 px, about 150 px with a two-line status) so it can never cover that bar's buttons", () => {
    expect(SIDE_PANEL_TOP_CLEARANCE_PX).toBeGreaterThanOrEqual(160);
  });
  it("collapsed: only the handle's own height, anchored to the bottom edge", () => {
    expect(sidePanelBoxStyle(false)).toEqual({ bottom: 0 });
  });
  it("open: anchored to the bottom edge and as tall as the viewport minus the clearance", () => {
    expect(sidePanelBoxStyle(true)).toEqual({ bottom: 0, height: `calc(100dvh - ${SIDE_PANEL_TOP_CLEARANCE_PX}px)` });
  });
  it("is exactly as wide as the room the page column leaves (the column offset assumes two 360 px halves)", () => {
    expect(PANEL_WIDTH_PX).toBe(360);
  });
});

describe("compact page chrome (narrow screens with a drawer only)", () => {
  it("is on only when a drawer is present and the screen is narrow, so the pilot and wide screens are untouched", () => {
    expect(isCompactChrome({ present: true, wide: false })).toBe(true);
    expect(isCompactChrome({ present: true, wide: true })).toBe(false);
    expect(isCompactChrome({ present: false, wide: false })).toBe(false);
  });
});
