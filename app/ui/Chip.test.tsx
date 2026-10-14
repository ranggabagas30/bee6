// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Chip, Pill } from "@/app/ui/Chip";
import { axeViolations } from "@/lib/testing/axe";
import { readGlobalsCss, ruleDeclarations } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();

describe("Chip", () => {
  it("renders its text in a b6-chip with the mono 12px 8px-radius look", () => {
    render(<Chip>DEMO DATA</Chip>);
    const el = screen.getByText("DEMO DATA");
    expect(el.className).toContain("b6-chip");
    const d = ruleDeclarations(css, ".b6-chip");
    expect(d["background"]).toBe("var(--b6-chip)");
    expect(d["border-radius"]).toBe("var(--b6-r-chip)");
    expect(d["font-family"]).toBe("var(--b6-font-mono)");
    expect(d["white-space"]).toBe("nowrap");
  });

  it.each([
    ["line", "b6-chip--line"],
    ["teal", "b6-chip--teal"],
    ["amber", "b6-chip--amber"],
  ] as const)("has a %s variant", (variant, cls) => {
    render(<Chip variant={variant}>x</Chip>);
    expect(screen.getByText("x").className).toContain(cls);
  });

  it("variants map to the page-2 colour pairs", () => {
    expect(ruleDeclarations(css, ".b6-chip--teal")).toMatchObject({ background: "var(--b6-teal-bg)", color: "var(--b6-teal-ink)" });
    expect(ruleDeclarations(css, ".b6-chip--amber")).toMatchObject({ background: "var(--b6-amber-bg)", color: "var(--b6-amber-ink)" });
    expect(ruleDeclarations(css, ".b6-chip--line")["background"]).toBe("transparent");
  });

  it("the default variant adds no variant class", () => {
    render(<Chip>x</Chip>);
    expect(screen.getByText("x").className).toBe("b6-chip");
  });
});

describe("Pill", () => {
  it("defaults to the neutral tone", () => {
    render(<Pill>Waiting</Pill>);
    const el = screen.getByText("Waiting");
    expect(el.className).toContain("b6-pill");
    expect(el.className).toContain("b6-pill--neutral");
    expect(ruleDeclarations(css, ".b6-pill")["border-radius"]).toBe("var(--b6-r-pill)");
  });

  it.each([
    ["neutral", "--b6-chip", "--b6-ink-soft"],
    ["teal", "--b6-teal-bg", "--b6-teal-ink"],
    ["amber", "--b6-amber-bg", "--b6-amber-ink"],
    ["red", "--b6-red-bg", "--b6-red-ink"],
    ["green", "--b6-green-bg", "--b6-green-ink"],
  ] as const)("%s tone uses its token pair", (tone, bg, fg) => {
    render(<Pill tone={tone}>t</Pill>);
    expect(screen.getByText("t").className).toContain(`b6-pill--${tone}`);
    expect(ruleDeclarations(css, `.b6-pill--${tone}`)).toMatchObject({ background: `var(${bg})`, color: `var(${fg})` });
  });

  it("carries meaning in its words, so colour is never the only cue", () => {
    render(<Pill tone="red">Refused</Pill>);
    expect(screen.getByText("Refused")).toBeTruthy();
  });
});

describe("a11y", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <p>
        <Chip>A</Chip>
        <Chip variant="teal">B</Chip>
        <Pill tone="amber">C</Pill>
      </p>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
