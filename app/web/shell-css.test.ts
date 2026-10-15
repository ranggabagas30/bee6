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

  it("the bar stays at its 48 px minimum, so a 44 px brand box adds no height to the row", () => {
    expect(block(".bar")).toMatch(/min-height:\s*48px/);
  });
});
