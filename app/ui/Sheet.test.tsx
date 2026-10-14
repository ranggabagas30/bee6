// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "@/app/ui/Sheet";
import { axeViolations } from "@/lib/testing/axe";
import { minHeightPx, readGlobalsCss, rootTokens, ruleDeclarations } from "@/lib/testing/css";

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
    expect(sheet["max-height"]).toBe("70vh");
    expect(sheet["border-radius"]).toBe("var(--b6-r-sheet) var(--b6-r-sheet) 0 0");
    expect(ruleDeclarations(css, ".b6-sheet__body")["overflow-y"]).toBe("auto");
    expect(minHeightPx(ruleDeclarations(css, ".b6-handle"), tokens)).toBeGreaterThanOrEqual(48);
    expect(ruleDeclarations(css, ".b6-sheet__body[hidden]")["display"]).toBe("none");
  });

  it("has no axe violations open or collapsed", async () => {
    const closed = render(<Harness />);
    expect(await axeViolations(closed.container)).toEqual([]);
    cleanup();
    const open = render(<Harness initial />);
    expect(await axeViolations(open.container)).toEqual([]);
  });
});
