import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-19 PR-6 §8.2 follow-up: the top bar's `bee6` brand link is a tap target, so its box is at least 44 x 44 px (the
 * nav shell's own rule, and WCAG 2.5.8) while the glyphs keep their size: a flex box with a min-height and min-width,
 * not a bigger font. The bar is already 48 px tall, so the row at 360 px does not grow.
 */
const css = readFileSync(join(__dirname, "shell.module.css"), "utf8");
const block = (selector: string): string => {
  const m = css.match(new RegExp(`${selector.replace(/[.]/g, "\\$&")}\\s*{([^}]*)}`));
  if (!m) throw new Error(`no ${selector} block`);
  return m[1]!;
};

describe("shell.module.css: the brand link's tap target", () => {
  it(".brand is a 44 x 44 px minimum box", () => {
    const brand = block(".brand");
    expect(brand).toMatch(/min-height:\s*44px/);
    expect(brand).toMatch(/min-width:\s*44px/);
    expect(brand).toMatch(/display:\s*inline-flex/);
    expect(brand).toMatch(/align-items:\s*center/);
  });

  it(".brand keeps its 20 px wordmark (the box grows, not the type)", () => {
    expect(block(".brand")).toMatch(/font-size:\s*20px/);
  });

  // At 360 px the bar wraps into two rows, and the brand's row is 24 px tall (the pill is no taller than the wordmark).
  // A 44 px box would make that row 44 px (measured: the header grew 81 -> 100 px). The box therefore gets a known
  // 24 px line and negative block margins: its margin box stays 24 px, so the row keeps its height, while the border
  // box (what a finger hits and what axe measures) is 44 px. The 20 px overhang is split 13 px up (inside the page's
  // 16 px top padding) and 7 px down (inside the 8 px row gap, 1 px clear of the controls row: a symmetric 10/10 split
  // measured 2 px into the language switch), and 6 px of top padding puts the wordmark back where it was.
  it(".brand's 44 px box does not change the row's height nor the wordmark's place: 24 px line, -13/-7 px block margins, 6 px top padding", () => {
    const brand = block(".brand");
    expect(brand).toMatch(/line-height:\s*24px/);
    expect(brand).toMatch(/margin-block:\s*-13px\s+-7px/);
    expect(brand).toMatch(/padding-top:\s*6px/);
    expect(brand).toMatch(/box-sizing:\s*border-box/);
  });

  it("the bar stays at its 48 px minimum, so a 44 px brand box adds no height to the row", () => {
    expect(block(".bar")).toMatch(/min-height:\s*48px/);
  });
});
