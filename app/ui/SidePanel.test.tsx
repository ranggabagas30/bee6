// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidePanel } from "@/app/ui/SidePanel";
import { axeViolations } from "@/lib/testing/axe";
import { minHeightPx, readGlobalsCss, rootTokens, ruleDeclarations } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();
const tokens = rootTokens(css);

function Harness({ initial = false, onOpenChange }: { initial?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = useState(initial);
  return (
    <SidePanel
      label="Helper"
      open={open}
      onOpenChange={(o) => {
        onOpenChange?.(o);
        setOpen(o);
      }}
      openLabel="Open the helper"
      closeLabel="Close the helper"
      pill={<span>Helper · step 2</span>}
      header={<span>Helper title</span>}
    >
      <p>Panel body</p>
      <button type="button">Inside</button>
    </SidePanel>
  );
}

describe("SidePanel", () => {
  it("is collapsed to a pill by default: the pill is a button, the panel body is not reachable", () => {
    render(<Harness />);
    const pill = screen.getByRole("button", { name: /Open the helper/ });
    expect(pill.textContent).toContain("Helper · step 2");
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("complementary", { name: "Helper" })).toBeNull();
    expect(screen.queryByText("Panel body")).toBeNull();
  });

  it("opens into a named complementary panel and swaps the pill for a close button", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Open the helper/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    const panel = screen.getByRole("complementary", { name: "Helper" });
    expect(panel.textContent).toContain("Helper title");
    expect(screen.getByText("Panel body")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open the helper/ })).toBeNull();
  });

  it("moves focus to the close button on open and back to the pill on close", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Open the helper/ }));
    const close = screen.getByRole("button", { name: "Close the helper" });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Open the helper/ }));
  });

  it("does not steal focus when it mounts already open", () => {
    render(<Harness initial />);
    expect(document.activeElement).toBe(document.body);
  });

  it("the icon-only close button is named by aria-label and its glyph is hidden", () => {
    render(<Harness initial />);
    const close = screen.getByRole("button", { name: "Close the helper" });
    expect(close.getAttribute("aria-label")).toBe("Close the helper");
    expect(close.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(minHeightPx(ruleDeclarations(css, ".b6-panel__close"), tokens)).toBeGreaterThanOrEqual(44);
  });

  it("Escape closes the open panel", () => {
    const onOpenChange = vi.fn();
    render(<Harness initial onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByText("Panel body"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("is non-modal: no dialog role and nothing is made inert", () => {
    render(<Harness initial />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[aria-modal]")).toBeNull();
  });

  it("panel is 360px wide (token), full height, body scrolls; the pill sits top-right and is at least 48px tall", () => {
    expect(tokens["--b6-panel-w"]).toBe("360px");
    const panel = ruleDeclarations(css, ".b6-panel");
    expect(panel["position"]).toBe("fixed");
    expect(panel["width"]).toBe("var(--b6-panel-w)");
    expect(panel["max-width"]).toBe("100vw");
    expect(ruleDeclarations(css, ".b6-panel__body")["overflow-y"]).toBe("auto");
    const pill = ruleDeclarations(css, ".b6-panel-pill");
    expect(pill["position"]).toBe("fixed");
    expect(pill["top"]).toBe("14px");
    expect(pill["right"]).toBe("20px");
    expect(minHeightPx(pill, tokens)).toBeGreaterThanOrEqual(48);
  });

  it("has no axe violations collapsed or open", async () => {
    const closed = render(<Harness />);
    expect(await axeViolations(closed.container)).toEqual([]);
    cleanup();
    const open = render(<Harness initial />);
    expect(await axeViolations(open.container)).toEqual([]);
  });
});
