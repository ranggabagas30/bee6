import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner Home links keep a tap target of 44 px or more whatever their copy says (R-19 integration QA: the per-row
 * Review link read "Tinjau" in Bahasa, 38 px wide at 360 px; WCAG 2.5.8 and the board's 44 px minimum). R-25 T13: the
 * waiting row is now the whole link (min 56 px tall, the board's row), and the quiet text links ("See the full day",
 * "See the new SOP version", "+N more") are 44 px tall boxes. The size is a CSS rule, not a copy rule, so a shorter
 * translation can never shrink the target again.
 */
const css = readFileSync(join(__dirname, "home.module.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("Owner Home link CSS contract", () => {
  it(".row (the whole waiting row is the link) is at least 56 px tall and spans the card", () => {
    const row = block("\n.row {");
    expect(row).toMatch(/min-height:\s*56px/);
    expect(row).toMatch(/display:\s*flex/);
  });

  it(".softLink is a 44 px tall box, so a short label still meets the tap target", () => {
    const link = block("\n.softLink {");
    expect(link).toMatch(/min-height:\s*44px/);
    expect(link).toMatch(/display:\s*inline-flex/);
  });

  it("the page carries no page-level frame of its own any more (WebShell owns main, ground and body margin)", () => {
    expect(css).not.toMatch(/^\.page\s*\{/m);
    expect(css).not.toMatch(/^\.main\s*\{/m);
    expect(css).not.toMatch(/:global\(body\)/);
  });
});
