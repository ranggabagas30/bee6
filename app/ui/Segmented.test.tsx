// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Segmented } from "@/app/ui/Segmented";
import { axeViolations } from "@/lib/testing/axe";
import { contrast, minHeightPx, readGlobalsCss, rootTokens, ruleDeclarations, tok } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();
const tokens = rootTokens(css);

const OPTIONS = [
  { value: "id", label: "ID", lang: "id" },
  { value: "en", label: "EN", lang: "en" },
] as const;

describe("Segmented", () => {
  it("is a named group of buttons, with the current one pressed", () => {
    render(<Segmented label="Language" options={OPTIONS} value="en" onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Language" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("button", { name: "EN" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "ID" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onChange with the value of a different option", () => {
    const onChange = vi.fn();
    render(<Segmented label="Language" options={OPTIONS} value="en" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "ID" }));
    expect(onChange).toHaveBeenCalledWith("id");
  });

  it("does not call onChange for the option that is already selected", () => {
    const onChange = vi.fn();
    render(<Segmented label="Language" options={OPTIONS} value="en" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves the pressed state when a parent updates the value", () => {
    function Harness() {
      const [v, setV] = useState("en");
      return <Segmented label="Language" options={OPTIONS} value={v} onChange={setV} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "ID" }));
    expect(screen.getByRole("button", { name: "ID" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "EN" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("passes an option's lang to its button, so a screen reader pronounces it right", () => {
    render(<Segmented label="Language" options={OPTIONS} value="en" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "ID" }).getAttribute("lang")).toBe("id");
  });

  it("an option can be disabled with the real attribute", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="View"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    const b = screen.getByRole("button", { name: "B" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.click(b);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a disabled option is faint text and not-allowed, never a faded copy (no opacity)", () => {
    const d = ruleDeclarations(css, ".b6-seg__item:disabled");
    expect(d["color"]).toBe("var(--b6-faint)");
    expect(d["cursor"]).toBe("not-allowed");
    expect(d["opacity"]).toBeUndefined();
    // inactive controls are exempt from WCAG 1.4.3; the faint-on-chip ratio is still pinned so it cannot drift lower
    expect(contrast(tok(tokens, "--b6-faint"), tok(tokens, "--b6-chip"))).toBeGreaterThanOrEqual(2.9);
  });

  it("has a mono (language toggle) and a plain (view switch) look", () => {
    const { container, rerender } = render(<Segmented label="x" options={OPTIONS} value="en" onChange={() => {}} />);
    expect(container.firstElementChild?.className).toContain("b6-seg--mono");
    rerender(<Segmented label="x" options={OPTIONS} value="en" onChange={() => {}} variant="plain" />);
    expect(container.firstElementChild?.className).not.toContain("b6-seg--mono");
    expect(ruleDeclarations(css, ".b6-seg--mono")["font-family"]).toBe("var(--b6-font-mono)");
    expect(ruleDeclarations(css, ".b6-seg")["background"]).toBe("var(--b6-chip)");
    expect(ruleDeclarations(css, ".b6-seg__item")["border-radius"]).toBeTruthy();
  });

  it("every segment is at least a 44px tap target, with a selected state that is not colour-only", () => {
    expect(minHeightPx(ruleDeclarations(css, ".b6-seg__item"), tokens)).toBeGreaterThanOrEqual(44);
    const on = ruleDeclarations(css, '.b6-seg__item[aria-pressed="true"]');
    expect(on["background"]).toBe("var(--b6-surface)");
    expect(on["font-weight"]).toBe("500");
    expect(on["box-shadow"]).toBe("var(--b6-shadow-seg-on)");
  });

  it("has no axe violations", async () => {
    const { container } = render(<Segmented label="Language" options={OPTIONS} value="en" onChange={() => {}} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
