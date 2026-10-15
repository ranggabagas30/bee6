// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PANEL_WIDTH_PX, drawerInsetStyle, isCompactChrome, useDrawerLayout } from "@/app/capture/drawer-layout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const { wide } = useDrawerLayout();
  return <p>{wide ? "wide" : "narrow"}</p>;
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
  it("falls back to narrow when matchMedia is missing", () => {
    render(<Probe />);
    expect(screen.getByText("narrow")).toBeTruthy();
  });

  it("reads 900 px and follows changes", () => {
    const mm = stubMatchMedia({ "(min-width: 900px)": true });
    render(<Probe />);
    expect(screen.getByText("wide")).toBeTruthy();
    act(() => mm.set("(min-width: 900px)", false));
    expect(screen.getByText("narrow")).toBeTruthy();
  });
});

describe("drawerInsetStyle: only the guide's side panel moves the page", () => {
  it("no guide (the pilot): no change at all", () => {
    expect(drawerInsetStyle({ present: false, wide: false })).toEqual({});
    expect(drawerInsetStyle({ present: false, wide: true })).toEqual({});
  });
  it("under 900 px the guide is a bottom sheet that reserves its own space, so the page needs no inset", () => {
    expect(drawerInsetStyle({ present: true, wide: false })).toEqual({});
  });
  it("side panel: the page column moves left of the 360 px panel (open or collapsed alike), so the toggle never moves the page and the open panel never covers the column (900-1100 px)", () => {
    expect(drawerInsetStyle({ present: true, wide: true })).toEqual({
      marginLeft: "max(0px, calc((100vw - 720px) / 2))",
      marginRight: "auto",
    });
  });
  it("the offset assumes two 360 px halves: the panel width is the design token's 360 px", () => {
    expect(PANEL_WIDTH_PX).toBe(360);
  });
});

describe("compact page chrome (narrow screens with a guide only)", () => {
  it("is on only when a guide is present and the screen is narrow, so the pilot and wide screens are untouched", () => {
    expect(isCompactChrome({ present: true, wide: false })).toBe(true);
    expect(isCompactChrome({ present: true, wide: true })).toBe(false);
    expect(isCompactChrome({ present: false, wide: false })).toBe(false);
  });
});
