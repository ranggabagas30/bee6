import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner Home text links keep a 44 x 48 px tap target whatever their copy says (R-19 integration QA: the per-row
 * Review link reads "Tinjau" in Bahasa, 38 px wide at 360 px; WCAG 2.5.8 and the board's 44 px minimum). The width
 * is a CSS rule, not a copy rule, so a shorter translation can never shrink the target again.
 */
const css = readFileSync(join(__dirname, "home.module.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("Owner Home link CSS contract", () => {
  it(".link is at least 44 px wide and 48 px tall, so a short label (Tinjau) still meets the tap target", () => {
    const link = block("\n.link {");
    expect(link).toMatch(/min-width:\s*44px/);
    expect(link).toMatch(/min-height:\s*48px/);
  });

  it(".link centres its label inside the widened box, so a short label is not left-hugging a 44 px target", () => {
    expect(block("\n.link {")).toMatch(/justify-content:\s*center/);
  });
});
