// @vitest-environment jsdom
import { useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "@/app/ui/Sheet";
import { axeViolations } from "@/lib/testing/axe";
import { declarations, minHeightPx, parseCss, readGlobalsCss, rootTokens, ruleDeclarations } from "@/lib/testing/css";

afterEach(() => cleanup());
const css = readGlobalsCss();
const tokens = rootTokens(css);

function Harness({ initial = false, onOpenChange }: { initial?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = useState(initial);
  return (
    <Sheet
      label="Helper"
      open={open}
      onOpenChange={(o) => {
        onOpenChange?.(o);
        setOpen(o);
      }}
      openLabel="Open the helper"
      closeLabel="Close the helper"
      handle={<span>Summary line</span>}
    >
      <p>Sheet body</p>
      <button type="button">Inside</button>
    </Sheet>
  );
}

describe("Sheet", () => {
  it("is a named region, collapsed by default: the handle shows, the body is hidden", () => {
    render(<Harness />);
    expect(screen.getByRole("region", { name: "Helper" })).toBeTruthy();
    expect(screen.getByText("Summary line")).toBeTruthy();
    const body = screen.getByText("Sheet body").parentElement as HTMLElement;
    expect(body.hidden).toBe(true);
    expect(screen.queryByRole("button", { name: "Inside" })).toBeNull();
  });

  it("the handle is a button whose name says what it does and includes its summary", () => {
    render(<Harness />);
    const handle = screen.getByRole("button", { name: /Open the helper/ });
    expect(handle.textContent).toContain("Summary line");
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.getAttribute("aria-controls")).toBe(document.querySelector(".b6-sheet__body")?.id);
  });

  it("opens on tap and reports the change; the body becomes reachable", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Open the helper/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    const handle = screen.getByRole("button", { name: /Close the helper/ });
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Inside" })).toBeTruthy();
  });

  it("closes again on a second tap", () => {
    render(<Harness initial />);
    fireEvent.click(screen.getByRole("button", { name: /Close the helper/ }));
    expect(screen.getByRole("button", { name: /Open the helper/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes it and puts focus back on the handle", () => {
    const onOpenChange = vi.fn();
    render(<Harness initial onOpenChange={onOpenChange} />);
    const inside = screen.getByRole("button", { name: "Inside" });
    inside.focus();
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Open the helper/ }));
  });

  // R-19 wiring: the reset dialog is portaled to document.body from inside the guide's card. React synthetic events
  // climb the React tree, not the DOM, so a keydown inside the portal reaches this onKeyDown too; it must not close
  // the sheet (the dialog decides what Escape does, and while a request is in flight it ignores it).
  it("Escape from a child portaled outside the section neither closes the sheet nor moves focus", () => {
    const onOpenChange = vi.fn();
    function Portaled() {
      return createPortal(<button type="button">In a portal</button>, document.body);
    }
    render(
      <Sheet label="Helper" open onOpenChange={onOpenChange} openLabel="o" closeLabel="c" handle={<span>h</span>}>
        <Portaled />
      </Sheet>,
    );
    const inPortal = screen.getByRole("button", { name: "In a portal" });
    inPortal.focus();
    fireEvent.keyDown(inPortal, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(inPortal);
  });

  it("Escape does nothing while collapsed", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Open the helper/ }), { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("is non-modal: no dialog role, no aria-modal, no focus trap", () => {
    render(<Harness initial />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[aria-modal]")).toBeNull();
  });

  it("is fixed to the bottom, capped at 70vh, scrolls its body, and the handle is at least 48px", () => {
    const sheet = ruleDeclarations(css, ".b6-sheet");
    expect(sheet["position"]).toBe("fixed");
    expect(sheet["bottom"]).toBe("0");
    expect(sheet["max-height"]).toBe("70dvh");
    expect(sheet["border-radius"]).toBe("var(--b6-r-sheet) var(--b6-r-sheet) 0 0");
    expect(ruleDeclarations(css, ".b6-sheet__body")["overflow-y"]).toBe("auto");
    expect(minHeightPx(ruleDeclarations(css, ".b6-handle"), tokens)).toBeGreaterThanOrEqual(48);
    expect(ruleDeclarations(css, ".b6-sheet__body[hidden]")["display"]).toBe("none");
  });

  it("the handle never shrinks inside the flex column (a 360x640 phone squashed it to 50 px under 58 px of content)", () => {
    expect(ruleDeclarations(css, ".b6-handle")["flex-shrink"]).toBe("0");
  });

  it("the scroll body is a keyboard-focusable region named by the caller (or by the handle's action text), with a visible focus ring", () => {
    const { unmount } = render(<Harness initial />);
    const body = document.querySelector(".b6-sheet__body") as HTMLElement;
    expect(body.getAttribute("tabindex")).toBe("0");
    expect(body.getAttribute("role")).toBe("region");
    expect(screen.getByRole("region", { name: "Close the helper" })).toBe(body);
    expect(ruleDeclarations(css, ".b6-sheet__body:focus-visible")["outline"]).toBe("2px solid var(--b6-focus)");
    unmount();
    render(
      <Sheet label="Helper" open onOpenChange={() => {}} openLabel="o" closeLabel="c" handle={<span>h</span>} bodyLabelledBy="card-h">
        <h2 id="card-h">Card heading</h2>
      </Sheet>,
    );
    const named = document.querySelector(".b6-sheet__body") as HTMLElement;
    expect(named.getAttribute("aria-labelledby")).toBe("card-h");
    expect(screen.getByRole("region", { name: "Card heading" })).toBe(named);
  });

  it("the handle focus ring is drawn inside the handle, so the full-width edge cannot clip it", () => {
    expect(ruleDeclarations(css, ".b6-handle:focus-visible")["outline-offset"]).toBe("-2px");
    expect(ruleDeclarations(css, ".b6-handle:focus-visible")["outline"]).toBe("2px solid var(--b6-focus)");
  });

  it("the height cap falls back to vh where dvh is unsupported, then uses dvh", () => {
    const body = parseCss(css).find((r) => r.prelude === ".b6-sheet")!.body;
    const caps = declarations(body).filter(([k]) => k === "max-height").map(([, v]) => v);
    expect(caps).toEqual(["70vh", "70dvh"]);
  });

  it("has no axe violations open or collapsed", async () => {
    const closed = render(<Harness />);
    expect(await axeViolations(closed.container)).toEqual([]);
    cleanup();
    const open = render(<Harness initial />);
    expect(await axeViolations(open.container)).toEqual([]);
  });
});
