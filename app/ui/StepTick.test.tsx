// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StepTick } from "@/app/ui/StepTick";
import { axeViolations } from "@/lib/testing/axe";
import { readGlobalsCss, ruleDeclarations } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();

describe("StepTick", () => {
  it("done shows a check, now shows a dot, todo shows an empty ring", () => {
    const { container } = render(
      <>
        <StepTick status="done" statusLabel="done">A</StepTick>
        <StepTick status="now" statusLabel="current">B</StepTick>
        <StepTick status="todo" statusLabel="not yet">C</StepTick>
      </>,
    );
    const ticks = Array.from(container.querySelectorAll(".b6-tick"));
    expect(ticks.map((t) => t.textContent)).toEqual(["✓", "•", ""]);
    expect(ticks.map((t) => t.className)).toEqual([
      expect.stringContaining("b6-tick--done"),
      expect.stringContaining("b6-tick--now"),
      expect.stringContaining("b6-tick--todo"),
    ]);
  });

  it("states the status in text for screen readers, never by glyph or colour alone", () => {
    render(<StepTick status="done" statusLabel="done">Staff · day 1</StepTick>);
    const sr = screen.getByText("done");
    expect(sr.className).toContain("b6-sr-only");
    expect(document.querySelector(".b6-tick")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks only the current step with aria-current", () => {
    const { container } = render(
      <>
        <StepTick status="done" statusLabel="done">A</StepTick>
        <StepTick status="now" statusLabel="current">B</StepTick>
        <StepTick status="todo" statusLabel="not yet">C</StepTick>
      </>,
    );
    const current = container.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("B");
  });

  it("can be a list item inside an ordered list", async () => {
    const { container } = render(
      <ol>
        <StepTick as="li" status="done" statusLabel="done">A</StepTick>
        <StepTick as="li" status="now" statusLabel="current">B</StepTick>
      </ol>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("uses the teal tick colours and keeps todo text readable (muted, not the faint grey)", () => {
    expect(ruleDeclarations(css, ".b6-tick--done")).toMatchObject({ background: "var(--b6-teal-ink)", color: "var(--b6-surface)" });
    expect(ruleDeclarations(css, ".b6-tick--now")["box-shadow"]).toBe("inset 0 0 0 2px var(--b6-teal-ink)");
    expect(ruleDeclarations(css, ".b6-step--todo")["color"]).toBe("var(--b6-muted)");
    expect(ruleDeclarations(css, ".b6-tick--todo")["box-shadow"]).toBe("inset 0 0 0 1px var(--b6-faint)");
    expect(ruleDeclarations(css, ".b6-step--now")["font-weight"]).toBe("500");
  });
});
