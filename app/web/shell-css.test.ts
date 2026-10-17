import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R-25 T8: the page-2 web shell's px (boards D2-02..D2-08): the `.dtop` bar, the 210 px left nav with 44 px items, `main`'s
 * padding, and the brand link's 44 px tap box (WCAG 2.5.8) around the 26 px mark. jsdom has no layout, so the numbers are
 * pinned in the source.
 */
const css = readFileSync(join(__dirname, "shell.module.css"), "utf8");
const block = (selector: string, from = 0): string => {
  const m = css.slice(from).match(new RegExp(`${selector.replace(/[.]/g, "\\$&")}\\s*{([^}]*)}`));
  if (!m) throw new Error(`no ${selector} block`);
  return m[1]!;
};
const wide = css.indexOf("@media (min-width: 900px)");

describe("shell.module.css: the .dtop bar", () => {
  it(".dtop is padding 14/28 from 900 px, with a hairline under it and a white 55 % ground", () => {
    expect(block(".dtop", wide)).toMatch(/padding:\s*14px 28px/);
    const dtop = block(".dtop");
    expect(dtop).toMatch(/border-bottom:\s*1px solid var\(--b6-line-soft\)/);
    expect(dtop).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.55\)/);
    expect(dtop).toMatch(/flex-wrap:\s*wrap/);
  });

  it(".brand is a 44 x 44 px minimum box and the mark is 26 px", () => {
    const brand = block(".brand");
    expect(brand).toMatch(/min-height:\s*44px/);
    expect(brand).toMatch(/min-width:\s*44px/);
    expect(brand).toMatch(/display:\s*inline-flex/);
    expect(block(".logoMark")).toMatch(/width:\s*26px/);
    expect(block(".logoWord")).toMatch(/font-weight:\s*800/);
  });
});

describe("shell.module.css: nav and main", () => {
  it("the rail is 210 px wide from 900 px and stacks its items", () => {
    expect(block(".navRail", wide)).toMatch(/width:\s*210px/);
    expect(css.slice(wide)).toMatch(/\.navRail \.navList\s*{[^}]*flex-direction:\s*column/);
  });

  it("nav items are 44 px tall with a 12 px radius; the current one is white with a shadow", () => {
    const link = block(".navLink");
    expect(link).toMatch(/min-height:\s*var\(--b6-tap\)/);
    expect(link).toMatch(/border-radius:\s*var\(--b6-r-control\)/);
    expect(link).toMatch(/font-size:\s*var\(--b6-fs-body\)/);
    const current = css.match(/\.navLinkCurrent,\s*\.navLinkCurrent:hover\s*{([^}]*)}/)?.[1] ?? "";
    expect(current).toMatch(/background:\s*var\(--b6-surface\)/);
    expect(current).toMatch(/box-shadow:/);
  });

  it("main is a flex column with 22 px gap and 22/32/56 padding from 900 px, and may shrink", () => {
    const main = block(".main");
    expect(main).toMatch(/flex-direction:\s*column/);
    expect(main).toMatch(/gap:\s*22px/);
    expect(main).toMatch(/min-width:\s*0/);
    expect(block(".main", wide)).toMatch(/padding:\s*22px 32px 56px/);
  });

  it("the shell cancels the body margin for its own page only and sets no global reset", () => {
    expect(css).toMatch(/:global\(body\):has\(\.shell\)\s*{\s*margin:\s*0;/);
    expect(readFileSync(join(__dirname, "..", "globals.css"), "utf8")).not.toMatch(/:has\(\.shell\)/);
  });

  it("the badge is the board's 22 px dark count", () => {
    const badge = block(".badge");
    expect(badge).toMatch(/min-width:\s*22px/);
    expect(badge).toMatch(/height:\s*22px/);
  });
});
