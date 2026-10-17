// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Logo } from "@/app/ui/Logo";
import { axeViolations } from "@/lib/testing/axe";
import { readGlobalsCss, ruleDeclarations } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();

describe("Logo", () => {
  it("the wordmark is the text Bee6 and the mark is hidden from assistive tech", () => {
    const { container } = render(<Logo />);
    expect(screen.getByText("Bee6").className).toContain("b6-logo__word");
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toContain("b6-logo__mark");
    expect(container.querySelectorAll("svg rect")).toHaveLength(2);
  });

  it("md is the board size (26px mark, 18px/800 word); sm is a class modifier", () => {
    expect(ruleDeclarations(css, ".b6-logo__mark")["width"]).toBe("26px");
    expect(ruleDeclarations(css, ".b6-logo__word")["font-size"]).toBe("18px");
    expect(ruleDeclarations(css, ".b6-logo")["font-weight"]).toBe("800");
    const { container } = render(<Logo size="sm" />);
    expect((container.firstElementChild as HTMLElement).className).toContain("b6-logo--sm");
  });

  it("reads as one text node to a screen reader and has no axe violations", async () => {
    const { container } = render(<Logo />);
    expect(container.textContent).toBe("Bee6");
    expect(await axeViolations(container)).toEqual([]);
  });
});
