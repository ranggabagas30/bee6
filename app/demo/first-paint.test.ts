// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_STATE_KEY } from "@/app/demo/demo-state-key";
import { FIRST_PAINT_SCRIPT } from "@/app/demo/first-paint";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";

/**
 * R-19 PR-5: the inline script the root layout emits (DEMO_MODE only) before anything below it paints. It marks
 * <html> so CSS can hold the room of the two fixed demo chrome pieces that mount only after hydration:
 * - `b6-topbar-reserved` (the demo bar's slot) when this browser holds a demo state;
 * - `b6-panel-reserved` (round-3 D1: the judge guide's collapsed pill at >= 900 px, 70 px of body padding) on the
 *   entry routes (/, /sign-in, /pair: the guide is always there) and wherever a demo state exists.
 * Run for real here: the script is plain ES5 executed against jsdom's document, localStorage and location.
 */

const run = () => new Function(FIRST_PAINT_SCRIPT)();
const classes = () => Array.from(document.documentElement.classList).sort();
const go = (path: string) => window.history.pushState({}, "", path);

// This jsdom has no usable localStorage of its own: an in-memory one is installed per test (the script reads the
// global `localStorage`, as it does in a browser).
beforeEach(() => {
  vi.stubGlobal("localStorage", createMemoryStorage());
  document.documentElement.className = "";
  go("/day");
});
afterEach(() => {
  document.documentElement.className = "";
  vi.unstubAllGlobals();
});

describe("FIRST_PAINT_SCRIPT", () => {
  it("is tiny, self-contained ES5 (no imports, no template literals), names the demo state key and swallows storage errors", () => {
    expect(FIRST_PAINT_SCRIPT.length).toBeLessThan(400);
    expect(FIRST_PAINT_SCRIPT).toContain(JSON.stringify(DEMO_STATE_KEY));
    expect(FIRST_PAINT_SCRIPT).toContain("catch");
    expect(FIRST_PAINT_SCRIPT).not.toMatch(/import|require|`|=>|\blet\b|\bconst\b/);
  });

  it("with no demo state on a web route it adds nothing", () => {
    run();
    expect(classes()).toEqual([]);
  });

  it("with a demo state on a web route it reserves both the top bar and the pill", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, "{}");
    run();
    expect(classes()).toEqual(["b6-panel-reserved", "b6-topbar-reserved"]);
  });

  it.each(["/", "/sign-in", "/pair", "/sign-in/", "/pair/"])("on the entry route %s with no demo state it reserves the pill only (the guide is always there)", (p) => {
    go(p);
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it("on / with a demo state it reserves both (the bar's slot reserves nothing there by itself)", () => {
    go("/");
    window.localStorage.setItem(DEMO_STATE_KEY, "{}");
    run();
    expect(classes()).toEqual(["b6-panel-reserved", "b6-topbar-reserved"]);
  });

  it.each(["/capture", "/sop", "/home", "/signin", "/pairing"])("%s is not an entry route: nothing without a state", (p) => {
    go(p);
    run();
    expect(classes()).toEqual([]);
  });

  it("never reads the state's content: only whether the key is set", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, "{oops");
    run();
    expect(classes()).toEqual(["b6-panel-reserved", "b6-topbar-reserved"]);
    expect(FIRST_PAINT_SCRIPT).not.toMatch(/JSON\.parse|console/);
  });

  it("keeps whatever classes <html> already has", () => {
    document.documentElement.className = "font-a font-b";
    window.localStorage.setItem(DEMO_STATE_KEY, "{}");
    run();
    expect(classes()).toEqual(["b6-panel-reserved", "b6-topbar-reserved", "font-a", "font-b"]);
  });

  it("a storage that throws is not an error: the entry-route rule still applies", () => {
    go("/sign-in");
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
    });
    expect(() => run()).not.toThrow();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });
});
