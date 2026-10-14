import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GLOBALS_CSS_PATH } from "@/lib/testing/css";

/**
 * R-19 PR-0b guard. The page-2 design system (app/ui/** and app/globals.css) is pure presentation: it takes children and
 * props, carries no demo or pilot copy, and imports nothing from lib/demo, any server module or Firebase. The
 * demo layer may use it; it must never depend on the demo.
 */

const UI_DIR = join(__dirname);
const sources = readdirSync(UI_DIR)
  .filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))
  .map((n) => ({ name: `app/ui/${n}`, text: readFileSync(join(UI_DIR, n), "utf8") }));
sources.push({ name: "app/globals.css", text: readFileSync(GLOBALS_CSS_PATH, "utf8") });

const importSpecs = (text: string): string[] =>
  Array.from(text.matchAll(/(?:from\s+|import\s*\(?\s*|require\s*\()\s*["']([^"']+)["']/g), (m) => m[1] ?? "");

describe("app/ui and app/globals.css boundaries", () => {
  it("finds the design-system sources", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it("imports nothing from lib/demo", () => {
    for (const s of sources) {
      expect(importSpecs(s.text).filter((spec) => /lib\/demo/.test(spec)), s.name).toEqual([]);
      expect(s.text, `${s.name} mentions lib/demo`).not.toMatch(/lib\/demo/);
    }
  });

  it("imports only react, next/font/google, and its own app/ui modules", () => {
    for (const s of sources.filter((x) => x.name.endsWith(".ts") || x.name.endsWith(".tsx"))) {
      for (const spec of importSpecs(s.text)) {
        expect(
          spec === "react" || spec === "next/font/google" || spec.startsWith("@/app/ui/"),
          `${s.name} imports ${spec}`,
        ).toBe(true);
      }
    }
  });

  it("globals.css pulls in no other stylesheet or remote resource", () => {
    const css = sources.find((s) => s.name === "app/globals.css")!.text;
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(/);
  });

  it("does not read the environment, call the network or touch storage", () => {
    for (const s of sources) {
      expect(s.text, s.name).not.toMatch(/process\.env|fetch\(|localStorage|sessionStorage|document\.cookie/);
    }
  });

  it("carries no demo, pilot or shop copy", () => {
    for (const s of sources) {
      expect(s.text, s.name).not.toMatch(/\b(demo|pilot|judge|proofed|bakery|bee6 demo)\b/i);
    }
  });
});
