// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, ButtonLink, buttonClassName } from "@/app/ui/Button";
import { axeViolations } from "@/lib/testing/axe";
import { minHeightPx, readGlobalsCss, rootTokens, ruleDeclarations } from "@/app/ui/css-helpers";

afterEach(() => cleanup());
const css = readGlobalsCss();
const tokens = rootTokens(css);

describe("Button", () => {
  it("is a native button that never submits a form by accident", () => {
    render(<Button>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(b.type).toBe("button");
  });

  it("lets a form opt in to submit", () => {
    render(<Button type="submit">Send</Button>);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).type).toBe("submit");
  });

  it("defaults to the primary variant", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button").className).toContain("b6-btn--primary");
  });

  it.each([
    ["primary", "b6-btn--primary"],
    ["secondary", "b6-btn--secondary"],
    ["destructive", "b6-btn--destructive"],
  ] as const)("renders the %s variant", (variant, cls) => {
    render(<Button variant={variant}>x</Button>);
    const b = screen.getByRole("button");
    expect(b.className).toContain("b6-btn");
    expect(b.className).toContain(cls);
  });

  it("primary is the dark gradient pill; destructive is red with white text", () => {
    expect(ruleDeclarations(css, ".b6-btn--primary")["background"]).toContain("linear-gradient");
    expect(ruleDeclarations(css, ".b6-btn--primary")["background"]).toContain("var(--b6-dark-hi)");
    expect(ruleDeclarations(css, ".b6-btn--destructive")["background"]).toBe("var(--b6-red-ink)");
    expect(ruleDeclarations(css, ".b6-btn--destructive")["color"]).toBe("var(--b6-surface)");
  });

  it("calls onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Tap</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled is the real disabled attribute: not clickable and out of the tab order", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Start
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Start" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("every variant has a readable disabled style (grey fill, muted text), not a faded copy", () => {
    for (const v of ["primary", "secondary", "destructive"]) {
      const d = ruleDeclarations(css, `.b6-btn--${v}:disabled`);
      expect(d["background"], v).toBe("var(--b6-disabled-bg)");
      expect(d["color"], v).toBe("var(--b6-muted)");
      expect(d["cursor"], v).toBe("not-allowed");
    }
  });

  it("forwards a ref to the button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current?.tagName).toBe("BUTTON");
  });

  it("an icon-only button is named by its aria-label", () => {
    render(
      <Button variant="secondary" aria-label="Close">
        <span aria-hidden="true">x</span>
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("sizes: md is 44px (the tap target), lg is the 56px full pill", () => {
    expect(minHeightPx(ruleDeclarations(css, ".b6-btn"), tokens)).toBeGreaterThanOrEqual(44);
    expect(minHeightPx(ruleDeclarations(css, ".b6-btn--lg"), tokens)).toBe(56);
    expect(ruleDeclarations(css, ".b6-btn--lg")["border-radius"]).toBe("var(--b6-r-btn-lg)");
    expect(ruleDeclarations(css, ".b6-btn")["border-radius"]).toBe("var(--b6-r-btn)");
    render(
      <>
        <Button>md</Button>
        <Button size="lg" block>
          lg
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "lg" }).className).toContain("b6-btn--lg");
    expect(screen.getByRole("button", { name: "lg" }).className).toContain("b6-btn--block");
    expect(screen.getByRole("button", { name: "md" }).className).not.toContain("b6-btn--lg");
  });

  it("has a visible focus ring from the focus token", () => {
    const d = ruleDeclarations(css, ".b6-btn:focus-visible");
    expect(d["outline"]).toContain("var(--b6-focus)");
  });
});

describe("ButtonLink", () => {
  it("is a real link with the button look", () => {
    render(<ButtonLink href="/pair">Open</ButtonLink>);
    const a = screen.getByRole("link", { name: "Open" });
    expect(a.getAttribute("href")).toBe("/pair");
    expect(a.className).toContain("b6-btn--primary");
  });

  it("disabled drops the href and says so with aria-disabled; clicking does nothing", () => {
    const onClick = vi.fn();
    render(
      <ButtonLink href="/pair" disabled onClick={onClick}>
        Open
      </ButtonLink>,
    );
    const a = screen.getByRole("link", { name: "Open" });
    expect(a.getAttribute("aria-disabled")).toBe("true");
    expect(a.hasAttribute("href")).toBe(false);
    fireEvent.click(a);
    expect(onClick).not.toHaveBeenCalled();
    expect(ruleDeclarations(css, '.b6-btn--primary[aria-disabled="true"]')["background"]).toBe("var(--b6-disabled-bg)");
  });
});

describe("buttonClassName", () => {
  it("builds the class list for a custom element such as next/link", () => {
    expect(buttonClassName({ variant: "secondary", size: "lg", block: true, className: "x" })).toBe(
      "b6-btn b6-btn--secondary b6-btn--lg b6-btn--block x",
    );
    expect(buttonClassName({})).toBe("b6-btn b6-btn--primary");
  });
});

describe("a11y", () => {
  it("all variants, enabled and disabled, have no axe violations", async () => {
    const { container } = render(
      <div>
        <Button>One</Button>
        <Button variant="secondary">Two</Button>
        <Button variant="destructive">Three</Button>
        <Button disabled>Four</Button>
        <ButtonLink href="/x">Five</ButtonLink>
        <ButtonLink href="/x" disabled>
          Six
        </ButtonLink>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
