import { describe, expect, it } from "vitest";
import { contrast, declarations, parseCss, readGlobalsCss, rootTokens } from "@/app/ui/css-helpers";

const css = readGlobalsCss();
const tokens = rootTokens(css);

describe("page-2 design tokens (app/globals.css)", () => {
  it("declares the page-2 colour palette as --b6-* custom properties on :root", () => {
    expect(tokens).toMatchObject({
      "--b6-ground": "#F5F4F1",
      "--b6-ink": "#2B2A26",
      "--b6-muted": "#5F5C55",
      "--b6-line": "#E4E1DA",
      "--b6-chip": "#EBE9E4",
      "--b6-surface": "#FFFFFF",
      "--b6-teal": "#8AC7BA",
      "--b6-teal-ink": "#2F6A5D",
      "--b6-teal-bg": "#EEF6F4",
      "--b6-amber-ink": "#6E4A00",
      "--b6-amber-bg": "#FBF3E2",
      "--b6-red-ink": "#8E3526",
      "--b6-red-bg": "#FBEFEB",
      "--b6-green-ink": "#2F4A37",
      "--b6-green-bg": "#EEF3EF",
    });
  });

  it("declares radii, type scale and fonts", () => {
    expect(tokens["--b6-r-card"]).toBe("18px");
    expect(tokens["--b6-r-glass"]).toBe("16px");
    expect(tokens["--b6-r-control"]).toBe("12px");
    expect(tokens["--b6-r-btn-lg"]).toBe("20px");
    expect(tokens["--b6-r-btn"]).toBe("16px");
    expect(tokens["--b6-font-sans"]).toMatch(/system-ui/);
    expect(tokens["--b6-font-mono"]).toMatch(/monospace/);
    for (const k of ["--b6-fs-h1", "--b6-fs-title", "--b6-fs-body", "--b6-fs-small", "--b6-fs-kicker"]) {
      expect(tokens[k], k).toMatch(/px$/);
    }
  });

  it("only declares custom properties on :root, so no existing page can change", () => {
    const rootRules = parseCss(css).filter((r) => r.prelude === ":root");
    expect(rootRules.length).toBeGreaterThan(0);
    for (const rule of rootRules) {
      for (const [prop] of declarations(rule.body)) expect(prop.startsWith("--b6-"), prop).toBe(true);
    }
  });

  it("scopes every other selector to a .b6-* class (no element or global resets)", () => {
    const selectors: string[] = [];
    const walk = (rules: ReturnType<typeof parseCss>) => {
      for (const r of rules) {
        if (r.prelude.startsWith("@keyframes")) {
          expect(r.prelude, "keyframes names are prefixed").toMatch(/^@keyframes b6-/);
        } else if (r.prelude.startsWith("@")) walk(r.children);
        else if (r.prelude !== ":root") selectors.push(...r.prelude.split(",").map((s) => s.trim()));
      }
    };
    walk(parseCss(css));
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel, sel).toMatch(/^\.b6-[a-z0-9_-]+/);
  });

  it("text colour pairs meet WCAG AA (4.5:1)", () => {
    const t = (k: string) => tokens[k];
    const pairs: Array<[string, string]> = [
      ["--b6-ink", "--b6-ground"],
      ["--b6-muted", "--b6-ground"],
      ["--b6-muted", "--b6-surface"],
      ["--b6-muted", "--b6-chip"],
      ["--b6-ink-soft", "--b6-chip"],
      ["--b6-ink", "--b6-chip"],
      ["--b6-teal-ink", "--b6-teal-bg"],
      ["--b6-teal-ink", "--b6-surface"],
      ["--b6-amber-ink", "--b6-amber-bg"],
      ["--b6-red-ink", "--b6-red-bg"],
      ["--b6-green-ink", "--b6-green-bg"],
      ["--b6-surface", "--b6-red-ink"],
      ["--b6-on-dark", "--b6-dark-hi"],
      ["--b6-muted", "--b6-disabled-bg"],
    ];
    for (const [fg, bg] of pairs) {
      expect(t(fg), fg).toBeTruthy();
      expect(t(bg), bg).toBeTruthy();
      expect(contrast(t(fg), t(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the focus ring and tick outlines meet 3:1 against the grounds they sit on", () => {
    for (const bg of ["--b6-ground", "--b6-surface", "--b6-chip"]) {
      expect(contrast(tokens["--b6-focus"], tokens[bg]), bg).toBeGreaterThanOrEqual(3);
    }
  });

  it("turns transitions off under prefers-reduced-motion", () => {
    const media = parseCss(css).find((r) => r.prelude === "@media (prefers-reduced-motion: reduce)");
    expect(media, "reduced-motion block exists").toBeTruthy();
    expect(media!.body).toMatch(/transition:\s*none/);
  });

  it("every animated selector is switched off in the reduced-motion block", () => {
    const rules = parseCss(css);
    const media = rules.find((r) => r.prelude === "@media (prefers-reduced-motion: reduce)")!;
    const off = new Set(
      media.children.filter((r) => /animation:\s*none/.test(r.body)).flatMap((r) => r.prelude.split(",").map((s) => s.trim())),
    );
    for (const r of rules) {
      if (r.prelude.startsWith("@") || !/(^|;|\s)animation(-name)?\s*:/.test(r.body)) continue;
      for (const sel of r.prelude.split(",").map((s) => s.trim())) expect(off.has(sel), `${sel} animates`).toBe(true);
    }
  });
});
