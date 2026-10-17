// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_STATE_KEY } from "@/app/demo/demo-state-key";
import { FIRST_PAINT_SCRIPT } from "@/app/demo/first-paint";
import { createMemoryStorage } from "@/lib/demo/testing/memory-storage";

/**
 * R-19 PR-5 / R-25 R6: the inline script the root layout emits (DEMO_MODE only) before anything below it paints. It
 * marks <html> so CSS can hold the room of the one piece of demo chrome that mounts only after hydration:
 * - `b6-panel-reserved` (round-3 D1: the judge guide's collapsed pill at >= 900 px, held as right-hand room in the .b6-pill-room headers) on the
 *   entry routes (/, /sign-in, /pair: the guide is always there) and wherever a LIVE demo state exists (an ended
 *   one signs the judge out: no guide on a web route).
 * `b6-topbar-reserved` (the old demo bar's slot) is gone with the bar (R6): it is never set, live or ended.
 * Run for real here: the script is plain ES5 executed against jsdom's document, localStorage and location.
 */

const run = () => new Function(FIRST_PAINT_SCRIPT)();
const classes = () => Array.from(document.documentElement.classList).sort();
const go = (path: string) => window.history.pushState({}, "", path);
const KEY = "A".repeat(43);
const live = () => JSON.stringify({ sandbox_key: KEY, expires_at_ms: Date.now() + 3_600_000, role: "owner" });
const ended = () => JSON.stringify({ expires_at_ms: Date.now() - 1_000, role: "owner" });

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
  it("never sets the retired b6-topbar-reserved class, live or ended, on any route", () => {
    expect(FIRST_PAINT_SCRIPT).not.toContain("b6-topbar-reserved");
    for (const state of [live(), ended()]) {
      for (const p of ["/", "/day", "/pair", "/sign-in", "/capture"]) {
        go(p);
        document.documentElement.className = "";
        window.localStorage.setItem(DEMO_STATE_KEY, state);
        run();
        expect(classes(), `${p}`).not.toContain("b6-topbar-reserved");
      }
    }
  });

  it("is small, self-contained ES5 (no imports, no template literals), names the demo state key, never logs and swallows errors", () => {
    expect(FIRST_PAINT_SCRIPT.length).toBeLessThan(600);
    expect(FIRST_PAINT_SCRIPT).toContain(JSON.stringify(DEMO_STATE_KEY));
    expect(FIRST_PAINT_SCRIPT).toContain("catch");
    expect(FIRST_PAINT_SCRIPT).not.toMatch(/import|require|`|=>|\blet\b|\bconst\b|console/);
  });

  it("with no demo state on a web route it adds nothing", () => {
    run();
    expect(classes()).toEqual([]);
  });

  it("with a live demo state on a web route it reserves the pill only (no top bar room any more)", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, live());
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it.each(["/", "/sign-in", "/pair", "/sign-in/", "/pair/"])("on the entry route %s with no demo state it reserves the pill only (the guide is always there)", (p) => {
    go(p);
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  // An unpaired browser opening /capture is sent to /pair (an entry route) by the page itself, after hydration:
  // without the reserve the pill's padding landed late there too (CLS 0.055 at 1280 px, measured).
  it.each(["/capture", "/capture/"])("%s with no demo state reserves the pill (the page redirects to /pair, a sandbox phone gets the card)", (p) => {
    go(p);
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it("on / with a live demo state it reserves the pill", () => {
    go("/");
    window.localStorage.setItem(DEMO_STATE_KEY, live());
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it("a LIVE state on /sign-in reserves the pill only", () => {
    go("/sign-in");
    window.localStorage.setItem(DEMO_STATE_KEY, live());
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it.each(["/sop", "/home", "/day", "/signin", "/pairing", "/captured"])("%s is not an entry route: nothing without a state", (p) => {
    go(p);
    run();
    expect(classes()).toEqual([]);
  });

  // Round-4 D1: an ended state on /sign-in left a blank 54 / 36 px band above the header: the bar hides its ended
  // line there, so nothing may be reserved for it.
  it.each(["/sign-in", "/sign-in/"])("an ENDED state on %s reserves the pill only: the bar hides its ended line there", (p) => {
    go(p);
    window.localStorage.setItem(DEMO_STATE_KEY, ended());
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it.each(["/pair", "/pair/"])("an ENDED state on %s reserves the pill only (the entry-route rule); the ended box reserves nothing", (p) => {
    go(p);
    window.localStorage.setItem(DEMO_STATE_KEY, ended());
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it("an ENDED state on a web route reserves nothing (the judge is signed out, so no guide, and the ended box holds no room)", () => {
    window.localStorage.setItem(DEMO_STATE_KEY, ended());
    run();
    expect(classes()).toEqual([]);
  });

  it("an ENDED state on / reserves the pill only (the bar hides on the entry page)", () => {
    go("/");
    window.localStorage.setItem(DEMO_STATE_KEY, ended());
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it("a state whose expiry is exactly now is ended (the bar's own rule: now >= expires_at_ms)", () => {
    vi.useFakeTimers({ now: new Date("2026-10-15T08:00:00Z") });
    try {
      go("/sign-in");
      window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify({ expires_at_ms: Date.now(), role: "owner" }));
      run();
      expect(classes()).toEqual(["b6-panel-reserved"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["malformed JSON", "{oops"],
    ["not an object", "42"],
    ["null", "null"],
    ["no expiry", JSON.stringify({ role: "owner" })],
    ["a string expiry", JSON.stringify({ expires_at_ms: "soon", role: "owner" })],
    ["an expiry beyond the Date range (the bar treats it as tampered)", JSON.stringify({ expires_at_ms: 8.64e15 + 1, role: "owner" })],
    ["NaN expiry", "{\"expires_at_ms\":NaN}"],
  ])("a record the bar would not show (%s) reserves nothing on a web route", (_name, raw) => {
    window.localStorage.setItem(DEMO_STATE_KEY, raw);
    expect(() => run()).not.toThrow();
    expect(classes()).toEqual([]);
  });

  it("a malformed record on an entry route still gets the pill (the entry-route rule is independent)", () => {
    go("/pair");
    window.localStorage.setItem(DEMO_STATE_KEY, "{oops");
    run();
    expect(classes()).toEqual(["b6-panel-reserved"]);
  });

  it("keeps whatever classes <html> already has", () => {
    document.documentElement.className = "font-a font-b";
    window.localStorage.setItem(DEMO_STATE_KEY, live());
    run();
    expect(classes()).toEqual(["b6-panel-reserved", "font-a", "font-b"]);
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
