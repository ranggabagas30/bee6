import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The CODE cell of the SOP table never widens the card or the table (R-19 PR-9b, QA D1). A step added by a Bee6
 * proposal has a 34-char id (`lib/sop/ship.ts` newStepId; the schema allows 40) and the global chip is nowrap, so the
 * chip must be clipped with an ellipsis inside its cell at every width: the stacked phone card's value column may shrink
 * to zero and the chip has `min-width: 0`; from 720 px the chip has an absolute max-width so the auto table layout cannot
 * squeeze STEP.
 */
const css = readFileSync(join(__dirname, "sop.module.css"), "utf8");
const block = (selector: string, from = 0) => {
  const start = css.indexOf(selector, from);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start) + 1);
};
const wide = css.indexOf("@media (min-width: 720px)", css.indexOf(".table {"));

describe("SOP table CODE cell CSS contract", () => {
  it("the stacked card's value column can shrink below the chip (minmax(0, 1fr)), so a long id never widens the card", () => {
    expect(block("\n.td {")).toMatch(/grid-template-columns:\s*minmax\(72px,\s*32%\)\s+minmax\(0,\s*1fr\)/);
  });

  it("the code chip clips with an ellipsis inside its cell and keeps the full id in the DOM", () => {
    const code = block("\n.code {");
    expect(code).toMatch(/min-width:\s*0/);
    expect(code).toMatch(/max-width:\s*100%/);
    expect(code).toMatch(/overflow:\s*hidden/);
    expect(code).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("from 720 px the chip has an absolute max-width, so CODE is bounded and STEP keeps its room in the auto layout", () => {
    expect(wide).toBeGreaterThan(0);
    const code = block(".code {", wide);
    expect(code).toMatch(/max-width:\s*\d+(ch|px)/);
    expect(code).not.toMatch(/max-width:\s*100%/);
  });
});
