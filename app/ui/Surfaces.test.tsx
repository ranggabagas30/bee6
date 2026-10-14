// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Card, Glass } from "@/app/ui/Card";
import { Tile } from "@/app/ui/Tile";
import { Mist } from "@/app/ui/Mist";
import { Kicker } from "@/app/ui/Kicker";
import { axeViolations } from "@/lib/testing/axe";
import { readGlobalsCss, rootTokens, ruleDeclarations } from "@/lib/testing/css";

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
