// @vitest-environment jsdom
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidePanel } from "@/app/ui/SidePanel";
import { axeViolations } from "@/lib/testing/axe";
import { declarations, minHeightPx, parseCss, readGlobalsCss, rootTokens, ruleDeclarations } from "@/lib/testing/css";

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
    expect(minHeightPx(ruleDeclarations(css, ".b6-panel__close"), tokens)).toBeGreaterThanOrEqual(48);
  });

  it("Escape closes the open panel", () => {
    const onOpenChange = vi.fn();
    render(<Harness initial onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByText("Panel body"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // R-19 wiring: the reset dialog is portaled to document.body from inside the guide's card. React synthetic events
  // climb the React tree, not the DOM, so a keydown inside the portal reaches this onKeyDown too; it must not close
  // the panel (the dialog decides what Escape does, and while a request is in flight it ignores it).
  it("Escape from a child portaled outside the aside does not close the panel", () => {
    const onOpenChange = vi.fn();
    function Portaled() {
      return createPortal(<button type="button">In a portal</button>, document.body);
    }
    render(
      <SidePanel label="Helper" open onOpenChange={onOpenChange} openLabel="o" closeLabel="c" pill={<span>p</span>} header={<span>h</span>}>
        <Portaled />
      </SidePanel>,
    );
    const inPortal = screen.getByRole("button", { name: "In a portal" });
    inPortal.focus();
    fireEvent.keyDown(inPortal, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(inPortal);
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

  it("the scroll body is a keyboard-focusable region named by the caller (or by the panel's label)", () => {
    const { unmount } = render(<Harness initial />);
    const body = document.querySelector(".b6-panel__body") as HTMLElement;
    expect(body.getAttribute("tabindex")).toBe("0");
    expect(body.getAttribute("role")).toBe("region");
    expect(body.getAttribute("aria-label")).toBe("Helper");
    expect(ruleDeclarations(css, ".b6-panel__body:focus-visible")["outline"]).toBe("2px solid var(--b6-focus)");
    unmount();
    render(
      <SidePanel label="Helper" open onOpenChange={() => {}} openLabel="o" closeLabel="c" pill={<span>p</span>} header={<span>h</span>} bodyLabelledBy="card-h">
        <h2 id="card-h">Card heading</h2>
      </SidePanel>,
    );
    expect(screen.getByRole("region", { name: "Card heading" })).toBe(document.querySelector(".b6-panel__body"));
  });

  it("while open it insets every page by the panel width (a class on <html>, padding on <body>); collapsing or unmounting removes it", () => {
    const rule = ruleDeclarations(css, ".b6-panel-open body");
    expect(rule["padding-right"]).toBe("var(--b6-panel-w)");
    const { unmount } = render(<Harness />);
    expect(document.documentElement.classList.contains("b6-panel-open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Open the helper/ }));
    expect(document.documentElement.classList.contains("b6-panel-open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close the helper" }));
    expect(document.documentElement.classList.contains("b6-panel-open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Open the helper/ }));
    unmount();
    expect(document.documentElement.classList.contains("b6-panel-open")).toBe(false);
  });

  it("while collapsed to the pill it pushes every page down below the pill (a class on <html>, top padding on <body>); open or unmounted removes it", () => {
    const rule = ruleDeclarations(css, ".b6-panel-collapsed body");
    // pill height + its 14 px top offset + 8 px of air = 70 px
    expect(tokens["--b6-panel-pill-h"]).toBe("48px");
    expect(rule["padding-top"]).toBe("calc(var(--b6-panel-pill-h) + 14px + 8px)");
    expect(rule["padding-right"]).toBeUndefined();
    expect(ruleDeclarations(css, ".b6-panel-open body")["padding-top"]).toBeUndefined();
    expect(minHeightPx(ruleDeclarations(css, ".b6-panel-pill"), tokens)).toBe(48);
    const root = document.documentElement;
    const { unmount } = render(<Harness />);
    expect(root.classList.contains("b6-panel-collapsed")).toBe(true);
    expect(root.classList.contains("b6-panel-open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Open the helper/ }));
    expect(root.classList.contains("b6-panel-collapsed")).toBe(false);
    expect(root.classList.contains("b6-panel-open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close the helper" }));
    expect(root.classList.contains("b6-panel-collapsed")).toBe(true);
    expect(root.classList.contains("b6-panel-open")).toBe(false);
    unmount();
    expect(root.classList.contains("b6-panel-collapsed")).toBe(false);
    expect(root.classList.contains("b6-panel-open")).toBe(false);
  });

  // Round-3 D1: the collapsed class above lands in an effect, so on a full page load the 70 px arrived only after
  // hydration (every page jumped down, CLS 0.01-0.06). A host that knows at first paint that the pill will be
  // there puts `b6-panel-reserved` on <html> before anything paints; at panel widths (>= 900 px) that reserves
  // the same padding from the first frame. An open panel wins (right inset only, no top padding), exactly as
  // the collapsed class behaves.
  it("CSS contract: b6-panel-reserved on <html> reserves the pill's top padding from the first paint at >= 900 px, unless the panel is open", () => {
    const media = parseCss(css).find((r) => r.prelude === "@media (min-width: 900px)" && r.children.some((c) => c.prelude.includes(".b6-panel-reserved")));
    expect(media).toBeDefined();
    const rule = media!.children.find((c) => c.prelude === ".b6-panel-reserved:not(.b6-panel-open) body");
    expect(rule).toBeDefined();
    const decls = Object.fromEntries(declarations(rule!.body));
    expect(decls["padding-top"]).toBe(ruleDeclarations(css, ".b6-panel-collapsed body")["padding-top"]);
    expect(Object.keys(decls)).toEqual(["padding-top"]);
    // never outside the media query: a phone (bottom sheet, no pill) must not get the padding
    expect(ruleDeclarations(css, ".b6-panel-reserved:not(.b6-panel-open) body")).toEqual({});
    expect(ruleDeclarations(css, ".b6-panel-reserved body")).toEqual({});
    // the host owns the reserve class: SidePanel neither adds nor removes it
    const root = document.documentElement;
    root.classList.add("b6-panel-reserved");
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Open the helper/ }));
    expect(root.classList.contains("b6-panel-reserved")).toBe(true);
    unmount();
    expect(root.classList.contains("b6-panel-reserved")).toBe(true);
    root.classList.remove("b6-panel-reserved");
  });

  it("has no axe violations collapsed or open", async () => {
    const closed = render(<Harness />);
    expect(await axeViolations(closed.container)).toEqual([]);
    cleanup();
    const open = render(<Harness initial />);
    expect(await axeViolations(open.container)).toEqual([]);
  });
});
