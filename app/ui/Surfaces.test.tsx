// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Card, Glass } from "@/app/ui/Card";
import { Tile } from "@/app/ui/Tile";
import { Mist } from "@/app/ui/Mist";
import { Kicker } from "@/app/ui/Kicker";
import { axeViolations } from "@/lib/testing/axe";
import { contrast, minHeightPx, parseCss, readGlobalsCss, rootTokens, ruleDeclarations, tok } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();

describe("Card and Glass", () => {
  it("Card renders its children in a b6-card surface with the 18px radius token", () => {
    render(<Card data-testid="c">hello</Card>);
    const el = screen.getByTestId("c");
    expect(el.textContent).toBe("hello");
    expect(el.className).toContain("b6-card");
    expect(ruleDeclarations(css, ".b6-card")["border-radius"]).toBe("var(--b6-r-card)");
    expect(ruleDeclarations(css, ".b6-card")["background"]).toBe("var(--b6-surface)");
  });

  it("Glass is the translucent 16px surface", () => {
    render(<Glass data-testid="g">x</Glass>);
    expect(screen.getByTestId("g").className).toContain("b6-glass");
    expect(ruleDeclarations(css, ".b6-glass")["border-radius"]).toBe("var(--b6-r-glass)");
  });

  it("renders the element named by `as` and keeps caller classes and aria attributes", () => {
    render(
      <Card as="section" aria-label="Summary" className="extra">
        body
      </Card>,
    );
    const el = screen.getByRole("region", { name: "Summary" });
    expect(el.tagName).toBe("SECTION");
    expect(el.className).toContain("extra");
    expect(el.className).toContain("b6-card");
  });

  it("is a plain div by default, which exposes no role", () => {
    const { container } = render(<Card>x</Card>);
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });
});

describe("Tile", () => {
  it("shows the label, the big value and the detail line", () => {
    render(<Tile label="WORK NOTES" value="7" detail="highest confidence shown" data-testid="t" />);
    const t = screen.getByTestId("t");
    expect(t.textContent).toContain("WORK NOTES");
    expect(t.textContent).toContain("7");
    expect(t.textContent).toContain("highest confidence shown");
    expect(t.className).toContain("b6-card");
    expect(t.className).toContain("b6-tile");
  });

  it("detail is optional and `glass` swaps the surface", () => {
    render(<Tile label="L" value="1" surface="glass" data-testid="t" />);
    const t = screen.getByTestId("t");
    expect(t.className).toContain("b6-glass");
    expect(t.className).not.toContain("b6-card");
  });

  it("the amber tone is a class, not a colour-only cue: label text stays in the DOM", () => {
    render(<Tile label="NEED YOUR CHECK" value="1" tone="amber" data-testid="t" />);
    const t = screen.getByTestId("t");
    expect(t.className).toContain("b6-tile--amber");
    expect(t.textContent).toContain("NEED YOUR CHECK");
    expect(ruleDeclarations(css, ".b6-tile--amber")["background"]).toBe("var(--b6-amber-bg)");
  });
});

describe("Kicker", () => {
  it("is the mono caps label at 12px in the muted colour", () => {
    render(<Kicker>YOUR JOURNEY</Kicker>);
    const el = screen.getByText("YOUR JOURNEY");
    expect(el.className).toContain("b6-kicker");
    const d = ruleDeclarations(css, ".b6-kicker");
    expect(d["font-family"]).toBe("var(--b6-font-mono)");
    expect(d["font-size"]).toBe("var(--b6-fs-kicker)");
    expect(d["color"]).toBe("var(--b6-muted)");
    expect(rootTokens(css)["--b6-fs-kicker"]).toBe("12px");
  });
});

describe("Mist", () => {
  it("is decoration only: hidden from assistive tech, not focusable, never intercepts taps", () => {
    const { container } = render(<Mist />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.tabIndex).toBe(-1);
    expect(el.textContent).toBe("");
    expect(el.className).toContain("b6-mist");
    expect(ruleDeclarations(css, ".b6-mist")["pointer-events"]).toBe("none");
  });

  it("has no animation of its own, so it is reduced-motion safe by construction", () => {
    for (const sel of [".b6-mist", ".b6-mist__leaf"]) {
      expect(Object.keys(ruleDeclarations(css, sel)).some((k) => k.startsWith("animation")), sel).toBe(false);
    }
  });
});

describe("a11y", () => {
  it("a composed surface has no axe violations", async () => {
    const { container } = render(
      <main>
        <Mist />
        <Card as="section" aria-label="Today">
          <Kicker>TODAY</Kicker>
          <Tile label="WORK NOTES" value="7" detail="shown" />
        </Card>
      </main>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

// ---- R-25 G0: shared classes every page-2 screen codes against (class names are the contract) ----
const rules = parseCss(css);
const decl = (sel: string) => ruleDeclarations(css, sel);
const inMedia = (media: string, sel: string) =>
  rules.find((r) => r.prelude === media && r.children.some((c) => c.prelude === sel))?.children.find((c) => c.prelude === sel)?.body ?? "";

describe("display type classes", () => {
  it("the headline sizes follow the page-2 boards", () => {
    expect(decl(".b6-h1-display")).toMatchObject({ "font-size": "var(--b6-fs-h1)", "font-weight": "300", "letter-spacing": "-0.4px" });
    expect(rootTokens(css)["--b6-fs-h1"]).toBe("34px");
    expect(decl(".b6-h1-web")).toMatchObject({ "font-size": "38px", "font-weight": "300" });
    expect(decl(".b6-h1-entry")).toMatchObject({ "font-size": "32px", "font-weight": "300" });
    expect(inMedia("@media (min-width: 900px)", ".b6-h1-entry")).toContain("font-size: 48px");
    expect(decl(".b6-h2-card")).toMatchObject({ "font-size": "22px", "font-weight": "500" });
  });

  it("body helpers: sub, mono, note, kick, quote", () => {
    expect(decl(".b6-sub")["color"]).toBe("var(--b6-muted)");
    expect(decl(".b6-mono")["font-family"]).toBe("var(--b6-font-mono)");
    expect(decl(".b6-note")["text-align"]).toBe("center");
    expect(decl(".b6-kick")).toMatchObject({ "font-family": "var(--b6-font-mono)", "font-size": "var(--b6-fs-kicker)", "text-transform": "uppercase" });
    expect(decl(".b6-kick")["border"]).toBeUndefined();
    expect(decl(".b6-quote")["font-style"]).toBe("italic");
  });
});

describe("Tile value", () => {
  it("carries the light-weight value class", () => {
    render(<Tile label="L" value="7" data-testid="t" />);
    expect(screen.getByText("7").className).toContain("b6-tile__n");
    expect(decl(".b6-tile__n")["font-weight"]).toBe("300");
  });
});

describe("alerts", () => {
  it("red and amber pair a tinted ground with its ink; the lead line is bold", () => {
    expect(decl(".b6-alert")).toMatchObject({ "border-radius": "var(--b6-r-control)", padding: "12px 14px" });
    expect(decl(".b6-alert--red")).toMatchObject({ background: "var(--b6-red-bg)", color: "var(--b6-red-ink)" });
    expect(decl(".b6-alert--amber")).toMatchObject({ background: "var(--b6-amber-bg)", color: "var(--b6-amber-ink)" });
    expect(decl(".b6-alert__lead")["font-weight"]).toBe("600");
  });

  it("takes its role from the caller and has no axe violations", async () => {
    const { container } = render(
      <div>
        <div role="alert" className="b6-alert b6-alert--red">
          <b className="b6-alert__lead">Code not recognized.</b>
          <span>Ask for a new code.</span>
        </div>
        <div role="status" className="b6-alert b6-alert--amber b6-alert--row">
          <span aria-hidden="true" className="b6-alert__icon">!</span>
          <span>Keep this page open.</span>
        </div>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("code field and field", () => {
  it("the code field is 64px, mono 28px, letter-spaced, centred, with a placeholder at 3:1 or better", () => {
    expect(decl(".b6-codefield")).toMatchObject({ height: "64px", "font-size": "28px", "letter-spacing": "10px", "text-align": "center", "border-radius": "14px" });
    expect(decl(".b6-codefield")["font-family"]).toBe("var(--b6-font-mono)");
    expect(contrast(tok(rootTokens(css), "--b6-faint"), tok(rootTokens(css), "--b6-surface"))).toBeGreaterThanOrEqual(3);
    expect(decl(".b6-codefield::placeholder")["color"]).toBe("var(--b6-faint)");
    // QA M-003: six dots must fit the 280 px content box at 360, so the hint is spaced tighter than the digits
    expect(decl(".b6-codefield::placeholder")["letter-spacing"]).toBe("4px");
    expect(decl(".b6-codefield::placeholder")["text-indent"]).toBe("4px");
  });

  it("both have a visible focus ring from the focus token", () => {
    expect(decl(".b6-codefield:focus-visible")["outline"]).toContain("var(--b6-focus)");
    expect(decl(".b6-field:focus-visible")["outline"]).toContain("var(--b6-focus)");
  });

  it("a labelled code input has no axe violations", async () => {
    const { container } = render(
      <div>
        <label htmlFor="c">6-digit code</label>
        <input id="c" className="b6-codefield" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="· · · · · ·" />
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("guide chrome", () => {
  it("fab, clock, cardbox, dsec and ctl follow the boards", () => {
    expect(decl(".b6-fab")["display"]).toBe("inline-flex");
    expect(decl(".b6-clock")).toMatchObject({ background: "var(--b6-teal-bg)", color: "var(--b6-teal-ink)", "font-family": "var(--b6-font-mono)" });
    expect(decl(".b6-cardbox")).toMatchObject({ background: "var(--b6-cardbox)", "border-radius": "16px", padding: "14px 15px" });
    expect(decl(".b6-dsec")).toMatchObject({ "font-size": "13.5px", "font-weight": "500" });
    expect(decl(".b6-ctl")).toMatchObject({ width: "100%", "border-radius": "14px", background: "var(--b6-ink)", color: "var(--b6-surface)" });
    expect(minHeightPx(decl(".b6-ctl"), rootTokens(css))).toBeGreaterThanOrEqual(44);
  });

  it("a disabled control is the readable grey, not a faded copy, and its ring is the focus token", () => {
    expect(decl(".b6-ctl:disabled")).toMatchObject({ background: "var(--b6-disabled-bg)", color: "var(--b6-muted)", cursor: "not-allowed" });
    expect(decl(".b6-ctl:focus-visible")["outline"]).toContain("var(--b6-focus)");
  });

  it("the collapsed phone handle is the 84px board row; the pill is not affected", () => {
    expect(decl('.b6-sheet .b6-handle[aria-expanded="false"]')["min-height"]).toBe("84px");
    expect(decl(".b6-handle")["min-height"]).toBe("48px");
  });
});

describe("web shell", () => {
  it("dtop is the bar with a hairline; dwrap becomes the 210px + main grid from 900px", () => {
    expect(decl(".b6-dtop")).toMatchObject({ "border-bottom": "1px solid var(--b6-line-soft)", "flex-wrap": "wrap" });
    expect(inMedia("@media (min-width: 900px)", ".b6-dtop")).toContain("padding: 14px 28px");
    expect(inMedia("@media (min-width: 900px)", ".b6-dwrap")).toContain("grid-template-columns: 210px minmax(0, 1fr)");
    expect(decl(".b6-main")).toMatchObject({ gap: "22px" });
    expect(inMedia("@media (min-width: 900px)", ".b6-main")).toContain("padding: 22px 32px 56px");
  });

  it("nav items are 44px, radius 12; the current one is white with a shadow; a count badge exists", () => {
    expect(minHeightPx(decl(".b6-nav__item"), rootTokens(css))).toBeGreaterThanOrEqual(44);
    expect(decl(".b6-nav__item")["border-radius"]).toBe("var(--b6-r-control)");
    expect(decl('.b6-nav__item[aria-current="page"]')).toMatchObject({ background: "var(--b6-surface)", "font-weight": "500" });
    expect(decl(".b6-nav__item--on")["background"]).toBe("var(--b6-surface)");
    expect(decl(".b6-badge")["background"]).toBe("var(--b6-ink)");
    expect(decl(".b6-nav__badge")["background"]).toBe("var(--b6-ink)");
    expect(inMedia("@media (min-width: 900px)", ".b6-nav")).toContain("flex-direction: column");
  });

  it("a nav of real links with the current page marked has no axe violations", async () => {
    const { container } = render(
      <nav aria-label="Main" className="b6-nav">
        <a href="#day" aria-current="page" className="b6-nav__item">
          Day record
        </a>
        <a href="#proposals" className="b6-nav__item">
          Proposals <span className="b6-nav__badge">2</span>
        </a>
      </nav>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("phone frame", () => {
  it("screen, top, head and foot follow the board", () => {
    expect(decl(".b6-screen")).toMatchObject({ padding: "0 20px 24px", background: "var(--b6-ground)", "flex-direction": "column" });
    expect(decl(".b6-top")).toMatchObject({ padding: "14px 20px", "justify-content": "space-between" });
    expect(decl(".b6-screen > .b6-top")["margin"]).toBe("0 -20px");
    expect(decl(".b6-head")["text-align"]).toBe("center");
    expect(decl(".b6-foot")["flex-direction"]).toBe("column");
  });
});
