import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sign-in form is centred on wide screens (item 15: demo feedback 2, round 3).
 */
const css = readFileSync(join(__dirname, "sign-in.module.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("sign-in form CSS contract", () => {
  it("the .screen block contains margin: 0 auto to centre the form", () => {
    expect(block(".screen {")).toMatch(/margin:\s*0\s+auto/);
  });
});
